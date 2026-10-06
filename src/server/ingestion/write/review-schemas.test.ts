import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyEdit, parseProposal, PROPOSAL_SCHEMAS, safeParseProposal } from "./review-schemas";

describe("review proposal schemas", () => {
  it("has a schema for every review kind", () => {
    assert.deepEqual(Object.keys(PROPOSAL_SCHEMAS).sort(), [
      "COMMITMENT",
      "DEADLINE",
      "DECISION",
      "DOCUMENT_CHANGE",
      "ENTITY_MERGE",
      "FIELD_CHANGE",
      "MEETING",
      "NEW_COMPANY",
      "NEW_INVESTOR",
      "NEW_PERSON",
      "OPPORTUNITY",
      "RISK",
      "TASK",
    ]);
  });

  it("fills task defaults", () => {
    const t = parseProposal("TASK", { title: "Send the revised data package", confidence: 0.7 });
    assert.equal(t.priority, "P2");
    assert.equal(t.focusArea, "OPERATIONS");
    assert.equal(t.scores.ceoUniqueness, 3);
    assert.deepEqual(t.personIds, []);
    assert.equal(t.dueDate, null);
  });

  it("rejects malformed values", () => {
    assert.equal(safeParseProposal("TASK", { title: "", confidence: 0.7 }).success, false);
    assert.equal(safeParseProposal("TASK", { title: "x", confidence: 0.7, dueDate: "Friday" }).success, false);
    assert.equal(safeParseProposal("RISK", { title: "x", category: "WEATHER", severity: 3, confidence: 0.9 }).success, false);
    assert.equal(safeParseProposal("NEW_PERSON", { name: "A", email: "not-an-email", confidence: 1 }).success, false);
  });

  it("validates field changes per target and field", () => {
    const ok = { targetType: "TASK", targetId: "t1", targetLabel: "Send deck", field: "dueDate", from: "2026-10-09", to: "2026-10-16", confidence: 0.9 };
    assert.equal(safeParseProposal("FIELD_CHANGE", ok).success, true);
    assert.equal(safeParseProposal("FIELD_CHANGE", { ...ok, to: "next week" }).success, false);
    assert.equal(safeParseProposal("FIELD_CHANGE", { ...ok, field: "value" }).success, false, "tasks have no value");
    assert.equal(safeParseProposal("FIELD_CHANGE", { ...ok, targetType: "DEAL", field: "value", to: 1_600_000 }).success, true);
    assert.equal(safeParseProposal("FIELD_CHANGE", { ...ok, targetType: "DEAL", field: "value", to: "1.6M" }).success, false);
    assert.equal(safeParseProposal("FIELD_CHANGE", { ...ok, targetType: "MILESTONE", field: "status", to: "COMPLETED" }).success, true);
    assert.equal(safeParseProposal("FIELD_CHANGE", { ...ok, targetType: "COMMITMENT", field: "status", to: "DONE" }).success, false);
  });

  it("applies only editable fields and re-validates", () => {
    const proposal = { targetType: "TASK", targetId: "t1", targetLabel: "Send deck", field: "dueDate", from: "2026-10-09", to: "2026-10-16", toLabel: "Oct 16", confidence: 0.9 };
    const edited = applyEdit("FIELD_CHANGE", proposal, { to: "2026-10-20", targetId: "hijack" });
    assert.equal(edited.to, "2026-10-20");
    assert.equal(edited.targetId, "t1", "identity fields cannot be edited");
    assert.equal(edited.toLabel, null);
    assert.throws(() => applyEdit("FIELD_CHANGE", proposal, { to: "soon" }));

    const task = applyEdit("TASK", { title: "Send deck", confidence: 0.7 }, { priority: "P1", dueDate: "2026-10-09" });
    assert.equal(task.priority, "P1");
    assert.equal(task.dueDate, "2026-10-09");
  });

  it("describes merges and new investors", () => {
    const m = parseProposal("ENTITY_MERGE", { entityType: "COMPANY", keepId: "a", keepLabel: "Brightwater Therapeutics", mergeId: "b", mergeLabel: "Brightwater", score: 0.95, reason: "same" });
    assert.equal(m.entityType, "COMPANY");
    const inv = parseProposal("NEW_INVESTOR", { name: "Atlas Bio Partners", domain: "atlasbio.example", confidence: 0.7 });
    assert.equal(inv.createDeal, false);
    assert.deepEqual(inv.personIds, []);
  });
});
