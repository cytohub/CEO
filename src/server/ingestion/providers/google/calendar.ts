/**
 * Google Calendar adapter (read-only, `calendar.readonly`), primary calendar.
 *
 *   initial:      events.list singleEvents=true within the sync window
 *   incremental:  events.list syncToken (deleted events arrive as status
 *                 "cancelled"); 410 → CursorExpiredError. If Google returns
 *                 no syncToken for a windowed listing we fall back to
 *                 updatedMin polling inside the window.
 *   push:         events.watch channel (token = per-connection secret)
 */
import { z } from "zod";
import type { EventStatus, ResponseStatus } from "@/generated/prisma/enums";
import { DAY_MS, dayFromKey, dayStartInstant } from "@/lib/dates";
import { extractConferenceUrl } from "../../normalize/calendar";
import { CursorExpiredError, type CalendarProvider, type ChangeSet, type NormalizedAttendee, type NormalizedCalendarEvent, type SyncCursor, type WebhookSubscriber } from "../../types";
import { ProviderHttpError, providerJson } from "../http";
import { stopChannel, watchChannel } from "./channels";

const CAL = "https://www.googleapis.com/calendar/v3";

const timeSchema = z.object({ dateTime: z.string().optional(), date: z.string().optional(), timeZone: z.string().optional() });
const personSchema = z.object({ email: z.string().optional(), displayName: z.string().optional(), self: z.boolean().optional() });

export const googleEventSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  htmlLink: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  start: timeSchema.optional(),
  end: timeSchema.optional(),
  iCalUID: z.string().optional(),
  recurringEventId: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  organizer: personSchema.optional(),
  attendees: z
    .array(
      personSchema.extend({
        responseStatus: z.string().optional(),
        optional: z.boolean().optional(),
        resource: z.boolean().optional(),
        organizer: z.boolean().optional(),
      }),
    )
    .optional(),
  hangoutLink: z.string().optional(),
  conferenceData: z.object({ entryPoints: z.array(z.object({ entryPointType: z.string().optional(), uri: z.string().optional() })).optional() }).optional(),
  updated: z.string().optional(),
  eventType: z.string().optional(),
  attachments: z.array(z.object({ fileUrl: z.string().optional(), title: z.string().optional(), mimeType: z.string().optional() })).optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;

const listSchema = z.object({
  items: z.array(googleEventSchema).optional(),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(),
  timeZone: z.string().optional(),
});

const cursorSchema = z.object({
  syncToken: z.string().optional(),
  pageToken: z.string().optional(),
  /** Fallback when no syncToken is issued: poll by update time inside the window. */
  updatedMin: z.string().optional(),
  windowStart: z.string().optional(),
  windowEnd: z.string().optional(),
  /** Set while paging a listing; becomes updatedMin when no syncToken comes back. */
  listingStartedAt: z.string().optional(),
  timeZone: z.string().optional(),
});
type GoogleCalendarCursor = z.infer<typeof cursorSchema>;

const RESPONSE: Record<string, ResponseStatus> = { accepted: "ACCEPTED", declined: "DECLINED", tentative: "TENTATIVE", needsAction: "NEEDS_ACTION" };
const STATUS: Record<string, EventStatus> = { confirmed: "CONFIRMED", tentative: "TENTATIVE", cancelled: "CANCELLED" };

/** Event types that are not meetings. */
const SKIPPED_TYPES = new Set(["workingLocation", "outOfOffice", "focusTime", "birthday", "fromGmail"]);

function toInstant(t: z.infer<typeof timeSchema> | undefined, fallbackTz: string): { at: Date; allDay: boolean } | null {
  if (!t) return null;
  if (t.dateTime) {
    const ms = Date.parse(t.dateTime);
    return Number.isNaN(ms) ? null : { at: new Date(ms), allDay: false };
  }
  if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) {
    // All-day: local midnight in the event's (or calendar's) timezone.
    return { at: dayStartInstant(dayFromKey(t.date), t.timeZone ?? fallbackTz), allDay: true };
  }
  return null;
}

/**
 * Map a Google event. Returns `{ deleted }` for cancelled entries that carry
 * no times (deleted events in an incremental sync), null for skipped types.
 */
