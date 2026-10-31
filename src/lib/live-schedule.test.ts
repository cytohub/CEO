import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayFromKey, minuteOfDayInTz, zonedInstant } from "./dates";
import { brainSlots, dueBrainSlot, inWorkHours, nextBrainSlot, nextWorkHoursInstant } from "./live-schedule";

const NY = "America/New_York";
const at = (iso: string) => new Date(iso);

describe("local wall-clock helpers", () => {
  it("finds the instant of a local time, including across DST", () => {
    assert.equal(zonedInstant(dayFromKey("2026-10-06"), 7 * 60, NY).toISOString(), "2026-10-06T11:00:00.000Z");
    // US clocks fall back on Nov 1, 2026: 07:00 is now UTC-5.
    assert.equal(zonedInstant(dayFromKey("2026-11-02"), 7 * 60, NY).toISOString(), "2026-11-02T12:00:00.000Z");
  });

  it("reads minutes after local midnight", () => {
    assert.equal(minuteOfDayInTz(at("2026-10-06T13:15:00Z"), NY), 9 * 60 + 15);
    assert.equal(minuteOfDayInTz(at("2026-10-07T02:30:00Z"), NY), 22 * 60 + 30);
  });
});

describe("work hours (weekdays, 7 AM–7 PM)", () => {
  it("knows when it is inside the window", () => {
    assert.equal(inWorkHours(at("2026-10-06T12:00:00Z"), NY), true); // Tue 08:00
    assert.equal(inWorkHours(at("2026-10-06T10:59:00Z"), NY), false); // Tue 06:59
    assert.equal(inWorkHours(at("2026-10-06T23:00:00Z"), NY), false); // Tue 19:00
    assert.equal(inWorkHours(at("2026-10-10T16:00:00Z"), NY), false); // Sat 12:00
  });

  it("moves anything outside the window to the next opening", () => {
    assert.equal(nextWorkHoursInstant(at("2026-10-06T14:00:00Z"), NY).toISOString(), "2026-10-06T14:00:00.000Z");
    assert.equal(nextWorkHoursInstant(at("2026-10-06T09:00:00Z"), NY).toISOString(), "2026-10-06T11:00:00.000Z"); // Tue 05:00 → 07:00
    assert.equal(nextWorkHoursInstant(at("2026-10-11T16:00:00Z"), NY).toISOString(), "2026-10-12T11:00:00.000Z"); // Sun → Mon 07:00
  });
});

describe("Brain schedule", () => {
  it("runs the morning brief daily and hourly through the working day", () => {
    assert.deepEqual(brainSlots(dayFromKey("2026-10-10")), [390]);
    const weekday = brainSlots(dayFromKey("2026-10-06"));
    assert.equal(weekday[0], 390);
    assert.deepEqual(weekday.slice(1), [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((h) => h * 60));
  });

  it("names the slot that is due", () => {
    assert.equal(dueBrainSlot(at("2026-10-06T10:00:00Z"), NY), null); // Tue 06:00, before the brief
    assert.deepEqual(dueBrainSlot(at("2026-10-06T10:45:00Z"), NY), { key: "2026-10-06T0630", at: at("2026-10-06T10:30:00Z") });
    assert.deepEqual(dueBrainSlot(at("2026-10-06T13:15:00Z"), NY), { key: "2026-10-06T0900", at: at("2026-10-06T13:00:00Z") });
    assert.equal(dueBrainSlot(at("2026-10-10T19:00:00Z"), NY)?.key, "2026-10-10T0630"); // Saturday: only the brief
  });

  it("knows the next update", () => {
    assert.equal(nextBrainSlot(at("2026-10-06T13:15:00Z"), NY).toISOString(), "2026-10-06T14:00:00.000Z"); // → 10:00
    assert.equal(nextBrainSlot(at("2026-10-06T23:30:00Z"), NY).toISOString(), "2026-10-07T10:30:00.000Z"); // → Wed 06:30
    assert.equal(nextBrainSlot(at("2026-10-09T23:30:00Z"), NY).toISOString(), "2026-10-10T10:30:00.000Z"); // Fri → Sat 06:30
  });
});
