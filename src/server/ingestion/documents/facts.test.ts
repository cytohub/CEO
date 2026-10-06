import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type KeyFact,
  diffKeyFacts,
  extractKeyFacts,
  formatMoney,
  isSignificantChange,
  parseKeyFacts,
  parseSignificantChanges,
  reflowLines,
  segmentText,
  summarizeChanges,
  textChangeRatio,
} from "./facts";

const byKey = (facts: KeyFact[], key: string) => facts.filter((f) => f.key === key).map((f) => f.value);

describe("extractKeyFacts — money", () => {
  it("labels amounts from the nearest cue and normalizes values", () => {
    const facts = extractKeyFacts("CytoHub Series B: raising $35M at a $160M pre-money valuation. ARR $4.7M, burn $1.15M per month.");
    assert.deepEqual(byKey(facts, "raise_amount"), ["$35M"]);
    assert.deepEqual(byKey(facts, "pre_money"), ["$160M"]);
    assert.deepEqual(byKey(facts, "arr"), ["$4.7M"]);
    assert.deepEqual(byKey(facts, "burn"), ["$1.15M"]);
    const raise = facts.find((f) => f.key === "raise_amount")!;
    assert.equal(raise.numeric, 35_000_000);
    assert.equal(raise.category, "fundraising");
    assert.equal(raise.kind, "money");
    assert.match(raise.evidence, /raising \$35M/);
  });

  it("understands K/M/B suffixes, words, separators and currencies", () => {
    const facts = extractKeyFacts(
      "Proposal value: $350K.\nContract value USD 1.4 million over three years.\nBudget of 2.5 million dollars.\nThe license fee is €90,000.\nValuation £1.2B.",
    );
    assert.deepEqual(byKey(facts, "proposal_value"), ["$350K"]);
    assert.deepEqual(byKey(facts, "contract_value"), ["$1.4M", "€90K"]);
    assert.deepEqual(byKey(facts, "budget"), ["$2.5M"]);
    assert.deepEqual(byKey(facts, "valuation"), ["£1.2B"]);
    assert.equal(formatMoney(466_667), "$466.7K");
    assert.equal(formatMoney(950), "$950");
  });

  it("does not let a label cross a clause boundary", () => {
    const facts = extractKeyFacts("Revenue was flat; the team spent $40K on travel.");
    assert.deepEqual(byKey(facts, "revenue"), []);
  });
});