export function mapGoogleEvent(e: GoogleEvent, opts: { calendarTimeZone: string }): NormalizedCalendarEvent | { deleted: string } | null {
  if (e.eventType && SKIPPED_TYPES.has(e.eventType)) return null;
  const start = toInstant(e.start, opts.calendarTimeZone);
  const end = toInstant(e.end, opts.calendarTimeZone);
  if (!start || !end) return e.status === "cancelled" ? { deleted: e.id } : null;

  const attendees: NormalizedAttendee[] = (e.attendees ?? [])
    .filter((a) => a.email && !a.resource)
    .map((a) => ({ name: a.displayName ?? null, email: a.email!.toLowerCase(), responseStatus: RESPONSE[a.responseStatus ?? ""] ?? "NEEDS_ACTION", optional: Boolean(a.optional) }));
  const self = (e.attendees ?? []).find((a) => a.self);
  const ceoResponse: ResponseStatus | null = e.organizer?.self && (!self || self.organizer) ? "ORGANIZER" : self ? (RESPONSE[self.responseStatus ?? ""] ?? "NEEDS_ACTION") : null;
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video" && p.uri)?.uri;

  return {
    externalId: e.id,
    iCalUid: e.iCalUID ?? null,
    seriesId: e.recurringEventId ?? (e.recurrence?.length ? e.id : null),
    title: e.summary?.trim() || "(no title)",
    description: e.description ?? null,
    startsAt: start.at,
    endsAt: end.at,
    allDay: start.allDay,
    timezone: e.start?.timeZone ?? opts.calendarTimeZone,
    location: e.location ?? null,
    conferenceUrl: e.hangoutLink ?? video ?? extractConferenceUrl(e.location, e.description),
    organizer: e.organizer?.email ? { name: e.organizer.displayName ?? null, email: e.organizer.email.toLowerCase() } : null,
    attendees,
    isRecurring: Boolean(e.recurringEventId || e.recurrence?.length),
    recurrence: e.recurrence?.join("\n") ?? null,
    status: STATUS[e.status ?? "confirmed"] ?? "CONFIRMED",
    ceoResponse,
    updatedAt: e.updated ? new Date(e.updated) : null,
    webUrl: e.htmlLink ?? null,
    attachments: (e.attachments ?? []).map((a) => ({ title: a.title ?? "Attachment", url: a.fileUrl ?? null, mimeType: a.mimeType ?? null })),
    raw: e,
  };
}

function parseCursor(cursor: SyncCursor | null): GoogleCalendarCursor | null {
  if (!cursor) return null;
  const parsed = cursorSchema.safeParse(cursor);
  return parsed.success ? parsed.data : null;
}

export const googleCalendarProvider: CalendarProvider & WebhookSubscriber = {
  kind: "CALENDAR",

  async listChanges(ctx, cursor, opts): Promise<ChangeSet<NormalizedCalendarEvent>> {
    const state = parseCursor(cursor) ?? {};
    // Keep the window fixed while paging one listing; otherwise roll it forward with time.
    const paging = Boolean(state.pageToken);
    const windowStart = paging && state.windowStart ? state.windowStart : opts.windowStart.toISOString();
    const windowEnd = paging && state.windowEnd ? state.windowEnd : opts.windowEnd.toISOString();
    const incremental = Boolean(state.syncToken);
    const query: Record<string, string | number | boolean | undefined> = {
      singleEvents: true,
      maxResults: Math.min(2500, Math.max(50, opts.pageSize)),
      pageToken: state.pageToken,
    };
    if (incremental) {
      query.syncToken = state.syncToken;
    } else {
      query.timeMin = windowStart;
      query.timeMax = windowEnd;
      query.showDeleted = true;
      if (state.updatedMin) query.updatedMin = state.updatedMin;
    }

    let res: z.infer<typeof listSchema>;
    try {
      res = await providerJson(ctx, `${CAL}/calendars/primary/events`, listSchema, { query });
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 410) throw new CursorExpiredError("Google Calendar sync token expired; full resync required");
      throw error;
    }

    const calendarTimeZone = res.timeZone ?? state.timeZone ?? "UTC";
    const items: NormalizedCalendarEvent[] = [];
    const deleted: string[] = [];
    // Incremental results are not window-bounded; ignore far-away instances of long series.
    const lo = ctx.now.getTime() - 400 * DAY_MS;
    const hi = ctx.now.getTime() + 400 * DAY_MS;
    for (const e of res.items ?? []) {
      const mapped = mapGoogleEvent(e, { calendarTimeZone });
      if (!mapped) continue;
      if ("deleted" in mapped) deleted.push(mapped.deleted);
      else if (mapped.startsAt.getTime() >= lo && mapped.startsAt.getTime() <= hi) items.push(mapped);
    }

    const listingStartedAt = state.listingStartedAt ?? ctx.now.toISOString();
    if (res.nextPageToken) {
      return {
        items,
        deletedExternalIds: deleted,
        cursor: { ...state, windowStart, windowEnd, pageToken: res.nextPageToken, listingStartedAt, timeZone: calendarTimeZone },
        hasMore: true,
      };
    }
    const next: GoogleCalendarCursor = res.nextSyncToken
      ? { syncToken: res.nextSyncToken, windowStart, windowEnd, timeZone: calendarTimeZone }
      : { updatedMin: listingStartedAt, windowStart, windowEnd, timeZone: calendarTimeZone };
    return { items, deletedExternalIds: deleted, cursor: next, hasMore: false };
  },

  subscribe(ctx, opts) {
    return watchChannel(ctx, `${CAL}/calendars/primary/events/watch`, { ...opts, ttlSeconds: 7 * 24 * 3600 });
  },

  unsubscribe(ctx, channelId) {
    return stopChannel(ctx, `${CAL}/channels/stop`, channelId);
  },
};
