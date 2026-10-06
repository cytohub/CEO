import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReviewDraft } from "./env";
import { isProtectedDraft, selectReviewDrafts } from "./review-select";

const draft = (over: Partial<ReviewDraft> & { fingerprint: string }): ReviewDraft => ({
  kind: "TASK",
  title: "Possible task",
  reason: "Medium confidence",
  impact: 4,
  confidenceScore: 0.7,
  proposal: { title: over.title ?? "Task" },
  ...over,
});

describe("review selection per source item", () => {
  it("keeps at most the per-item budget, highest impact first", () => {
    const chosen = selectReviewDrafts(
      [
        draft({ fingerprint: "a", title: "Send the deck", impact: 4, confidenceScore: 0.6 }),
        draft({ fingerprint: "b", kind: "RISK", title: "Renewal at risk", impact: 5, proposal: { title: "Renewal at risk" } }),
        draft({ fingerprint: "c", title: "Book the venue", impact: 4, confidenceScore: 0.75 }),
      ],
      { alreadyPending: new Set(), slots: 2 },
    );
    assert.deepEqual(chosen.map((d) => d.fingerprint), ["b", "c"]);
  });

  it("drops uncertain, minor proposals but never protected ones", () => {
    const chosen = selectReviewDrafts(
      [
        draft({ fingerprint: "minor", impact: 3 }),
        draft({ fingerprint: "ms", kind: "FIELD_CHANGE", impact: 3, proposal: { targetLabel: "VP Sales hired" } }),
      ],
      { alreadyPending: new Set(), slots: 2 },
    );
    assert.deepEqual(chosen.map((d) => d.fingerprint), ["ms"]);
  });

  it("collapses one ask reported as task, deadline and decision", () => {
    const chosen = selectReviewDrafts(
      [
        draft({ fingerprint: "t", kind: "TASK", title: "Decide on the offer package", proposal: { title: "Decide on the offer package" } }),
        draft({ fingerprint: "d", kind: "DEADLINE", proposal: { what: "Decide on the offer package" } }),
        draft({ fingerprint: "x", kind: "DECISION", proposal: { title: "Decide on the offer package", status: "NEEDED" } }),
      ],
      { alreadyPending: new Set(), slots: 2 },
    );
    assert.equal(chosen.length, 1);
    assert.equal(chosen[0].kind, "DECISION", "the decision is the most specific form");
  });

  it("keeps what is already pending so the queue does not churn", () => {
    const chosen = selectReviewDrafts(
      [draft({ fingerprint: "old", impact: 4 }), draft({ fingerprint: "new1", kind: "RISK", impact: 5, proposal: { title: "x risk" } }), draft({ fingerprint: "new2", kind: "RISK", impact: 5, proposal: { title: "y other" } })],
      { alreadyPending: new Set(["old"]), slots: 2 },
    );
    assert.deepEqual(chosen.map((d) => d.fingerprint), ["old", "new1"]);
  });

  it("knows the protected kinds", () => {
    assert.equal(isProtectedDraft({ kind: "DECISION", proposal: { status: "MADE" } }), true);
    assert.equal(isProtectedDraft({ kind: "DECISION", proposal: { status: "NEEDED" } }), false);
    assert.equal(isProtectedDraft({ kind: "NEW_INVESTOR", proposal: {} }), true);
    assert.equal(isProtectedDraft({ kind: "TASK", proposal: {} }), false);
  });
});
