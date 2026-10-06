import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { niceAxis } from "../health/axis";
import { shortDuration, timeUntil } from "./labels";

const NOW = new Date("2026-10-06T12:00:00Z");
const inMin = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe("timeUntil", () => {
  it("formats upcoming instants", () => {
    assert.equal(timeUntil(inMin(42), NOW), "in 42m");
    assert.equal(timeUntil(inMin(180), NOW), "in 3h");
    assert.equal(timeUntil(inMin(60 * 72), NOW), "in 3d");
  });

  it("treats past and imminent instants as due now", () => {
    assert.equal(timeUntil(inMin(-10), NOW), "due now");
    assert.equal(timeUntil(inMin(0.5), NOW), "due now");
  });

  it("handles a missing instant", () => {
    assert.equal(timeUntil(null, NOW), "—");
  });
});

describe("shortDuration", () => {
  it("scales from milliseconds to hours", () => {
    assert.equal(shortDuration(850), "850 ms");
    assert.equal(shortDuration(4_200), "4.2 s");
    assert.equal(shortDuration(21_000), "21 s");
    assert.equal(shortDuration(190_000), "3m 10s");
    assert.equal(shortDuration(2 * 3_600_000 + 5 * 60_000), "2h 05m");
    assert.equal(shortDuration(null), "—");
  });
});

describe("niceAxis", () => {
  it("rounds the maximum up to a clean whole-number step", () => {
    assert.deepEqual(niceAxis(5), { max: 6, step: 2 });
    assert.deepEqual(niceAxis(37), { max: 40, step: 10 });
    assert.deepEqual(niceAxis(1234), { max: 1500, step: 500 });
    for (const v of [7, 19, 99, 640, 12_345]) {
      const a = niceAxis(v);
      assert.ok(a.max >= v && a.max / a.step <= 4, String(v));
    }
  });

  it("never produces fractional steps for counts", () => {
    assert.deepEqual(niceAxis(1), { max: 1, step: 1 });
    assert.deepEqual(niceAxis(3), { max: 3, step: 1 });
  });

  it("gives an empty chart a usable axis", () => {
    assert.deepEqual(niceAxis(0), { max: 4, step: 1 });
    assert.deepEqual(niceAxis(Number.NaN), { max: 4, step: 1 });
  });
});
