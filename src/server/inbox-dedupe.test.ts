import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { primaryRecord } from "./inbox-dedupe";

describe("primaryRecord", () => {
  it("keys an item on its most specific record", () => {
    assert.deepEqual(primaryRecord({ taskId: "t1", decisionId: "d1" }), { field: "decisionId", id: "d1" });
    assert.deepEqual(primaryRecord({ taskId: "t1", commitmentId: "c1" }), { field: "commitmentId", id: "c1" });
    assert.deepEqual(primaryRecord({ dealId: "deal1", riskId: null }), { field: "dealId", id: "deal1" });
  });

  it("context-only items (people, companies, goals) are never deduplicated", () => {
    assert.equal(primaryRecord({}), null);
    assert.equal(primaryRecord({ decisionId: null, taskId: undefined }), null);
  });
});
