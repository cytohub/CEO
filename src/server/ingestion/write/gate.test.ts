import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gate } from "./gate";

describe("confidence gate", () => {
  it("writes high confidence automatically", () => {
    assert.equal(gate({ confidence: 0.92, relevance: "NORMAL" }).outcome, "WRITE");
    assert.equal(gate({ confidence: 0.8, relevance: "LOW" }).outcome, "WRITE");
  });

  it("sends medium confidence to review", () => {
    const g = gate({ confidence: 0.7, relevance: "NORMAL" });
    assert.equal(g.outcome, "REVIEW");
    assert.equal(g.band, "MEDIUM");
    assert.equal(gate({ confidence: 0.55, relevance: "LOW" }).outcome, "REVIEW");
  });

  it("reviews low confidence only on loud sources", () => {
    assert.equal(gate({ confidence: 0.4, relevance: "HIGH" }).outcome, "REVIEW");
    assert.equal(gate({ confidence: 0.4, relevance: "CRITICAL" }).outcome, "REVIEW");
    assert.equal(gate({ confidence: 0.4, relevance: "NORMAL" }).outcome, "DROP");
    assert.equal(gate({ confidence: 0.4, relevance: null }).outcome, "DROP");
  });

  it("always reviews protected classes, whatever the confidence", () => {
    for (const p of ["DECISION_MADE", "ENTITY_MERGE", "NEW_INVESTOR", "DEADLINE_CHANGE", "OWNER_CHANGE", "DEAL_VALUE_CHANGE", "MILESTONE_DATE_CHANGE", "MILESTONE_COMPLETE"] as const) {
      const g = gate({ confidence: 0.99, relevance: "CRITICAL", protectedClass: p });
      assert.equal(g.outcome, "REVIEW", p);
      assert.ok(g.reason.length > 10);
    }
    assert.equal(gate({ confidence: 0.3, relevance: "LOW", protectedClass: "DECISION_MADE" }).outcome, "DROP");
    assert.equal(gate({ confidence: 0.3, relevance: "HIGH", protectedClass: "DECISION_MADE" }).outcome, "REVIEW");
  });

  it("clamps nonsense confidences", () => {
    assert.equal(gate({ confidence: Number.NaN, relevance: "NORMAL" }).outcome, "DROP");
    assert.equal(gate({ confidence: 7, relevance: "NORMAL" }).outcome, "WRITE");
  });
});
