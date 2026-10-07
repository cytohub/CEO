/**
 * Calendar → Meeting. Important calendar events become (or update) Meeting
 * records — the objects Prepare Me, the Top 5 and the brief reason about.
 * Reschedules and cancellations are detected against the stored meeting,
 * clear the stale prep brief, write history and raise CHANGE insights.
 */
import { Prisma } from "@/generated/prisma/client";
import type { MeetingCategory } from "@/generated/prisma/enums";
import { MEETING_CATEGORIES } from "@/lib/intelligence";
import { companyShortName, normalizeCompanyName } from "../resolve/names";
import { upsertRelationship } from "../resolve/relationships";
import type { PipelineContext } from "../types";
import { actionSimilarity } from "./dedupe";
import { BRAIN_ACTOR, emptyCounters, emptySummary, noteCreated, noteUpdated, type WriteEnv } from "./env";
import { raiseChange } from "./changes";
import { recordActivity } from "./history";
import { matchGoal, type ItemCtx } from "./item";
import { FOCUS_BY_MEETING_CATEGORY, formatSlot, meetingPhrase, meetingTypeFor } from "./phrasing";
import { hasReferenceFrom, reference } from "./provenance";
import { lockBrainWrites } from "./lock";

function sameTitle(a: string, b: string): boolean {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  return na === nb || actionSimilarity(a, b) >= 0.75;
}

const DAY = 86_400_000;

