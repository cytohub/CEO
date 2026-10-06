import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NormalizedCalendarEvent } from "../types";
import { calendarHashMaterial, calendarItemText, ceoResponseFrom, dedupeAttendees, extractConferenceUrl, normalizeCalendarEvent } from "./calendar";

function event(overrides: Partial<NormalizedCalendarEvent> = {}): NormalizedCalendarEvent {
  return {
    externalId: "evt-1",
    title: "Northbridge Ventures — partner meeting",
    description: "Earn a term sheet.",
    startsAt: new Date("2026-10-08T14:00:00Z"),
    endsAt: new Date("2026-10-08T15:30:00Z"),
    allDay: false,
    location: "Northbridge, Boston",
    organizer: { name: "Sarah Chen", email: "Sarah@Northbridge.example" },
    attendees: [
      { name: null, email: "CEO@cytohub.example", responseStatus: "ACCEPTED" },
      { name: "Sarah Chen", email: "sarah@northbridge.example", responseStatus: "ACCEPTED" },
      { name: "Jonas Weber", email: "jonas@cytohub.example", responseStatus: "NEEDS_ACTION" },
    ],
    isRecurring: false,
    status: "CONFIRMED",
    ...overrides,
  };
}

describe("dedupeAttendees", () => {
  it("lower-cases, merges duplicates, keeps the best name and response", () => {
    const out = dedupeAttendees([
      { name: null, email: "Jonas@CytoHub.example ", responseStatus: "NEEDS_ACTION", optional: true },
      { name: "Jonas Weber", email: "jonas@cytohub.example", responseStatus: "ACCEPTED" },
      { name: "Room", email: "not-an-email", responseStatus: "ACCEPTED" },
    ]);
    assert.deepEqual(out, [{ name: "Jonas Weber", email: "jonas@cytohub.example", responseStatus: "ACCEPTED", optional: false }]);
  });
});

describe("extractConferenceUrl", () => {
  it("finds Zoom, Meet and Teams links in free text", () => {
    assert.equal(extractConferenceUrl("Dial in: https://us02web.zoom.us/j/81234567890?pwd=abc. Thanks"), "https://us02web.zoom.us/j/81234567890?pwd=abc");
    assert.equal(extractConferenceUrl(null, "Join https://meet.google.com/abc-defg-hij"), "https://meet.google.com/abc-defg-hij");
    assert.equal(
      extractConferenceUrl("Join Microsoft Teams meeting: https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0 (link)"),
      "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0",
    );
    assert.equal(extractConferenceUrl("Office, 3rd floor", "https://example.com/agenda"), null);
  });
});

describe("ceoResponseFrom", () => {
  it("uses the account's attendee entry, or ORGANIZER", () => {
    const attendees = event().attendees;
    assert.equal(ceoResponseFrom(attendees, "ceo@cytohub.example"), "ACCEPTED");
    assert.equal(ceoResponseFrom(attendees, "ceo@cytohub.example", { name: null, email: "CEO@cytohub.example" }), "ORGANIZER");
    assert.equal(ceoResponseFrom(attendees, "someone@else.example"), null);
    assert.equal(ceoResponseFrom(attendees, null), null);
  });
});

describe("normalizeCalendarEvent", () => {
  it("normalizes attendees and organizer, fills conference URL and CEO response", () => {
    const out = normalizeCalendarEvent(event({ location: "Zoom https://zoom.us/j/123456789", conferenceUrl: null }), { accountEmail: "ceo@cytohub.example" });
    assert.equal(out.organizer?.email, "sarah@northbridge.example");
    assert.equal(out.attendees[0].email, "ceo@cytohub.example");
    assert.equal(out.conferenceUrl, "https://zoom.us/j/123456789");
    assert.equal(out.ceoResponse, "ACCEPTED");
  });

  it("keeps an adapter-provided response", () => {
    assert.equal(normalizeCalendarEvent(event({ ceoResponse: "DECLINED" }), { accountEmail: "ceo@cytohub.example" }).ceoResponse, "DECLINED");
  });
});

describe("item text and hash material", () => {
  it("includes title, description, location and attendee lines", () => {
    const text = calendarItemText(normalizeCalendarEvent(event(), { accountEmail: "ceo@cytohub.example" }));
    assert.match(text, /^Northbridge Ventures — partner meeting\n\nEarn a term sheet\./);
    assert.match(text, /Location: Northbridge, Boston/);
    assert.match(text, /- Jonas Weber <jonas@cytohub\.example> \(no response\)/);
  });

  it("changes when the time, status or a response changes — not when the order does", () => {
    const base = normalizeCalendarEvent(event(), { accountEmail: "ceo@cytohub.example" });
    const reordered = normalizeCalendarEvent(event({ attendees: [...event().attendees].reverse() }), { accountEmail: "ceo@cytohub.example" });
    assert.equal(calendarHashMaterial(base), calendarHashMaterial(reordered));
    const moved = normalizeCalendarEvent(event({ startsAt: new Date("2026-10-09T14:00:00Z") }), { accountEmail: "ceo@cytohub.example" });
    assert.notEqual(calendarHashMaterial(base), calendarHashMaterial(moved));
    const rsvp = event();
    rsvp.attendees[2] = { ...rsvp.attendees[2], responseStatus: "ACCEPTED" };
    assert.notEqual(calendarHashMaterial(base), calendarHashMaterial(normalizeCalendarEvent(rsvp, { accountEmail: "ceo@cytohub.example" })));
    assert.notEqual(calendarHashMaterial(base), calendarHashMaterial(normalizeCalendarEvent(event({ status: "CANCELLED" }), { accountEmail: "ceo@cytohub.example" })));
  });
});
