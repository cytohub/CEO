import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentShortTitle, formatSlot, fulfilmentMatch, longDay, meetingPhrase, meetingTypeFor, objectPhrase, signedSentence } from "./phrasing";
import { defaultPriority, focusAreaFor, isHardDeadline, taskScores } from "./task-scoring";

describe("change wording", () => {
  it("turns an action into its object", () => {
    assert.equal(objectPhrase("Send the revised electrophysiology dataset"), "the revised electrophysiology dataset");
    assert.equal(objectPhrase("Send revised data package"), "the revised data package");
    assert.equal(objectPhrase("Share our cohort retention analysis"), "our cohort retention analysis");
    assert.equal(objectPhrase("Review clause 7.3"), "“Review clause 7.3”");
    assert.equal(longDay(new Date("2026-10-14T00:00:00Z")), "October 14");
  });

  it("recognizes signatures but not intentions", () => {
    assert.equal(signedSentence("Great news — the MSA is signed. Kickoff next week.")?.contract, "MSA");
    assert.equal(signedSentence("Attached is the countersigned agreement.")?.contract, "agreement");
    assert.equal(signedSentence("We have signed the term sheet with Northbridge.")?.contract, "term sheet");
    assert.equal(signedSentence("Once the MSA is signed we can start."), null);
    assert.equal(signedSentence("We are ready to sign the contract next week."), null);
    assert.equal(signedSentence("The contract has not yet been signed."), null);
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