describe("extractKeyFacts — runway, dates, percentages, metrics, counts", () => {
  it("extracts runway months including table cells and 24+ forms", () => {
    const facts = extractKeyFacts("Runway at current burn: 16.6 months; 24+ months after a December close.\nSheet: Summary\nMetric\tValue\nRunway at current burn (months)\t15.9");
    assert.deepEqual(byKey(facts, "runway"), ["16.6 months", "24+ months", "15.9 months"]);
  });

  it("labels dates and ignores unlabelled ones", () => {
    const facts = extractKeyFacts(
      "Lead investor term sheet by November 16, 2026; first close December 30, 2026.\nPrepared by Jonas Weber, October 5, 2026.\nCountersignature is due by 2026-10-09.\nGA target: Nov 20, 2026.",
    );
    assert.deepEqual(byKey(facts, "term_sheet_date"), ["2026-11-16"]);
    assert.deepEqual(byKey(facts, "close_date"), ["2026-12-30"]);
    assert.deepEqual(byKey(facts, "signature_date"), ["2026-10-09"]);
    assert.deepEqual(byKey(facts, "launch_date"), ["2026-11-20"]);
    assert.ok(!facts.some((f) => f.value === "2026-10-05"), "a byline date is not a deadline");
    assert.equal(facts.find((f) => f.key === "close_date")!.category, "fundraising");
  });

  it("does not read 'close the hire' as a closing date", () => {
    const facts = extractKeyFacts("Sofia will close the VP Sales hire by October 8, 2026.");
    assert.deepEqual(byKey(facts, "close_date"), []);
    assert.deepEqual(byKey(facts, "deadline"), ["2026-10-08"]);
  });

  it("labels percentages and model metrics with targets", () => {
    const facts = extractKeyFacts("Net revenue retention 118%, gross retention 96%.\nHold-out AUC 0.88 vs 0.90 target on 212 compounds (sensitivity 0.91, specificity 79%).\nMilestone: validation (AUC ≥ 0.90).");
    assert.deepEqual(byKey(facts, "nrr"), ["118%"]);
    assert.deepEqual(byKey(facts, "grr"), ["96%"]);
    assert.deepEqual(byKey(facts, "metric:holdout_auc"), ["0.88"]);
    assert.deepEqual(byKey(facts, "metric:auc_target"), ["0.9"]);
    assert.deepEqual(byKey(facts, "metric:sensitivity"), ["0.91"]);
    assert.deepEqual(byKey(facts, "metric:specificity"), ["0.79"]);
    assert.deepEqual(byKey(facts, "compounds"), ["212"]);
    assert.ok(!facts.some((f) => f.kind === "percent" && f.value === "79%"), "metric percentages are metrics, not shares");
  });

  it("counts with units, in prose and in table columns", () => {
    const facts = extractKeyFacts("410 donor hearts across 3 sites; 10 pharma customers.\nSite\tDonor hearts\tQC pass rate\nLakeshore\t141\t91%");
    assert.deepEqual(byKey(facts, "donor_hearts"), ["410", "141"]);
    assert.deepEqual(byKey(facts, "sites"), ["3"]);
    assert.deepEqual(byKey(facts, "customers"), ["10"]);
    assert.deepEqual(byKey(facts, "qc_pass_rate"), ["91%"]);
  });

  it("names unlabelled table figures after their row", () => {
    const facts = extractKeyFacts("| Area | Share |\n| --- | --- |\n| Dataset scale-up | 40% |\n| HeartReady | 20% |");
    assert.deepEqual(byKey(facts, "percent:dataset scale-up"), ["40%"]);
    assert.deepEqual(byKey(facts, "percent:heartready"), ["20%"]);
  });

  it("reflows wrapped PDF lines before reading them", () => {
    const wrapped = "Named lead by November 16, 2026; term sheet signed by November 20, 2026; first close\nDecember 30, 2026.\n# Next";
    assert.equal(reflowLines(wrapped).split("\n")[0], "Named lead by November 16, 2026; term sheet signed by November 20, 2026; first close December 30, 2026.");
    assert.deepEqual(byKey(extractKeyFacts(wrapped, { reflow: true }), "close_date"), ["2026-12-30"]);
  });

  it("splits long lines into sentences but not at abbreviations or decimals", () => {
    const long = `${"Context sentence about the round. ".repeat(12)}AUC 0.88 vs. 0.90. Dr. Okafor agrees.`;
    const segs = segmentText(long);
    assert.ok(segs.length > 12);
    assert.ok(segs.includes("AUC 0.88 vs. 0.90."));
    assert.ok(segs.includes("Dr. Okafor agrees."));
  });
});