export async function syncCalendarMeeting(w: ItemCtx): Promise<void> {
  const ev = w.item.calendarEvent;
  if (!ev) return;
  const { tx } = w;
  const category: MeetingCategory = ev.category ?? w.classification.meetingCategory ?? "OTHER";
  const attendees = w.resolution.people.filter((p) => !p.isCeo && (p.role === "ATTENDEE" || p.role === "ORGANIZER"));
  const external = attendees.filter((p) => w.refs.people.get(p.id)?.type !== "TEAM");
  const internal = attendees.length - external.length;
  const knownExternal = external.filter((p) => p.companyId && p.resolution !== "CREATED");
  const important = MEETING_CATEGORIES[category].important || knownExternal.length > 0 || ev.importance >= 4;
  const cancelled = ev.status === "CANCELLED" || ev.ceoResponse === "DECLINED";
  const externalId = `cal:${w.item.connectionId}:${ev.externalEventId}`;

  let meeting = ev.meetingId ? await tx.meeting.findUnique({ where: { id: ev.meetingId } }) : null;
  meeting ??= await tx.meeting.findUnique({ where: { externalId } });
  if (!meeting && (category === "PERSONAL" || cancelled || !important)) return;
  let adopted = false;
  if (!meeting) {
    // A meeting already in the workspace (seeded or typed in) for the same slot: adopt it rather than duplicate.
    const anchors = [ev.startsAt, ev.previousStartsAt].filter((d): d is Date => !!d);
    const candidates = await tx.meeting.findMany({
      // Not already owned by a calendar sync (`cal:` ids); seeded/manual meetings are fair game.
      where: {
        calendarEvent: { is: null },
        OR: [{ externalId: null }, { NOT: { externalId: { startsWith: "cal:" } } }],
        AND: [{ OR: anchors.map((a) => ({ startsAt: { gte: new Date(a.getTime() - DAY), lte: new Date(a.getTime() + DAY) } })) }],
      },
    });
    meeting = candidates.find((m) => sameTitle(m.title, ev.title)) ?? null;
    adopted = !!meeting;
  }

  const primary = w.resolution.primaryCompanyId;
  const company = primary ? w.refs.companies.get(primary) : null;
  const objectiveFromDescription = /(?:^|\n)\s*(?:objective|goal|purpose)\s*:\s*(.+)/i.exec(ev.description ?? "")?.[1]?.trim().slice(0, 500) ?? null;
  const computedImportance = Math.max(ev.importance, important ? 4 : 3, category === "BOARD" ? 5 : 0);
  const location = ev.location ?? ev.conferenceUrl ?? null;
  const attendeeIds = attendees.map((p) => p.id);

  if (!meeting) {
    const goalId = await goalFor(w, primary);
    const m = await tx.meeting.create({
      data: {
        title: ev.title.slice(0, 300),
        type: meetingTypeFor(category, internal, external.length),
        category,
        focusArea: FOCUS_BY_MEETING_CATEGORY[category],
        startsAt: ev.startsAt,
        endsAt: ev.endsAt,
        location,
        description: ev.description?.slice(0, 4000) ?? null,
        objective: objectiveFromDescription,
        importance: Math.min(5, computedImportance),
        source: "CALENDAR",
        externalId,
        companyId: primary,
        goalId,
        status: "SCHEDULED",
        ...(attendeeIds.length ? { attendees: { connect: attendeeIds.map((id) => ({ id })) } } : {}),
        createdAt: w.now,
      },
    });
    await recordActivity(w, "ENTITY_CREATED", `Meeting added from the calendar: ${m.title}`, { meetingId: m.id, companyId: primary, goalId }, { entity: "MEETING", startsAt: m.startsAt.toISOString() });
    await reference(w, "MEETING", m.id, "CREATED_FROM", { excerpt: `${ev.title} — ${ev.startsAt.toISOString()}` });
    noteCreated(w, "MEETING", m.id);
    await linkEvent(w, m.id, primary);
    w.meetingId = m.id;
    w.written.meeting = { id: m.id, important, rescheduled: false, cancelled: false };
    return;
  }

  // Existing meeting: apply changes.
  const patch: Prisma.MeetingUncheckedUpdateInput = {};
  let changed = false;
  let rescheduled = false;
  let wasCancelled = false;
  const fromStart = meeting.startsAt;
  if (Math.abs(meeting.startsAt.getTime() - ev.startsAt.getTime()) >= 60_000 && !cancelled) {
    Object.assign(patch, { startsAt: ev.startsAt, endsAt: ev.endsAt, prepBrief: Prisma.DbNull, preparedAt: null });
    rescheduled = true;
  } else if (Math.abs(meeting.endsAt.getTime() - ev.endsAt.getTime()) >= 60_000 && !cancelled) {
    patch.endsAt = ev.endsAt;
  }
  if (cancelled && meeting.status !== "CANCELLED") {
    patch.status = "CANCELLED";
    wasCancelled = true;
  } else if (!cancelled && meeting.status === "CANCELLED") {
    patch.status = ev.endsAt <= w.now ? "COMPLETED" : "SCHEDULED";
  }
  if (!meeting.externalId) patch.externalId = externalId;
  if (!meeting.category) patch.category = category;
  if (!meeting.companyId && primary) patch.companyId = primary;
  if (!meeting.goalId) {
    const goalId = await goalFor(w, primary ?? meeting.companyId);
    if (goalId) patch.goalId = goalId;
  }
  if (!meeting.objective && objectiveFromDescription) patch.objective = objectiveFromDescription;
  if (computedImportance > meeting.importance) patch.importance = Math.min(5, computedImportance);
  if (location && location !== meeting.location) patch.location = location;
  if (!adopted && ev.title !== meeting.title) patch.title = ev.title.slice(0, 300);
  if (!adopted && (ev.description ?? null) !== meeting.description) patch.description = ev.description?.slice(0, 4000) ?? null;
  if (attendeeIds.length) {
    const existing = new Set((await tx.meeting.findUnique({ where: { id: meeting.id }, select: { attendees: { select: { id: true } } } }))?.attendees.map((a) => a.id) ?? []);
    const add = attendeeIds.filter((id) => !existing.has(id));
    if (add.length) patch.attendees = { connect: add.map((id) => ({ id })) } as Prisma.MeetingUncheckedUpdateInput["attendees"];
  }
  changed = Object.keys(patch).length > 0;
  if (changed) await tx.meeting.update({ where: { id: meeting.id }, data: patch });

  const meetingImportant = important || meeting.importance >= 4;
  if (rescheduled) {
    const actor = rescheduler(w, company?.name ?? null);
    const far = Math.abs(ev.startsAt.getTime() - fromStart.getTime()) > 6 * DAY || Math.abs(ev.startsAt.getTime() - w.now.getTime()) > 6 * DAY;
    const from = formatSlot(fromStart, w.timezone, far);
    const to = formatSlot(ev.startsAt, w.timezone, far);
    await recordActivity(w, "MEETING_RESCHEDULED", `Meeting rescheduled: ${meeting.title} — ${from} → ${to}`, { meetingId: meeting.id, companyId: meeting.companyId ?? primary }, { from: fromStart.toISOString(), to: ev.startsAt.toISOString() });
    if (meetingImportant) {
      await raiseChange(w, {
        changeKind: "meeting_rescheduled",
        fingerprint: `change:meeting_rescheduled:${meeting.id}:${ev.startsAt.toISOString()}`,
        title: `Important change: ${actor} moved ${meetingPhrase(meeting.title, company?.name ?? null)} from ${from} to ${to}`,
        summary: `${meeting.title} now starts ${formatSlot(ev.startsAt, w.timezone, true)}. The prep brief was cleared and will be rebuilt for the new slot.`,
        recommendation: "Check for conflicts on the new slot, confirm attendees, and re-run Prepare Me closer to the meeting.",
        importance: Math.max(4, meeting.importance),
        requiresCeo: true,
        links: { meetingId: meeting.id, companyId: meeting.companyId ?? primary, goalId: meeting.goalId },
        excerpt: `${ev.title}: ${fromStart.toISOString()} → ${ev.startsAt.toISOString()}`,
      });
    }
  }
  if (wasCancelled) {
    await recordActivity(w, "MEETING_CANCELLED", `Meeting cancelled: ${meeting.title}`, { meetingId: meeting.id, companyId: meeting.companyId ?? primary }, { from: meeting.status, to: "CANCELLED", declined: ev.ceoResponse === "DECLINED" });
    if (meetingImportant) {
      await raiseChange(w, {
        changeKind: "meeting_cancelled",
        fingerprint: `change:meeting_cancelled:${meeting.id}`,
        title: `Important change: ${meeting.title} (${formatSlot(meeting.startsAt, w.timezone, true)}) was cancelled`,
        summary: ev.ceoResponse === "DECLINED" ? "You declined the invitation." : `${rescheduler(w, company?.name ?? null)} cancelled the meeting.`,
        recommendation: "Decide whether it needs a new slot, and follow up on anything that was meant to be settled there.",
        importance: Math.max(4, meeting.importance),
        requiresCeo: meeting.importance >= 4,
        links: { meetingId: meeting.id, companyId: meeting.companyId ?? primary, goalId: meeting.goalId },
        excerpt: ev.title,
      });
    }
  }
  if (changed || !(await hasReferenceFrom(tx, "MEETING", meeting.id, w.item.id))) {
    await reference(w, "MEETING", meeting.id, adopted ? "CORROBORATED_BY" : "UPDATED_FROM", { excerpt: `${ev.title} — ${ev.startsAt.toISOString()}` });
  }
  if (changed) noteUpdated(w, "MEETING", meeting.id);
  await linkEvent(w, meeting.id, primary ?? meeting.companyId);
  w.meetingId = meeting.id;
  w.written.meeting = { id: meeting.id, important: meetingImportant, rescheduled, cancelled: wasCancelled };
}

