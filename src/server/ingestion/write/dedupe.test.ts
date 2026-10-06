import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actionKey, actionSimilarity, actionTokens, contextualSimilarity, isDuplicateAction, lightStem, shortHash, tokenCoverage } from "./dedupe";

describe("action normalization", () => {
  it("stems lightly so inflections match", () => {
    assert.equal(lightStem("revised"), lightStem("revise"));
    assert.equal(lightStem("packages"), lightStem("package"));
    assert.equal(lightStem("sending"), "send");
    assert.equal(lightStem("studies"), "study");
    assert.equal(lightStem("data"), "data");
  });

  it("drops stopwords and punctuation but keeps figures", () => {
    assert.deepEqual(actionTokens("Please send us the revised data package by Friday!"), ["send", "revis", "data", "packag", "friday"]);
    assert.ok(actionTokens("Hold-out AUC 0.88 vs 0.90").includes("0.88"));
  });
});

describe("similarity", () => {
  it("matches the same action phrased differently", () => {
    const a = "Send the revised data package";
    const b = "Send revised data packages to Calder";
    assert.ok(actionSimilarity(a, b) >= 0.6, String(actionSimilarity(a, b)));
    assert.equal(isDuplicateAction(a, b, true).match, true);
    assert.equal(isDuplicateAction(a, b, false).match, false, "without shared context the bar is 0.85");
  });

  it("does not match different actions", () => {
    assert.equal(isDuplicateAction("Send the revised data package", "Schedule the Calder QBR", true).match, false);
    assert.equal(isDuplicateAction("Review clause 7.3 redlines", "Send the revised data package", true).match, false);
  });

  it("near-identical text matches even without context", () => {
    assert.equal(isDuplicateAction("Send cohort retention analysis to Sarah", "Send the cohort retention analysis to Sarah", false).match, true);
  });

  it("is order-insensitive for fingerprints", () => {
    assert.equal(actionKey("revised data package send"), actionKey("Send the revised data package"));
    assert.equal(shortHash("a", null, "b"), shortHash("a", "", "b"));
    assert.notEqual(shortHash("a", "b"), shortHash("b", "a"));
  });

  it("measures coverage of a deliverable in a message", () => {
    assert.equal(tokenCoverage("revised data package", "As promised, attached is the revised data package."), 1);
    assert.ok(tokenCoverage("revised data package", "Thanks for the call today") < 0.3);
  });
});

describe("contextual similarity", () => {
  it("matches a more specific phrasing of the same action when context is shared", () => {
    assert.ok(contextualSimilarity("Sign Vantage NDA", "Sign Vantage mutual NDA via DocuSign") >= 0.6);
    assert.equal(isDuplicateAction("Sign Vantage NDA", "Sign Vantage mutual NDA via DocuSign", true).match, true);
    assert.equal(isDuplicateAction("Sign Vantage NDA", "Sign Vantage mutual NDA via DocuSign", false).match, false, "not without shared context");
    assert.equal(lightStem("hire"), lightStem("hired"));
  });

  it("needs two shared words before containment counts", () => {
    assert.ok(contextualSimilarity("Send deck", "Send the cohort analysis") < 0.6);
  });
});
