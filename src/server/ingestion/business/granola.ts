/**
 * Granola connector (public API, API key from a Business or Enterprise plan;
 * scope "notes:read").
 *
 *   list:    GET /v1/notes?updated_after=…&page_size=30, following cursor/hasMore
 *   detail:  GET /v1/notes/{id} for the summary, private notes, attendees and
 *            calendar event; the transcript (?include=transcript, or the paged
 *            /transcript endpoint when it is too large to inline) only when a
 *            note has neither summary nor notes.
 *
 * Each note becomes a MEETING_NOTES source item through ingestMeetingNote, so
 * decisions, action items and commitments are extracted like any other notes.
 * Granola allows about 5 requests a second, so requests are spaced out.
 *
 * Cursor: { updatedAfter } (max updated_at seen). While a run is paging it
 * also keeps { resume: { cursor, maxSeen } } so an interrupted run continues
 * where it stopped instead of moving updatedAfter past notes it never read.
 */
import { z } from "zod";
import { DAY_MS } from "@/lib/dates";
import { ProviderHttpError, type RefreshableProviderContext, providerJson } from "../providers/http";
import { ProviderAuthError } from "../types";
import { type MeetingNoteInput, ingestMeetingNote } from "./meeting-notes";
import { type BusinessConnector, type ConnectorSyncContext, KeyRejectedError, type KeyVerification } from "./types";

export const GRANOLA_API = "https://public-api.granola.ai";
const PAGE_SIZE = 30;
const DEFAULT_INITIAL_DAYS = 90;
/** ≈4.5 requests a second, under Granola's 5/s sustained limit. */
const REQUEST_SPACING_MS = 220;
/** Transcripts are a fallback; the start of the conversation is enough to extract from. */
export const MAX_TRANSCRIPT_CHARS = 60_000;
const MAX_TRANSCRIPT_PAGES = 20;

// ─── API shapes (lenient: only the fields used here) ─────────────────────────

const text = z.string().nullish();
const user = z.object({ name: text, email: text });

const noteSummarySchema = z.object({
  id: z.string().min(1),
  title: text,
  owner: user.nullish(),
  created_at: text,
  updated_at: text,
  deleted_at: text,
});

const listSchema = z.object({
  notes: z.array(noteSummarySchema).default([]),
  hasMore: z.boolean().nullish(),
  cursor: text,
});

const speakerSchema = z.object({ source: text, attribution: text, diarization_label: text, name: text });
const transcriptItemSchema = z.object({ speaker: z.union([speakerSchema, z.string()]).nullish(), text: text });
const transcriptSchema = z.array(transcriptItemSchema).nullish();

export const granolaNoteSchema = z.object({
  id: z.string().min(1),
  title: text,
  owner: user.nullish(),
  created_at: text,
  updated_at: text,
  deleted_at: text,
  web_url: text,
  calendar_event: z
    .object({
      event_title: text,
      invitees: z.array(z.object({ email: text })).nullish(),
      organiser: text,
      calendar_event_id: text,
      scheduled_start_time: text,
      scheduled_end_time: text,
    })
    .nullish(),
  attendees: z.array(user).nullish(),
  summary_text: text,
  summary_markdown: text,
  private_notes_text: text,
  private_notes_markdown: text,
  transcript: transcriptSchema,
});

const transcriptPageSchema = z.object({ transcript: transcriptSchema, hasMore: z.boolean().nullish(), cursor: text });

export type GranolaNote = z.infer<typeof granolaNoteSchema>;
export type GranolaTranscriptItem = z.infer<typeof transcriptItemSchema>;

// ─── Mapping ─────────────────────────────────────────────────────────────────

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Summary and the owner's private notes as labelled sections ("" when the note has neither). */
export function granolaNoteText(note: Pick<GranolaNote, "summary_markdown" | "summary_text" | "private_notes_markdown" | "private_notes_text">): string {
  const summary = (note.summary_markdown?.trim() || note.summary_text?.trim()) ?? "";
  const notes = (note.private_notes_markdown?.trim() || note.private_notes_text?.trim()) ?? "";
  const parts: string[] = [];
  if (summary) parts.push(`## Summary\n\n${summary}`);
  if (notes) parts.push(`## My notes\n\n${notes}`);
  return parts.join("\n\n");
}

function speakerLabel(item: GranolaTranscriptItem, ownerName: string | null): string {
  const s = item.speaker;
  if (typeof s === "string") return s.trim() || "Speaker";
  if (!s) return "Speaker";
  if (s.name?.trim()) return s.name.trim();
  if (s.diarization_label?.trim()) return s.diarization_label.trim();
  if (s.attribution === "me" || (!s.attribution && s.source === "microphone")) return ownerName || "Me";
  return "Them";
}

