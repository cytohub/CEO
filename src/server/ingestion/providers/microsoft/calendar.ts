/**
 * Outlook Calendar adapter (Microsoft Graph, delegated `Calendars.Read`).
 *
 * `/me/calendarView/delta?startDateTime&endDateTime` returns occurrences in
 * the window; the deltaLink continues from there. calendarView delta windows
 * do not roll forward, so when the stored window has drifted more than 30
 * days we start a fresh listing (unchanged events are deduplicated by
 * content hash downstream).
 */
import { z } from "zod";
import type { EventStatus, ResponseStatus } from "@/generated/prisma/enums";
import { DAY_MS } from "@/lib/dates";
import { extractConferenceUrl } from "../../normalize/calendar";
import type { CalendarProvider, ChangeSet, NormalizedAttendee, NormalizedCalendarEvent, SyncCursor, WebhookSubscriber } from "../../types";
import { GRAPH, SUBSCRIPTION_MINUTES, createGraphSubscription, deleteGraphSubscription, graphDeltaPage, graphRecipient, parseGraphDateTime, recipientToParticipant } from "./graph";

const dateTimeTz = z.object({ dateTime: z.string(), timeZone: z.string().nullish() });

export const graphEventSchema = z.object({
  id: z.string(),
  "@removed": z.object({ reason: z.string().optional() }).optional(),
  iCalUId: z.string().nullish(),
  seriesMasterId: z.string().nullish(),
  type: z.string().nullish(),
  subject: z.string().nullish(),
  body: z.object({ contentType: z.string().nullish(), content: z.string().nullish() }).nullish(),
  bodyPreview: z.string().nullish(),
  start: dateTimeTz.nullish(),
  end: dateTimeTz.nullish(),
  isAllDay: z.boolean().nullish(),
  location: z.object({ displayName: z.string().nullish() }).nullish(),
  onlineMeeting: z.object({ joinUrl: z.string().nullish() }).nullish(),
  onlineMeetingUrl: z.string().nullish(),
  organizer: graphRecipient.nullish(),
  attendees: z.array(graphRecipient.extend({ status: z.object({ response: z.string().nullish() }).nullish(), type: z.string().nullish() })).nullish(),
  isCancelled: z.boolean().nullish(),
  isOrganizer: z.boolean().nullish(),
  responseStatus: z.object({ response: z.string().nullish() }).nullish(),
  lastModifiedDateTime: z.string().nullish(),
  webLink: z.string().nullish(),
  recurrence: z.unknown().nullish(),
  showAs: z.string().nullish(),
});
export type GraphEvent = z.infer<typeof graphEventSchema>;

const RESPONSE: Record<string, ResponseStatus> = {
  accepted: "ACCEPTED",
  declined: "DECLINED",
  tentativelyAccepted: "TENTATIVE",
  organizer: "ORGANIZER",
  none: "NEEDS_ACTION",
  notResponded: "NEEDS_ACTION",
};

/** Map a Graph event; `{ deleted }` for @removed entries, null for series masters. Pure. */
export function mapGraphEvent(e: GraphEvent): NormalizedCalendarEvent | { deleted: string } | null {
  if (e["@removed"]) return { deleted: e.id };
  // calendarView returns occurrences; a series master is not a meeting by itself.
  if (e.type === "seriesMaster" || !e.start || !e.end) return null;
  const attendees: NormalizedAttendee[] = [];
  for (const a of e.attendees ?? []) {
    if (a.type === "resource") continue;
    const p = recipientToParticipant(a);
    if (p) attendees.push({ ...p, responseStatus: RESPONSE[a.status?.response ?? "none"] ?? "NEEDS_ACTION", optional: a.type === "optional" });
  }
  const status: EventStatus = e.isCancelled ? "CANCELLED" : e.showAs === "tentative" ? "TENTATIVE" : "CONFIRMED";
  const own = e.isOrganizer ? "ORGANIZER" : (RESPONSE[e.responseStatus?.response ?? ""] ?? null);
  const description = e.body?.content?.trim() || e.bodyPreview?.trim() || null;
  const location = e.location?.displayName?.trim() || null;
  return {
    externalId: e.id,
    iCalUid: e.iCalUId ?? null,
    seriesId: e.seriesMasterId ?? null,
    title: e.subject?.trim() || "(no title)",
    description,
    startsAt: parseGraphDateTime(e.start.dateTime, e.start.timeZone),
    endsAt: parseGraphDateTime(e.end.dateTime, e.end.timeZone),
    allDay: Boolean(e.isAllDay),
    timezone: e.start.timeZone ?? null,
    location,
    conferenceUrl: e.onlineMeeting?.joinUrl ?? e.onlineMeetingUrl ?? extractConferenceUrl(location, description),
    organizer: recipientToParticipant(e.organizer),
    attendees,
    isRecurring: Boolean(e.seriesMasterId) || e.type === "occurrence" || e.type === "exception",
    recurrence: null,
    status,
    ceoResponse: own,
    updatedAt: e.lastModifiedDateTime ? new Date(e.lastModifiedDateTime) : null,
    webUrl: e.webLink ?? null,
    raw: e,
  };
}

const cursorSchema = z.object({
  deltaLink: z.string().optional(),
  nextLink: z.string().optional(),
  windowStart: z.string(),
  windowEnd: z.string(),
});

export const outlookCalendarProvider: CalendarProvider & WebhookSubscriber = {
  kind: "CALENDAR",

  async listChanges(ctx, cursor: SyncCursor | null, opts): Promise<ChangeSet<NormalizedCalendarEvent>> {
    const parsed = cursor ? cursorSchema.safeParse(cursor) : null;
    let state = parsed?.success ? parsed.data : null;
    // Restart when the fixed delta window has drifted too far behind "now".
    if (state && !state.nextLink && new Date(state.windowEnd).getTime() - opts.windowEnd.getTime() < -30 * DAY_MS) state = null;
    if (!state) state = { windowStart: opts.windowStart.toISOString(), windowEnd: opts.windowEnd.toISOString() };

    let url = state.nextLink ?? state.deltaLink;
    if (!url) {
      const u = new URL(`${GRAPH}/me/calendarView/delta`);
      u.searchParams.set("startDateTime", state.windowStart);
      u.searchParams.set("endDateTime", state.windowEnd);
      url = u.toString();
    }
    const page = await graphDeltaPage(ctx, url, graphEventSchema, {
      prefer: [`odata.maxpagesize=${Math.min(200, Math.max(10, opts.pageSize))}`, 'outlook.timezone="UTC"', 'outlook.body-content-type="text"'],
    });

    const items: NormalizedCalendarEvent[] = [];
    const deleted: string[] = [];
    for (const e of page.items) {
      const mapped = mapGraphEvent(e);
      if (!mapped) continue;
      if ("deleted" in mapped) deleted.push(mapped.deleted);
      else items.push(mapped);
    }
    const next = page.nextLink
      ? { ...state, nextLink: page.nextLink }
      : { windowStart: state.windowStart, windowEnd: state.windowEnd, deltaLink: page.deltaLink ?? state.deltaLink };
    return { items, deletedExternalIds: deleted, cursor: next, hasMore: Boolean(page.nextLink) };
  },

  subscribe(ctx, opts) {
    return createGraphSubscription(ctx, { resource: "me/events", changeType: "created,updated,deleted", minutes: SUBSCRIPTION_MINUTES.outlook, ...opts });
  },

  unsubscribe(ctx, channelId) {
    return deleteGraphSubscription(ctx, channelId);
  },
};
