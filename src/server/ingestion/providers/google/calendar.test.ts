import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CursorExpiredError, type NormalizedCalendarEvent } from "../../types";
import { fakeContext, json, routes, stubFetch } from "../test-helpers";
import { type GoogleEvent, googleCalendarProvider, mapGoogleEvent } from "./calendar";

const event: GoogleEvent = {
  id: "abc123_20261008T140000Z",
  status: "confirmed",
  htmlLink: "https://www.google.com/calendar/event?eid=abc",
  summary: "Northbridge Ventures — partner meeting",
  description: "Agenda: retention cohorts, dataset moat.",
  location: "Northbridge, Boston",
  start: { dateTime: "2026-10-08T10:00:00-04:00", timeZone: "America/New_York" },
  end: { dateTime: "2026-10-08T11:30:00-04:00", timeZone: "America/New_York" },
  iCalUID: "abc123@google.com",
  recurringEventId: "abc123",
  organizer: { email: "Sarah@Northbridge.example", displayName: "Sarah Chen" },
  attendees: [
    { email: "ceo@cytohub.example", self: true, responseStatus: "tentative" },
    { email: "sarah@northbridge.example", displayName: "Sarah Chen", organizer: true, responseStatus: "accepted" },
    { email: "jonas@cytohub.example", displayName: "Jonas Weber", responseStatus: "needsAction", optional: true },
    { email: "room-4@resource.calendar.google.com", resource: true, responseStatus: "accepted" },
  ],
  hangoutLink: "https://meet.google.com/abc-defg-hij",
  updated: "2026-10-05T12:00:00.000Z",
};

describe("mapGoogleEvent", () => {
  it("maps times, attendees (minus rooms), the account's own response and the Meet link", () => {
    const e = mapGoogleEvent(event, { calendarTimeZone: "America/New_York" }) as NormalizedCalendarEvent;
    assert.equal(e.startsAt.toISOString(), "2026-10-08T14:00:00.000Z");
    assert.equal(e.endsAt.toISOString(), "2026-10-08T15:30:00.000Z");
    assert.equal(e.allDay, false);
    assert.equal(e.seriesId, "abc123");
    assert.equal(e.isRecurring, true);
    assert.equal(e.status, "CONFIRMED");
    assert.equal(e.ceoResponse, "TENTATIVE");
    assert.equal(e.conferenceUrl, "https://meet.google.com/abc-defg-hij");
    assert.deepEqual(
      e.attendees.map((a) => [a.email, a.responseStatus, a.optional]),
      [
        ["ceo@cytohub.example", "TENTATIVE", false],
        ["sarah@northbridge.example", "ACCEPTED", false],
        ["jonas@cytohub.example", "NEEDS_ACTION", true],
      ],
    );
    assert.deepEqual(e.organizer, { name: "Sarah Chen", email: "sarah@northbridge.example" });
  });

  it("handles all-day events in the calendar timezone, conferenceData links and organizer-self", () => {
    const e = mapGoogleEvent(
      {
        id: "allday",
        summary: "BIO-Europe",
        start: { date: "2026-10-22" },
        end: { date: "2026-10-23" },
        organizer: { email: "ceo@cytohub.example", self: true },
        conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://zoom.us/j/999" }] },
      },
      { calendarTimeZone: "America/New_York" },
    ) as NormalizedCalendarEvent;
    assert.equal(e.allDay, true);
    assert.equal(e.startsAt.toISOString(), "2026-10-22T04:00:00.000Z");
    assert.equal(e.conferenceUrl, "https://zoom.us/j/999");
    assert.equal(e.ceoResponse, "ORGANIZER");
  });

  it("cancelled events keep their times when present; bare cancellations become deletions", () => {
    assert.equal((mapGoogleEvent({ ...event, status: "cancelled" }, { calendarTimeZone: "UTC" }) as NormalizedCalendarEvent).status, "CANCELLED");
    assert.deepEqual(mapGoogleEvent({ id: "gone", status: "cancelled" }, { calendarTimeZone: "UTC" }), { deleted: "gone" });
    assert.equal(mapGoogleEvent({ ...event, eventType: "workingLocation" }, { calendarTimeZone: "UTC" }), null);
  });
});

describe("googleCalendarProvider.listChanges", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());
  const opts = { pageSize: 100, windowStart: new Date("2026-07-08T00:00:00Z"), windowEnd: new Date("2027-04-04T00:00:00Z") };

  it("lists the window, pages, then stores the sync token; incremental uses it", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/calendars\/primary\/events$/,
          (req) => {
            if (req.url.searchParams.get("syncToken")) return json({ items: [{ id: "gone", status: "cancelled" }], nextSyncToken: "sync-2", timeZone: "America/New_York" });
            if (req.url.searchParams.get("pageToken")) return json({ items: [{ ...event, id: "e2" }], nextSyncToken: "sync-1", timeZone: "America/New_York" });
            return json({ items: [event], nextPageToken: "page-2", timeZone: "America/New_York" });
          },
        ],
      ]),
    );
    restore = stub.restore;
    const ctx = fakeContext({ provider: "GOOGLE_CALENDAR" });
    const p1 = await googleCalendarProvider.listChanges(ctx, null, opts);
    assert.equal(p1.hasMore, true);
    assert.equal(stub.requests[0].url.searchParams.get("singleEvents"), "true");
    assert.equal(stub.requests[0].url.searchParams.get("timeMin"), opts.windowStart.toISOString());
    const p2 = await googleCalendarProvider.listChanges(ctx, p1.cursor, opts);
    assert.equal(p2.hasMore, false);
    assert.equal(p2.cursor.syncToken, "sync-1");
    const p3 = await googleCalendarProvider.listChanges(ctx, p2.cursor, opts);
    assert.deepEqual(p3.deletedExternalIds, ["gone"]);
    assert.equal(stub.requests[2].url.searchParams.get("timeMin"), null, "no window with a sync token");
    assert.equal(p3.cursor.syncToken, "sync-2");
  });

  it("410 Gone → CursorExpiredError", async () => {
    restore = stubFetch(routes([["GET", /\/events$/, () => json({ error: { code: 410, errors: [{ reason: "fullSyncRequired" }] } }, { status: 410 })]])).restore;
    await assert.rejects(() => googleCalendarProvider.listChanges(fakeContext(), { syncToken: "old" }, opts), CursorExpiredError);
  });
});