describe("diffKeyFacts and change summaries", () => {
  const v1 = "Slide 1\nRaising $35M to scale the human heart data platform\nSlide 2\nRunway 16.6 months at current burn of $1.15M.\nSlide 3\n410 donor hearts profiled.";
  const v2 = "Slide 1\nRaising $40M to scale the human heart data platform\nSlide 2\nRunway 15.9 months at current burn of $1.2M.\nSlide 3\n410 donor hearts profiled.\nSlide 4\nWhy the dataset is defensible\nSlide 5\nCohort retention";

  it("marks a ≥10% raise change as HIGH ($35M → $40M)", () => {
    const changes = diffKeyFacts(extractKeyFacts(v1), extractKeyFacts(v2));
    const raise = changes.find((c) => c.key === "raise_amount")!;
    assert.deepEqual(
      { from: raise.from, to: raise.to, change: raise.change, significance: raise.significance, deltaPct: raise.deltaPct },
      { from: "$35M", to: "$40M", change: "changed", significance: "HIGH", deltaPct: 14.3 },
    );
    assert.equal(changes[0].key, "raise_amount", "most significant first");
    const runway = changes.find((c) => c.key === "runway")!;
    assert.equal(runway.significance, "MEDIUM");
    assert.equal(runway.deltaPct, -4.2);
    assert.ok(!changes.some((c) => c.key === "donor_hearts"), "unchanged facts produce no change");
  });

  it("summarizes the change in one line", () => {
    const changes = diffKeyFacts(extractKeyFacts(v1), extractKeyFacts(v2));
    const ratio = textChangeRatio(v1, v2);
    assert.ok(ratio > 0 && ratio < 1);
    const summary = summarizeChanges(changes, { unit: "slide", before: 3, after: 5 }, ratio);
    assert.match(summary, /^Raise amount changed from \$35M to \$40M\. .*2 slides added; ~\d+% of text changed\.$/);
    assert.equal(isSignificantChange(changes, ratio), true);
  });

  it("classifies dates, small shifts and additions", () => {
    const a = extractKeyFacts("Series B first close December 30, 2026.\nGA launch November 20, 2026.");
    const b = extractKeyFacts("Series B first close January 22, 2027.\nGA launch November 23, 2026.\nGross margin 71%.");
    const changes = diffKeyFacts(a, b);
    const close = changes.find((c) => c.key === "close_date")!;
    assert.equal(close.significance, "HIGH");
    assert.equal(close.deltaDays, 23);
    assert.equal(changes.find((c) => c.key === "launch_date")!.significance, "MEDIUM", "a 3-day slip is MEDIUM");
    const margin = changes.find((c) => c.key === "gross_margin")!;
    assert.equal(margin.change, "added");
    assert.equal(margin.significance, "MEDIUM");
  });

  it("pairs multi-valued facts by order and reports removals", () => {
    const changes = diffKeyFacts(extractKeyFacts("Runway 16.6 months.\nRunway 13.1 months if the raise slips.\nProposal value $350K."), extractKeyFacts("Runway 15.9 months.\nRunway 12.4 months if the raise slips."));
    assert.deepEqual(
      changes.filter((c) => c.key === "runway").map((c) => `${c.from}→${c.to}`),
      ["16.6 months→15.9 months", "13.1 months→12.4 months"],
    );
    const removed = changes.find((c) => c.key === "proposal_value")!;
    assert.equal(removed.change, "removed");
    assert.equal(removed.from, "$350K");
  });

  it("returns no changes for the first version and handles tiny edits", () => {
    assert.deepEqual(diffKeyFacts(null, extractKeyFacts(v1)), []);
    assert.equal(textChangeRatio("same text", "same text"), 0);
    assert.equal(summarizeChanges([], { unit: null, before: null, after: null }, 0), "Minor text edits.");
    assert.equal(summarizeChanges([], { unit: null, before: null, after: null }, null), "Content changed.");
    assert.equal(isSignificantChange([], 0.05), false);
    assert.equal(isSignificantChange([], 0.45), true, "a major rewrite is significant on its own");
  });

  it("validates stored facts and changes", () => {
    const facts = extractKeyFacts(v1);
    assert.deepEqual(parseKeyFacts(JSON.parse(JSON.stringify(facts))), facts);
    assert.deepEqual(parseKeyFacts([{ key: "x" }, null, "junk"]), []);
    const changes = diffKeyFacts(facts, extractKeyFacts(v2));
    assert.deepEqual(parseSignificantChanges(JSON.parse(JSON.stringify(changes))), changes);
    assert.deepEqual(parseSignificantChanges({ not: "an array" }), []);
  });
});