/** "Speaker: text" lines, capped at `max` characters (whole lines only). */
export function transcriptText(items: GranolaTranscriptItem[], ownerName: string | null = null, max = MAX_TRANSCRIPT_CHARS): string {
  const lines: string[] = [];
  let length = 0;
  for (const item of items) {
    const said = item.text?.replace(/\s+/g, " ").trim();
    if (!said) continue;
    const line = `${speakerLabel(item, ownerName)}: ${said}`;
    if (length + line.length + 1 > max) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

/** Attendees ∪ calendar invitees, de-duplicated by email. */
export function granolaAttendees(note: Pick<GranolaNote, "attendees" | "calendar_event">): MeetingNoteInput["attendees"] {
  const out: MeetingNoteInput["attendees"] = [];
  const seen = new Map<string, number>();
  const add = (name: string | null | undefined, email: string | null | undefined) => {
    const e = email?.trim().toLowerCase() || null;
    const n = name?.trim() || null;
    if (!e && !n) return;
    if (e && seen.has(e)) {
      const i = seen.get(e)!;
      if (!out[i].name && n) out[i] = { ...out[i], name: n };
      return;
    }
    if (e) seen.set(e, out.length);
    out.push({ name: n, email: e });
  };
  for (const a of note.attendees ?? []) add(a.name, a.email);
  for (const i of note.calendar_event?.invitees ?? []) add(null, i.email);
  return out;
}

export function granolaMeetingNote(note: GranolaNote, text: string): MeetingNoteInput {
  const event = note.calendar_event ?? null;
  return {
    externalId: `granola:${note.id}`,
    title: note.title?.trim() || event?.event_title?.trim() || "Granola meeting",
    startsAt: toDate(event?.scheduled_start_time) ?? toDate(note.created_at),
    endsAt: toDate(event?.scheduled_end_time),
    attendees: granolaAttendees(note),
    calendarEventId: event?.calendar_event_id?.trim() || null,
    text,
    url: note.web_url?.startsWith("https://") ? note.web_url : null,
    updatedAt: toDate(note.updated_at),
  };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

/** Keeps at least `spacingMs` between consecutive requests. */
export function pacer(spacingMs: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): () => Promise<void> {
  let last = 0;
  return async () => {
    const wait = last + spacingMs - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
  };
}

function noteUrl(id: string): string {
  return `${GRANOLA_API}/v1/notes/${encodeURIComponent(id)}`;
}

/** The note's transcript, inline when it fits, otherwise from the paged endpoint (up to the cap). */
async function fetchTranscript(http: RefreshableProviderContext, id: string, pace: () => Promise<void>, ownerName: string | null): Promise<string> {
  await pace();
  try {
    const note = await providerJson(http, noteUrl(id), granolaNoteSchema, { query: { include: "transcript" } });
    return transcriptText(note.transcript ?? [], ownerName);
  } catch (error) {
    if (!(error instanceof ProviderHttpError && error.status === 413)) throw error;
  }
  const items: GranolaTranscriptItem[] = [];
  let cursor: string | null = null;
  let chars = 0;
  for (let page = 0; page < MAX_TRANSCRIPT_PAGES && chars < MAX_TRANSCRIPT_CHARS; page++) {
    await pace();
    const res: z.infer<typeof transcriptPageSchema> = await providerJson(http, `${noteUrl(id)}/transcript`, transcriptPageSchema, { query: { page_size: 100, cursor } });
    for (const item of res.transcript ?? []) {
      items.push(item);
      chars += (item.text?.length ?? 0) + 20;
    }
    cursor = res.hasMore && res.cursor ? res.cursor : null;
    if (!cursor) break;
  }
  return transcriptText(items, ownerName);
}

// ─── Sync ────────────────────────────────────────────────────────────────────

export interface GranolaDeps {
  ingestMeetingNote: typeof ingestMeetingNote;
  /** Minimum gap between requests (tests set 0). */
  spacingMs: number;
}

const defaultDeps: GranolaDeps = { ingestMeetingNote, spacingMs: REQUEST_SPACING_MS };

function settingDays(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 3650) : fallback;
}

interface GranolaCursor {
  updatedAfter: string;
  /** Mid-run position: Granola's page cursor, the newest updated_at so far, and the oldest note that failed. */
  resume?: { cursor: string; maxSeen: string; retryFrom?: string };
}

function readCursor(raw: Record<string, unknown> | null): Partial<GranolaCursor> {
  if (!raw) return {};
  const updatedAfter = typeof raw.updatedAfter === "string" && toDate(raw.updatedAfter) ? raw.updatedAfter : undefined;
  const r = raw.resume && typeof raw.resume === "object" ? (raw.resume as Record<string, unknown>) : null;
  const resume =
    r && typeof r.cursor === "string" && typeof r.maxSeen === "string" && toDate(r.maxSeen)
      ? { cursor: r.cursor, maxSeen: r.maxSeen, ...(typeof r.retryFrom === "string" && toDate(r.retryFrom) ? { retryFrom: r.retryFrom } : {}) }
      : undefined;
  return { updatedAfter, resume };
}

const later = (a: string, b: Date | null) => (b && b.getTime() > Date.parse(a) ? b.toISOString() : a);
const earlier = (a: string | undefined, b: Date) => (a && Date.parse(a) <= b.getTime() ? a : b.toISOString());

export async function syncGranola(ctx: ConnectorSyncContext, deps: GranolaDeps = defaultDeps): Promise<void> {
  const pace = pacer(deps.spacingMs);
  const stored = readCursor(ctx.cursor);
  const since = stored.updatedAfter ?? new Date(ctx.now.getTime() - settingDays(ctx.connection.settings.initialDays, DEFAULT_INITIAL_DAYS) * DAY_MS).toISOString();
  let pageCursor: string | null = stored.resume?.cursor ?? null;
  let maxSeen = stored.resume?.maxSeen ?? since;
  // Just before the oldest note that failed this round, so the next run lists it again.
  let retryFrom = stored.resume?.retryFrom;

  for (;;) {
    await pace();
    let page: z.infer<typeof listSchema>;
    try {
      page = await providerJson(ctx.http, `${GRANOLA_API}/v1/notes`, listSchema, { query: { updated_after: since, page_size: PAGE_SIZE, cursor: pageCursor } });
    } catch (error) {
      // A saved page cursor Granola no longer accepts: list the window again (ingestion is idempotent).
      if (pageCursor && pageCursor === stored.resume?.cursor && error instanceof ProviderHttpError && error.status === 400) {
        ctx.note("Granola no longer accepted the saved page position; reading the window again");
        pageCursor = null;
        stored.resume = undefined;
        continue;
      }
      throw error;
    }

    for (const summary of page.notes) {
      ctx.count("fetched");
      const updatedAt = toDate(summary.updated_at);
      maxSeen = later(maxSeen, updatedAt);
      if (summary.deleted_at) {
        ctx.count("unchanged");
        continue;
      }
      try {
        await pace();
        const note = await providerJson(ctx.http, noteUrl(summary.id), granolaNoteSchema);
        let text = granolaNoteText(note);
        if (!text) {
          const transcript = await fetchTranscript(ctx.http, note.id, pace, note.owner?.name?.trim() || null);
          text = transcript ? `## Transcript\n\n${transcript}` : "";
        }
        const outcome = await deps.ingestMeetingNote(ctx, granolaMeetingNote(note, text));
        ctx.count(outcome === "skipped" ? "unchanged" : outcome);
      } catch (error) {
        // Credentials, rate limits and outages stop the run; one unreadable note does not.
        if (error instanceof ProviderAuthError || (error instanceof ProviderHttpError && (error.status === 429 || error.status === 0 || error.status >= 500))) throw error;
        // 404: deleted, or not processed yet (it will be listed again once it is).
        if (error instanceof ProviderHttpError && error.status === 404) {
          ctx.count("unchanged");
          continue;
        }
        ctx.count("failed");
        const reason = error instanceof ProviderHttpError ? (error.code ?? String(error.status)) : error instanceof Error ? error.name : "error";
        ctx.note(`Granola note ${summary.id} could not be read (${reason})`);
        if (updatedAt) retryFrom = earlier(retryFrom, new Date(updatedAt.getTime() - 1));
      }
    }

    const next = page.hasMore && page.cursor ? page.cursor : null;
    if (next && next !== pageCursor) {
      await ctx.saveCursor({ updatedAfter: since, resume: { cursor: next, maxSeen, ...(retryFrom ? { retryFrom } : {}) } } satisfies GranolaCursor);
      pageCursor = next;
      continue;
    }
    await ctx.saveCursor({ updatedAfter: retryFrom && Date.parse(retryFrom) < Date.parse(maxSeen) ? retryFrom : maxSeen } satisfies GranolaCursor);
    return;
  }
}

// ─── Key check ───────────────────────────────────────────────────────────────

export async function verifyGranolaKey(key: string, now = new Date()): Promise<KeyVerification> {
  const http: RefreshableProviderContext = {
    connection: { id: "granola:verify", provider: "GRANOLA", mode: "LIVE", accountEmail: null, settings: {} },
    now,
    log: () => {},
    getAccessToken: async () => key,
  };
  let page: z.infer<typeof listSchema>;
  try {
    page = await providerJson(http, `${GRANOLA_API}/v1/notes`, listSchema, { query: { page_size: 1 }, maxRetries: 1, timeoutMs: 15_000 });
  } catch (error) {
    if (error instanceof ProviderAuthError || (error instanceof ProviderHttpError && error.status === 401)) {
      throw new KeyRejectedError("Granola rejected the key. Create one in Granola → Settings → Connectors → API keys, then paste it here.");
    }
    if (error instanceof ProviderHttpError && error.status === 403) {
      throw new KeyRejectedError(
        "Granola refused access with this key. The Granola API needs a Business or Enterprise plan, and on Enterprise an admin may need to allow API access for members.",
      );
    }
    throw error;
  }
  const email = page.notes[0]?.owner?.email?.trim().toLowerCase() || null;
  return { accountName: email ?? "Granola workspace", accountEmail: email, externalAccountId: null, scopes: ["notes:read"] };
}

export const granolaConnector: BusinessConnector = {
  provider: "GRANOLA",
  sync: (ctx) => syncGranola(ctx),
  verifyKey: (key) => verifyGranolaKey(key),
};