/** Who moved/cancelled it: "You", the organizer's company ("Northbridge"), or their name. */
function rescheduler(w: ItemCtx, companyName: string | null): string {
  const ev = w.item.calendarEvent!;
  if (ev.organizerEmail && w.ceo.email && ev.organizerEmail.toLowerCase() === w.ceo.email.toLowerCase()) return "You";
  const organizer = w.resolution.people.find((p) => p.role === "ORGANIZER");
  const orgCompany = organizer?.companyId ? w.refs.companies.get(organizer.companyId)?.name : null;
  if (orgCompany) return companyShortName(orgCompany);
  if (ev.organizerName) return ev.organizerName;
  return companyName ? companyShortName(companyName) : "The organizer";
}

function goalFor(w: ItemCtx, companyId: string | null): Promise<string | null> {
  return matchGoal(w, companyId);
}

/** Link the calendar event to its meeting and to the email thread it most likely belongs to. */
async function linkEvent(w: ItemCtx, meetingId: string, companyId: string | null) {
  const ev = w.item.calendarEvent!;
  const data: Prisma.CalendarEventUncheckedUpdateInput = {};
  if (ev.meetingId !== meetingId) {
    // The unique link may be held by a stale event for the same meeting (e.g. re-created upstream).
    await w.tx.calendarEvent.updateMany({ where: { meetingId, id: { not: ev.id } }, data: { meetingId: null } });
    data.meetingId = meetingId;
  }
  if (!ev.relatedThreadId && companyId) {
    const threads = await w.tx.emailThread.findMany({
      where: { companyId, lastMessageAt: { gte: new Date(w.now.getTime() - 30 * DAY) } },
      select: { id: true, subject: true, lastMessageAt: true },
      orderBy: { lastMessageAt: "desc" },
      take: 20,
    });
    const best = threads.map((t) => ({ t, s: actionSimilarity(t.subject, ev.title) })).sort((a, b) => b.s - a.s || b.t.lastMessageAt.getTime() - a.t.lastMessageAt.getTime())[0];
    if (best && (best.s >= 0.2 || threads.length === 1)) data.relatedThreadId = best.t.id;
  }
  if (Object.keys(data).length) await w.tx.calendarEvent.update({ where: { id: ev.id }, data });
  for (const p of w.resolution.people) {
    if (p.isCeo || (p.role !== "ATTENDEE" && p.role !== "ORGANIZER")) continue;
    await upsertRelationship(w.tx, { fromType: "PERSON", fromId: p.id, relation: "ATTENDED", toType: "MEETING", toId: meetingId, confidence: 0.9, sourceItemId: w.item.id, at: ev.startsAt < w.now ? ev.startsAt : w.now });
  }
}

