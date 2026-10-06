import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fillDailySeries, STAGE_ORDER } from "./health";

describe("fillDailySeries", () => {
  it("returns exactly `days` entries ending at the end day, oldest first", () => {
    const s = fillDailySeries([], "2026-10-06", 14);
    assert.equal(s.length, 14);
    assert.equal(s[0].day, "2026-09-23");
    assert.equal(s[13].day, "2026-10-06");
    assert.ok(s.every((d) => d.count === 0));
  });

  it("places counts on their days and fills gaps with zero", () => {
    const s = fillDailySeries(
      [
        { day: "2026-10-04", count: 3 },
        { day: "2026-10-06", count: 5 },
      ],
      "2026-10-06",
      4,
    );
    assert.deepEqual(s, [
      { day: "2026-10-03", count: 0 },
      { day: "2026-10-04", count: 3 },
      { day: "2026-10-05", count: 0 },
      { day: "2026-10-06", count: 5 },
    ]);
  });

  it("ignores rows outside the window", () => {
    const s = fillDailySeries([{ day: "2026-01-01", count: 9 }], "2026-10-06", 3);
    assert.equal(s.reduce((n, d) => n + d.count, 0), 0);
  });

  it("crosses month and DST boundaries without skipping or repeating days", () => {
    const s = fillDailySeries([], "2026-11-02", 5); // US DST ends Nov 1
    assert.deepEqual(
      s.map((d) => d.day),
      ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"],
    );
  });
});

describe("STAGE_ORDER", () => {
  it("lists every job type once, sync first", () => {
    assert.equal(new Set(STAGE_ORDER).size, STAGE_ORDER.length);
    assert.equal(STAGE_ORDER.length, 13);
    assert.deepEqual(STAGE_ORDER.slice(0, 3), ["EMAIL_SYNC", "CALENDAR_SYNC", "DOCUMENT_SYNC"]);
  });
});
