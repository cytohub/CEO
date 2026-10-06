import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addDays, dayFromKey } from "@/lib/dates";
import { selectTopFive } from "./priorities";
import { DEFAULT_WEIGHTS, normalizeWeights, scoreTask, urgencyFromDays, type ScoreInput } from "./scoring";

const today = dayFromKey("2026-10-06");

const base: ScoreInput = {
  status: "TODO",
  priority: "P2",
  strategicImpact: 3,
  revenueImpact: 0,
  fundraisingImpact: 0,
  customerImpact: 0,
  scientificImpact: 0,
  riskLevel: 1,
  ceoUniqueness: 3,
  opportunityCost: 2,
  dueDate: null,
  hardDeadline: false,
  postponeCount: 0,
  blocksCount: 0,
};

describe("CEO Priority Score", () => {
  it("weights sum to 100 after normalization", () => {
    const w = normalizeWeights({ strategic: 50 });
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 100) < 1e-9);
    assert.ok(w.strategic > DEFAULT_WEIGHTS.strategic);
  });

  it("falls back to defaults when all weights are zero", () => {
    const zero = Object.fromEntries(Object.keys(DEFAULT_WEIGHTS).map((k) => [k, 0]));
    assert.deepEqual(normalizeWeights(zero), normalizeWeights(DEFAULT_WEIGHTS));
  });

  it("stays within 0–100", () => {
    const max = scoreTask({ ...base, priority: "P0", strategicImpact: 5, revenueImpact: 5, fundraisingImpact: 5, customerImpact: 5, scientificImpact: 5, riskLevel: 5, ceoUniqueness: 5, opportunityCost: 5, dueDate: addDays(today, -3), hardDeadline: true, blocksCount: 9, postponeCount: 5 }, today);
    assert.ok(max.score <= 100);
    const min = scoreTask({ ...base, priority: "P3", strategicImpact: 0, ceoUniqueness: 0, opportunityCost: 0, riskLevel: 0 }, today);
    assert.ok(min.score >= 0);
  });

  it("ranks CEO-only strategic work above an urgent but delegable chore", () => {
    const strategic = scoreTask({ ...base, strategicImpact: 5, fundraisingImpact: 5, ceoUniqueness: 5, riskLevel: 4, dueDate: addDays(today, 3) }, today);
    const chore = scoreTask({ ...base, strategicImpact: 1, ceoUniqueness: 1, dueDate: today, hardDeadline: true }, today);
    assert.ok(strategic.score > chore.score, `${strategic.score} should exceed ${chore.score}`);
    assert.equal(chore.delegable, true);
    assert.equal(strategic.requiresCeo, true);
  });

  it("is not just a deadline sort: same impact, sooner due scores higher", () => {
    const soon = scoreTask({ ...base, strategicImpact: 4, dueDate: addDays(today, 1) }, today);
    const later = scoreTask({ ...base, strategicImpact: 4, dueDate: addDays(today, 20) }, today);
    assert.ok(soon.score > later.score);
  });

  it("explains itself", () => {
    const r = scoreTask({ ...base, strategicImpact: 5, ceoUniqueness: 5, fundraisingImpact: 5, goal: { title: "Close a $40M Series B", status: "AT_RISK" } }, today);
    assert.ok(r.drivers.length > 0);
    assert.match(r.rationale, /Series B|raise|requires you/i);
    assert.ok(r.modifiers.some((m) => /at-risk goal/.test(m.label)));
  });

  it("surfaces repeated postponement", () => {
    const r = scoreTask({ ...base, postponeCount: 4 }, today);
    assert.ok(r.modifiers.some((m) => m.kind === "points"));
    assert.match(r.rationale, /Postponed 4 times/);
  });

  it("maps days to urgency monotonically", () => {
    const xs = [-2, 0, 1, 3, 7, 14, 30, 90].map(urgencyFromDays);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] <= xs[i - 1]);
    assert.equal(urgencyFromDays(null), 0.5);
  });
});

describe("Top 5 selection", () => {
  const t = (id: string, goalId: string | null, delegate = false) => ({ id, goalId, delegationRecommended: delegate });

  it("caps at five, max two per goal, skips delegable work", () => {
    const ranked = [t("a", "g1"), t("b", "g1"), t("c", "g1"), t("d", null, true), t("e", "g2"), t("f", "g3"), t("g", "g4"), t("h", "g5")];
    const top = selectTopFive(ranked).map((x) => x.id);
    assert.deepEqual(top, ["a", "b", "e", "f", "g"]);
  });

  it("keeps CEO pins first", () => {
    const ranked = [t("a", "g1"), t("b", "g2"), t("c", "g3"), t("d", "g4"), t("e", "g5"), t("z", "g6")];
    const top = selectTopFive(ranked, ["z"]).map((x) => x.id);
    assert.equal(top[0], "z");
    assert.equal(top.length, 5);
  });

  it("backfills when diversity rules leave gaps", () => {
    const ranked = [t("a", "g1"), t("b", "g1"), t("c", "g1"), t("d", "g1")];
    assert.equal(selectTopFive(ranked).length, 4);
  });
});