/** Meeting notes were processed: the meeting happened. */
export async function completeMeetingFromNotes(w: ItemCtx, meetingId: string) {
  const m = await w.tx.meeting.findUnique({ where: { id: meetingId }, select: { id: true, title: true, status: true, companyId: true, endsAt: true } });
  if (!m) return;
  await w.tx.meeting.update({ where: { id: m.id }, data: { notesProcessedAt: w.now, ...(m.status === "SCHEDULED" ? { status: "COMPLETED" } : {}) } });
  if (m.status === "SCHEDULED") noteUpdated(w, "MEETING", m.id);
  const occurred = await w.tx.activity.count({ where: { meetingId: m.id, type: "MEETING_OCCURRED" } });
  if (!occurred) await recordActivity(w, "MEETING_OCCURRED", `Meeting held: ${m.title}`, { meetingId: m.id, companyId: m.companyId }, { from: m.status, to: "COMPLETED", via: "notes" });
  if (!(await hasReferenceFrom(w.tx, "MEETING", m.id, w.item.id))) await reference(w, "MEETING", m.id, "UPDATED_FROM", { excerpt: w.extraction.summary || null });
}

/** Mark meetings that have ended as COMPLETED (MEETING_OCCURRED history). Returns how many changed. */
export async function markCompletedMeetings(ctx: PipelineContext): Promise<number> {
  const ended = await ctx.db.meeting.findMany({ where: { status: "SCHEDULED", endsAt: { lte: ctx.now } }, select: { id: true, title: true, endsAt: true, companyId: true }, take: 500 });
  if (!ended.length) return 0;
  return ctx.db.$transaction(
    async (tx) => {
      await lockBrainWrites(tx);
      const env: WriteEnv = {
        tx,
        now: ctx.now,
        today: ctx.ceo.today,
        timezone: ctx.ceo.timezone,
        ceo: { personId: ctx.ceo.personId, userId: ctx.ceo.userId, name: ctx.ceo.name, email: ctx.ceo.email },
        actor: BRAIN_ACTOR,
        source: null,
        engine: null,
        relevance: null,
        summary: emptySummary(),
        counters: emptyCounters(),
      };
      let n = 0;
      for (const m of ended) {
        // Guarded update: concurrent refreshes cannot both complete (and log) the same meeting.
        const claimed = await tx.meeting.updateMany({ where: { id: m.id, status: "SCHEDULED" }, data: { status: "COMPLETED" } });
        if (!claimed.count) continue;
        n++;
        const logged = await tx.activity.count({ where: { meetingId: m.id, type: "MEETING_OCCURRED" } });
        if (!logged) await recordActivity(env, "MEETING_OCCURRED", `Meeting held: ${m.title}`, { meetingId: m.id, companyId: m.companyId }, { from: "SCHEDULED", to: "COMPLETED" }, { at: m.endsAt });
      }
      return n;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
}
