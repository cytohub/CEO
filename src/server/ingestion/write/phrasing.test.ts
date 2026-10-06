import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionClause,
  actionWithRecipient,
  cleanDecisionTitle,
  cleanTitle,
  deliverablePhrase,
  describeChange,
  documentShortTitle,
  formatSlot,
  fulfilmentMatch,
  hasActionObject,
  isGenericDecision,
  isMeaningfulMetricLabel,
  isScientificMetric,
  isTargetStatement,
  isVagueDate,
  longDay,
  meetingPhrase,
  meetingTypeFor,
  metricKey,
  objectPhrase,
  requestedObject,
  sameSentence,
  sentencesOf,
  signedSentence,
  thirdPartyActor,
} from "./phrasing";
import { defaultPriority, focusAreaFor, isHardDeadline, taskScores } from "./task-scoring";

describe("change wording", () => {
  it("turns an action into its object", () => {
    assert.equal(objectPhrase("Send the revised electrophysiology dataset"), "the revised electrophysiology dataset");
    assert.equal(objectPhrase("Send revised data package"), "the revised data package");
    assert.equal(objectPhrase("Share our cohort retention analysis"), "our cohort retention analysis");
    assert.equal(objectPhrase("Review clause 7.3"), "“Review clause 7.3”");
    assert.equal(longDay(new Date("2026-10-14T00:00:00Z")), "October 14");
    assert.equal(requestedObject("Lumen requested the revised electrophysiology dataset by October 14 — please confirm."), "the revised electrophysiology dataset");
    assert.equal(deliverablePhrase("Confirm you can deliver", "please confirm you can deliver", "We need the updated SOP before the audit."), "the updated SOP");
    assert.equal(deliverablePhrase("Send the deck"), "the deck");
  });

  it("recognizes signatures but not intentions", () => {
    assert.equal(signedSentence("Great news — the MSA is signed. Kickoff next week.")?.contract, "MSA");
    assert.equal(signedSentence("Attached is the countersigned agreement.")?.contract, "agreement");
    assert.equal(signedSentence("We have signed the term sheet with Northbridge.")?.contract, "term sheet");
    assert.equal(signedSentence("Once the MSA is signed we can start."), null);
    assert.equal(signedSentence("We are ready to sign the contract next week."), null);
    assert.equal(signedSentence("The contract has not yet been signed."), null);
  });

  it("describes document changes", () => {
    assert.equal(describeChange({ label: "Raise amount", from: "$35M", to: "$40M", significance: "HIGH", change: "changed" }), "raise amount changed from $35M to $40M");
    assert.equal(describeChange({ label: "Runway", from: null, to: "24 months", change: "added" }), "runway added: 24 months");
    assert.equal(describeChange({ label: "Pricing", from: "$50K", to: null, change: "removed" }), "pricing removed (was $50K)");
  });

  it("shortens document titles", () => {
    assert.equal(documentShortTitle("Series B deck v7.pptx"), "Series B deck");
    assert.equal(documentShortTitle("Brightwater_MSA_final.docx"), "Brightwater MSA");
  });
});

describe("meetings", () => {
  it("labels slots in the CEO timezone", () => {
    const thu = new Date("2026-10-08T14:00:00Z"); // 10:00 New York
    assert.equal(formatSlot(thu, "America/New_York", false), "Thu 10:00");
    assert.equal(formatSlot(thu, "America/New_York", true), "Thu Oct 8, 10:00");
  });

  it("phrases the meeting without repeating the company", () => {
    assert.equal(meetingPhrase("Northbridge Ventures — partner meeting", "Northbridge Ventures"), "the partner meeting");
    assert.equal(meetingPhrase("Northbridge — partner meeting", "Northbridge Ventures"), "the partner meeting");
    assert.equal(meetingPhrase("Q4 board meeting", null), "“Q4 board meeting”");
  });

  it("maps categories and attendees to meeting types", () => {
    assert.equal(meetingTypeFor("FUNDRAISING", 1, 1), "INVESTOR");
    assert.equal(meetingTypeFor("INTERNAL_LEADERSHIP", 1, 0), "ONE_ON_ONE");
    assert.equal(meetingTypeFor("SCIENTIFIC", 4, 0), "INTERNAL");
    assert.equal(meetingTypeFor("OTHER", 0, 2), "EXTERNAL");
  });
});

describe("commitment fulfilment", () => {
  it("matches a delivery of the promised thing", () => {
    const m = fulfilmentMatch("Send the revised data package", "Henrik — as promised, attached is the revised data package. Best, CEO");
    assert.equal(m.cue, true);
    assert.ok(m.coverage >= 0.6);
    const no = fulfilmentMatch("Send the revised data package", "Thanks, talk Friday.");
    assert.ok(no.coverage < 0.4);
    assert.equal(fulfilmentMatch("Send the updated proposal", "See you soon", ["Calder_updated_proposal.pdf"]).coverage, 1);
  });
});

