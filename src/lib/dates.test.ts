import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifySignal } from "@/server/brain/analyzers/signals";
import { addDays, dayFromKey, dayKey, dayKeyInTz, dayStartInstant, daysBetween, formatDay, relativeDay, startOfWeek, today, tzOffsetMinutes } from "./dates";

describe("calendar days", () => {
  it("round-trips keys", () => {
    assert.equal(dayKey(dayFromKey("2026-10-06")), "2026-10-06");
  });

  it("resolves 'today' in the CEO's timezone, not the server's", () => {
    // 02:30 UTC on Oct 7 is still Oct 6 in New York.
    const instant = new Date("2026-10-07T02:30:00Z");
    assert.equal(dayKey(today("America/New_York", instant)), "2026-10-06");
    assert.equal(dayKey(today("Europe/Copenhagen", instant)), "2026-10-07");
  });

  it("formats calendar days without timezone drift", () => {
    assert.equal(formatDay(dayFromKey("2026-10-06")), "Oct 6");
  });

  it("computes whole-day differences", () => {
    const d = dayFromKey("2026-10-06");
    assert.equal(daysBetween(d, addDays(d, 10)), 10);
    assert.equal(daysBetween(addDays(d, 3), d), -3);
  });

  it("finds Monday as the start of the week", () => {
    assert.equal(dayKey(startOfWeek(dayFromKey("2026-10-11"))), "2026-10-05"); // Sunday
    assert.equal(dayKey(startOfWeek(dayFromKey("2026-10-05"))), "2026-10-05"); // Monday
  });

  it("labels relative days", () => {
    const d = dayFromKey("2026-10-06");
    assert.equal(relativeDay(d, d), "Today");
    assert.equal(relativeDay(addDays(d, 1), d), "Tomorrow");
    assert.equal(relativeDay(addDays(d, -4), d), "4d overdue");
  });

  it("maps a local day to its starting instant across DST", () => {
    const start = dayStartInstant(dayFromKey("2026-11-01"), "America/New_York"); // DST ends that day
    assert.equal(dayKeyInTz(start, "America/New_York"), "2026-11-01");
    assert.equal(dayKeyInTz(new Date(start.getTime() - 1000), "America/New_York"), "2026-10-31");
    assert.equal(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "America/New_York"), -240);
  });
});

describe("signal classification fallback", () => {
  it("recognizes escalations, approvals and investor requests", () => {
    assert.equal(classifySignal({ kind: "EMAIL", title: "Urgent: escalation on assay turnaround", body: null }), "escalation");
    assert.equal(classifySignal({ kind: "EMAIL", title: "Approval needed for Q4 budget", body: null }), "approval_request");
    assert.equal(classifySignal({ kind: "EMAIL", title: "Next steps", body: "Could you share data room access before diligence?" }), "investor_request");
    assert.equal(classifySignal({ kind: "CRM_UPDATE", title: "Deal updated", body: null }), "deal_stage_change");
  });
});
