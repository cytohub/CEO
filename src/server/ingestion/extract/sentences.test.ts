import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clipEvidence, splitSentences } from "./sentences";
import { actionTitle } from "./titles";

const texts = (s: string) => splitSentences(s).map((x) => x.text);

describe("splitSentences", () => {
  it("returns exact substrings with offsets", () => {
    const src = "Hi Rajib,\n\nThanks for the call.  Please send it by Friday!\n";
    for (const s of splitSentences(src)) assert.equal(src.slice(s.start, s.end), s.text);
    assert.deepEqual(texts(src), ["Hi Rajib,", "Thanks for the call.", "Please send it by Friday!"]);
  });

  it("does not break on abbreviations, initials, decimals or a.m.", () => {
    assert.deepEqual(texts("Dr. Maya Lindqvist from Aurelius Pharma Inc. said the AUC was 0.88, e.g. below target. We meet at 10 a.m. Eastern."), [
      "Dr. Maya Lindqvist from Aurelius Pharma Inc. said the AUC was 0.88, e.g. below target.",
      "We meet at 10 a.m. Eastern.",
    ]);
    assert.deepEqual(texts("J. Smith and Prof. Holm agreed. Next item."), ["J. Smith and Prof. Holm agreed.", "Next item."]);
    assert.deepEqual(texts("See section 7.3 of the MSA vs. the draft. OK?"), ["See section 7.3 of the MSA vs. the draft.", "OK?"]);
  });

  it("breaks on ? and ! and keeps closing quotes", () => {
    assert.deepEqual(texts('Can you confirm? She said "yes." Great!'), ["Can you confirm?", 'She said "yes."', "Great!"]);
  });

  it("treats list items and checkboxes as separate sentences without their markers", () => {
    assert.deepEqual(texts("Action items:\n- Maya to send the deck by Oct 9\n- [ ] Jonas to update the model\n1. Decision: go with Aster Cloud\n* Risk: assay delay"), [
      "Action items:",
      "Maya to send the deck by Oct 9",
      "Jonas to update the model",
      "Decision: go with Aster Cloud",
      "Risk: assay delay",
    ]);
  });

  it("joins hard-wrapped prose but not short lines", () => {
    const wrapped = "We reviewed the validation results with the team this morning and the\nhold-out AUC is now 0.91 across all compounds.";
    assert.deepEqual(texts(wrapped), [wrapped]);
    assert.deepEqual(texts("Best,\nKaren\nKaren Liu | VP Discovery"), ["Best,", "Karen", "Karen Liu | VP Discovery"]);
  });

  it("handles empty and punctuation-only input", () => {
    assert.deepEqual(splitSentences(""), []);
    assert.deepEqual(texts("...\n---\n"), []);
  });
});

describe("clipEvidence", () => {
  it("keeps short sentences and cuts long ones at a word boundary", () => {
    assert.equal(clipEvidence("short one"), "short one");
    const long = "word ".repeat(200).trim();
    const clipped = clipEvidence(long);
    assert.ok(clipped.length <= 600);
    assert.ok(long.startsWith(clipped));
    assert.ok(!clipped.endsWith(" "));
  });
});

describe("actionTitle", () => {
  const cases: [string, Parameters<typeof actionTitle>[1], string][] = [
    ["please send the revised data package by Friday", { dateText: "by Friday" }, "Send revised data package"],
    ["Please send us the revised data package by Friday so we can review it.", { dateText: "by Friday" }, "Send revised data package"],
    ["Could you please confirm the price by Wednesday?", { dateText: "by Wednesday" }, "Confirm price"],
    ["I'll send you the revised package by Thursday.", { dateText: "by Thursday" }, "Send revised package"],
    ["Let me check with Maya and get back to you", { recipientFirst: "Karen" }, "Check with Maya and get back to Karen"],
    ["Please let me know if Thursday works for the call.", { senderFirst: "Karen" }, "Let Karen know if Thursday works for the call"],
    ["We will send the term sheet next week", { dateText: "next week" }, "Send term sheet"],
    ["I'll have comments back by Wednesday.", { dateText: "by Wednesday" }, "Send comments back"],
    ["Rajib, please review the redlines on clause 7.3, thanks!", {}, "Review redlines on clause 7.3"],
    ["we need you to sign the NDA asap", {}, "Sign NDA"],
  ];
  for (const [input, ctx, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => assert.equal(actionTitle(input, ctx), expected));
  }
  it("caps length at a word boundary and returns null for nothing actionable", () => {
    const t = actionTitle(`review ${"the very long appendix ".repeat(10)}`)!;
    assert.ok(t.length <= 90);
    assert.equal(actionTitle("please."), null);
  });
});
