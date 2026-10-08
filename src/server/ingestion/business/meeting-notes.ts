/**
 * Meeting notes from Granola and Read AI become MEETING_NOTES source items,
 * attached to the matching meeting, and run through the same AI pipeline as
 * notes typed into the app: decisions, action items, commitments, risks and
 * follow-ups, each with provenance back to the note.
 */
import type { Sensitivity } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { enqueueProcessing } from "../pipeline";
import { upsertSourceItem } from "../raw";
import type { ConnectorSyncContext } from "./types";

export interface MeetingNoteInput {
  /** Stable per note at the provider. */
  externalId: string;
  title: string;
  startsAt: Date | null;
  endsAt?: Date | null;
  attendees: { name: string | null; email: string | null }[];
  /** Calendar event id the provider recorded (Graph event id or iCalUId), when known. */
  calendarEventId?: string | null;
  /** Summary, notes, action items (markdown or plain text). Transcripts only when there is no summary. */
  text: string;
  url?: string | null;
  updatedAt?: Date | null;
}

/** Notes this short carry nothing to extract. */
const MIN_TEXT = 40;
/** A note and a calendar meeting match when their start times are this close. */
const MATCH_WINDOW_MS = 45 * 60_000;

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

/** Jaccard overlap of title words (0–1). */
export function titleSimilarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * The meeting a note belongs to: by calendar event id first, otherwise the
 * meeting nearest in time whose title or attendees overlap the note's.
 */
export async function matchMeeting(note: Pick<MeetingNoteInput, "calendarEventId" | "startsAt" | "title" | "attendees">): Promise<{ id: string; type: string } | null> {
  if (note.calendarEventId) {
    const event = await db.calendarEvent.findFirst({
      where: { OR: [{ externalEventId: note.calendarEventId }, { iCalUid: note.calendarEventId }], meetingId: { not: null } },
      select: { meeting: { select: { id: true, type: true } } },
    });
    if (event?.meeting) return event.meeting;
  }
  if (!note.startsAt) return null;
  const candidates = await db.meeting.findMany({
    where: { startsAt: { gte: new Date(note.startsAt.getTime() - MATCH_WINDOW_MS), lte: new Date(note.startsAt.getTime() + MATCH_WINDOW_MS) } },
    select: { id: true, type: true, title: true, startsAt: true, attendees: { select: { email: true } } },
    take: 20,
  });
  const emails = new Set(note.attendees.map((a) => a.email?.toLowerCase()).filter((e): e is string => Boolean(e)));
  let best: { id: string; type: string; score: number } | null = null;
  for (const m of candidates) {
    const overlap = m.attendees.filter((a) => a.email && emails.has(a.email.toLowerCase())).length;
    const similarity = titleSimilarity(m.title, note.title);
    const closeness = 1 - Math.abs(m.startsAt.getTime() - note.startsAt.getTime()) / MATCH_WINDOW_MS;
    // Same slot plus either a shared attendee or a similar title.
    if (overlap === 0 && similarity < 0.34) continue;
    const score = overlap * 0.5 + similarity + closeness * 0.25;
    if (!best || score > best.score) best = { id: m.id, type: m.type, score };
  }
  return best ? { id: best.id, type: best.type } : null;
}

/** Store (or update) a meeting note and queue it for extraction. */
export async function ingestMeetingNote(ctx: Pick<ConnectorSyncContext, "connection" | "runId" | "now">, note: MeetingNoteInput): Promise<"created" | "updated" | "unchanged" | "skipped"> {
  const text = note.text.trim();
  if (text.length < MIN_TEXT) return "skipped";
  const meeting = await matchMeeting(note);
  // Board meetings are restricted wherever their notes come from.
  const sensitivity: Sensitivity = meeting?.type === "BOARD" ? "RESTRICTED" : ctx.connection.defaultSensitivity;
  const occurredAt = note.startsAt && note.startsAt < ctx.now ? note.startsAt : ctx.now;
  const { item, outcome } = await upsertSourceItem(db, {
    connectionId: ctx.connection.id,
    kind: "MEETING_NOTES",
    externalId: note.externalId.slice(0, 300),
    externalUrl: note.url ?? null,
    title: `Notes: ${note.title.trim() || "Meeting"}`.slice(0, 500),
    occurredAt,
    sourceUpdatedAt: note.updatedAt ?? null,
    text: text.slice(0, 200_000),
    storeRaw: false,
    hashMaterial: note.attendees.map((a) => a.email ?? a.name ?? "").join(","),
    sensitivity,
    meetingId: meeting?.id ?? null,
    startStage: "NORMALIZED",
  });
  if (outcome !== "unchanged") await enqueueProcessing(item, { runId: ctx.runId });
  return outcome;
}