describe("task scoring", () => {
  it("maps categories to focus areas, hint first", () => {
    assert.equal(focusAreaFor("INVESTOR"), "FUNDRAISING");
    assert.equal(focusAreaFor("COMMERCIAL_OPPORTUNITY"), "REVENUE");
    assert.equal(focusAreaFor("BOARD"), "STRATEGY");
    assert.equal(focusAreaFor("OTHER"), "OPERATIONS");
    assert.equal(focusAreaFor("INVESTOR", "LEGAL"), "LEGAL");
  });

  it("detects hard deadlines and default priority", () => {
    assert.equal(isHardDeadline("no later than Oct 14"), true);
    assert.equal(isHardDeadline("we must have it before the board meeting"), true);
    assert.equal(isHardDeadline("sometime next week"), false);
    assert.equal(defaultPriority("HIGH"), "P1");
    assert.equal(defaultPriority("NORMAL"), "P2");
    assert.equal(defaultPriority("NORMAL", "P0"), "P0");
  });

  it("rates customer asks of the CEO as CEO-unique, revenue-relevant work", () => {
    const s = taskScores({
      category: "CUSTOMER",
      strategicScore: 0.6,
      goalMatched: true,
      companyType: "CUSTOMER",
      companyRelationship: 4,
      dealValue: 350_000,
      dealType: "SALES",
      moneyMax: null,
      maxRiskSeverity: null,
      hard: true,
      ownerIsCeo: true,
      askedPersonally: true,
      dueInDays: 3,
      scientific: false,
    });
    assert.equal(s.ceoUniqueness, 5);
    assert.equal(s.customerImpact, 4);
    assert.equal(s.revenueImpact, 4);
    assert.ok(s.strategicImpact >= 4);
    assert.equal(s.riskLevel, 3);
    const team = taskScores({ ...{ category: "OPERATIONS", strategicScore: 0, goalMatched: false, companyType: null, companyRelationship: null, dealValue: null, dealType: null, moneyMax: null, maxRiskSeverity: null, hard: false, ownerIsCeo: false, askedPersonally: false, dueInDays: null, scientific: false } });
    assert.equal(team.ceoUniqueness, 2);
    assert.equal(team.fundraisingImpact, 0);
  });
});

describe("titles and advice", () => {
  it("cleans extractor titles", () => {
    assert.equal(cleanTitle("Decide on the offer package (base $240K"), "Decide on the offer package");
    assert.equal(cleanTitle("Decision needed: Decision needed: secure the booth"), "Secure the booth");
    assert.equal(cleanTitle("approve q4 marketing budget: $180K in total……"), "Approve q4 marketing budget: $180K in total");
    assert.equal(cleanTitle("Propose two or three dates for a diligence session with"), "Propose two or three dates for a diligence session");
    assert.ok(cleanTitle("word ".repeat(60), 40).length <= 41);
  });

  it("names the decision, not the ask", () => {
    assert.equal(cleanDecisionTitle("I need a decision by Thursday to secure the booth"), "Secure the booth");
    assert.equal(cleanDecisionTitle("Hire Laura Mitchell as VP Sales at the requested package?"), "Hire Laura Mitchell as VP Sales at the requested package?");
    assert.equal(isGenericDecision("Decision needed: We need your call by Friday"), true);
    assert.equal(isGenericDecision("I need a decision by Thursday to secure the booth"), false);
  });

  it("writes advice with the recipient", () => {
    assert.equal(actionWithRecipient("Send revised data package", "Henrik"), "Send Henrik the revised data package");
    assert.equal(actionWithRecipient("Share our cohort retention analysis", "Sarah"), "Share Sarah our cohort retention analysis");
    assert.equal(actionWithRecipient("Sign Vantage NDA", "Marcus"), "Sign Vantage NDA");
    assert.equal(actionClause("Send revised data package"), "send the revised data package");
  });

  it("drops actions without an object", () => {
    assert.equal(hasActionObject("Follow up"), false);
    assert.equal(hasActionObject("Bring both"), false);
    assert.equal(hasActionObject("Follow up with Anna Berg"), true);
    assert.equal(hasActionObject("Sign Vantage NDA"), true);
  });
});

describe("deadline coverage", () => {
  const text = "Hi, I need your decision on the offer package (base $240K) by Wednesday. If you approve, could you call her yourself?";
  const sentences = sentencesOf(text);
  it("recognizes quotes of the same sentence", () => {
    assert.equal(sameSentence("I need your decision on the offer package (base $240K) by Wednesday.", "decision on the offer package", sentences), true);
    assert.equal(sameSentence("I need your decision on the offer package (base $240K) by Wednesday.", "could you call her yourself?", sentences), false);
  });

  it("spots dated actions that someone else owns", () => {
    assert.equal(thirdPartyActor("Daniel Kim will ship the assay turnaround dashboard for Lumen by October 12."), true);
    assert.equal(thirdPartyActor("Legal will return their revised language on clause 7.3 by Friday."), true);
    assert.equal(thirdPartyActor("Their legal team will send their comments back by Oct 7."), true);
    assert.equal(thirdPartyActor("Our legal team will send the redlines by Friday."), true);
    assert.equal(thirdPartyActor("CEO will circulate the final Series B deck to the board.", ["CEO"]), false);
    assert.equal(thirdPartyActor("We would like your comments on the term sheet by Friday."), false);
    assert.equal(thirdPartyActor("Can you confirm you can meet that date?"), false);
  });

  it("does not move milestones on vague dates", () => {
    assert.equal(isVagueDate("Target: 500 donor hearts by year-end"), true);
    assert.equal(isVagueDate("Sofia will close the VP Sales hire by October 8."), false);
  });
});

describe("scientific results", () => {
  it("keys a metric by name and value", () => {
    assert.equal(metricKey("Hold-out AUC", "0.88"), metricKey("AUC", "0.880"));
    assert.notEqual(metricKey("AUC", "0.88"), metricKey("AUC", "0.90"));
  });

  it("ignores unlabeled, business or target figures", () => {
    assert.equal(isMeaningfulMetricLabel("Percentage"), false);
    assert.equal(isMeaningfulMetricLabel("Hold-out AUC"), true);
    assert.equal(isScientificMetric("Retention"), false);
    assert.equal(isScientificMetric("Hold-out AUC"), true);
    assert.equal(isTargetStatement("CardioPredict v2 validation (AUC ≥ 0.90)"), true);
    assert.equal(isTargetStatement("the 0.90 bar we set publicly"), true);
    assert.equal(isTargetStatement("hold-out AUC came in at 0.88"), false);
  });
});
