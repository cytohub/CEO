import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreAttention, type AttentionInput } from "./attention";

const base: AttentionInput = {
  relevance: "NORMAL",
  isNoise: false,
  category: "OTHER",
  strategicScore: 0.2,
  revenueValue: null,
  fundraising: false,
  fundraisingValue: null,
  companyType: null,
  companyRelationship: null,
  riskSeverity: null,
  daysToDue: null,
  hardDeadline: false,
  dealOwnerIsCeo: false,
  ceoSoleRecipient: false,
  ceoRepliedBefore: false,
  legal: false,
  scientific: false,
  opportunityValue: null,
  ceoAsked: false,
  ceoOwesDueSoon: false,
  decisionNeeded: false,
  teamOwnedOnly: false,
  wroteSomething: false,
  urgentAction: false,
  changeImportance: null,
  changeSoon: false,
};

describe("CEO attention engine", () => {
  it("archives noise", () => {
    assert.equal(scoreAttention({ ...base, isNoise: true, ceoAsked: true }).level, "ARCHIVE");
    assert.equal(scoreAttention({ ...base, relevance: "NOISE" }).level, "ARCHIVE");
    assert.equal(scoreAttention({ ...base, relevance: "LOW" }).level, "ARCHIVE");
  });

  it("a customer asking the CEO directly for something due Friday is for today", () => {
    const r = scoreAttention({
      ...base,
      relevance: "HIGH",
      category: "CUSTOMER",
      strategicScore: 0.6,
      revenueValue: 350_000,
      companyType: "CUSTOMER",
      companyRelationship: 4,
      daysToDue: 3,
      ceoSoleRecipient: true,
      ceoAsked: true,
      scientific: true,
      wroteSomething: true,
    });
    assert.equal(r.level, "TODAY", `score ${r.score}`);
    assert.ok(r.reasons.includes("Asks the CEO personally"));
  });

  it("an overdue CEO promise to a key party is immediate", () => {
    const r = scoreAttention({ ...base, relevance: "HIGH", category: "INVESTOR", fundraising: true, companyType: "INVESTOR", ceoAsked: true, ceoOwesDueSoon: true, daysToDue: -1, wroteSomething: true });
    assert.equal(r.level, "IMMEDIATE");
  });

  it("a critical, high-value fundraising ask scores into IMMEDIATE on its own", () => {
    const r = scoreAttention({
      ...base,
      relevance: "CRITICAL",
      category: "FUNDRAISING",
      strategicScore: 0.95,
      fundraising: true,
      fundraisingValue: 15_000_000,
      companyType: "INVESTOR",
      daysToDue: 1,
      hardDeadline: true,
      dealOwnerIsCeo: true,
      ceoSoleRecipient: true,
      ceoRepliedBefore: true,
      ceoAsked: true,
    });
    assert.ok(r.score >= 66, String(r.score));
    assert.equal(r.level, "IMMEDIATE");
  });

  it("a decision needed lands this week; with a close deadline, today", () => {
    assert.equal(scoreAttention({ ...base, decisionNeeded: true, ceoAsked: true }).level, "THIS_WEEK");
    assert.equal(scoreAttention({ ...base, decisionNeeded: true, ceoAsked: true, daysToDue: 1 }).level, "TODAY");
  });

  it("a serious risk at a key customer is for today; critical and severe is immediate", () => {
    const risk = { ...base, relevance: "HIGH" as const, category: "CUSTOMER" as const, companyType: "CUSTOMER" as const, companyRelationship: 2, riskSeverity: 4, wroteSomething: true };
    assert.equal(scoreAttention(risk).level, "TODAY");
    assert.equal(scoreAttention({ ...risk, relevance: "CRITICAL", riskSeverity: 5 }).level, "IMMEDIATE");
    assert.equal(scoreAttention({ ...base, riskSeverity: 4, wroteSomething: true }).level, "MONITOR", "not for an unknown party");
  });

  it("work only the team owns is delegated", () => {
    assert.equal(scoreAttention({ ...base, teamOwnedOnly: true, wroteSomething: true }).level, "DELEGATE");
  });

  it("plain updates are monitored", () => {
    assert.equal(scoreAttention({ ...base, wroteSomething: true }).level, "MONITOR");
  });

  it("important changes lift the level", () => {
    assert.equal(scoreAttention({ ...base, changeImportance: 4, changeSoon: true }).level, "TODAY");
    assert.equal(scoreAttention({ ...base, changeImportance: 4 }).level, "THIS_WEEK");
    assert.equal(scoreAttention({ ...base, changeImportance: 5 }).level, "TODAY");
  });

  it("is monotonic in urgency", () => {
    const later = scoreAttention({ ...base, category: "CUSTOMER", ceoAsked: true, daysToDue: 20 }).score;
    const sooner = scoreAttention({ ...base, category: "CUSTOMER", ceoAsked: true, daysToDue: 1 }).score;
    assert.ok(sooner > later);
  });
});
