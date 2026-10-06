/**
 * Extraction quality on realistic CytoHub mail (adapted from the demo mailbox):
 * calibrated confidence (explicit → HIGH, hedged → MEDIUM, weak → dropped),
 * executive titles, no duplicate deadlines, meaningful facts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateExtraction } from "../extraction-schema";
import type { ExtractionInput, KnownEntities, Participant } from "../types";
import { classifyFacts } from "./classify-rules";
import { extractWithRules } from "./rules-extractor";
import { CEO_PARTY, KNOWN, NOW, SENT, TZ, classification, documentInput, emailInput } from "./testing/fixtures";

const P = (name: string, email: string): Participant => ({ name, email });
const RACHEL = P("Rachel Moore", "rachel@lumen.example");
const DANIEL = P("Daniel Kim", "daniel@cytohub.example");
const HENRIK = P("Dr. Henrik Sørensen", "henrik@calder.example");
const SARAH = P("Sarah Chen", "sarah@northbridge.example");
const JAN = P("Jan Richter", "jan.richter@cellwave.example");
const ELENA = P("Elena Costa", "elena@cytohub.example");
const JONAS = P("Jonas Weber", "jonas@cytohub.example");
const SOFIA = P("Sofia Andersen", "sofia@cytohub.example");
const MARCUS = P("Marcus Hale", "marcus@cytohub.example");
const KAREN = P("Karen Liu", "karen@brightwater.example");
const MICHAEL = P("Michael Grant", "michael@granite.example");
const ALEX = P("Alex Rivera", "alex@aster.example");
const DAVID = P("David Morel", "david@helix.example");

const WORLD: KnownEntities = {
  ...KNOWN,
  people: [
    ...KNOWN.people,
    { id: "p_rachel", name: "Rachel Moore", email: RACHEL.email, company: "Lumen Biologics", isCeo: false },
    { id: "p_henrik", name: "Dr. Henrik Sørensen", email: HENRIK.email, company: "Calder Biosciences", isCeo: false },
    { id: "p_daniel", name: "Daniel Kim", email: DANIEL.email, company: null, isCeo: false },
    { id: "p_jonas", name: "Jonas Weber", email: JONAS.email, company: null, isCeo: false },
    { id: "p_sofia", name: "Sofia Andersen", email: SOFIA.email, company: null, isCeo: false },
    { id: "p_michael", name: "Michael Grant", email: MICHAEL.email, company: "Granite Peak Capital", isCeo: false },
    { id: "p_alex", name: "Alex Rivera", email: ALEX.email, company: "Aster Cloud", isCeo: false },
    { id: "p_david", name: "David Morel", email: DAVID.email, company: "Helix Capital Partners", isCeo: false },
  ],
  companies: [
    ...KNOWN.companies,
    { id: "c_calder", name: "Calder Biosciences", type: "CUSTOMER" },
    { id: "c_cellwave", name: "Cellwave Instruments", type: "VENDOR" },
    { id: "c_granite", name: "Granite Peak Capital", type: "INVESTOR" },
    { id: "c_aster", name: "Aster Cloud", type: "PARTNER" },
    { id: "c_helix", name: "Helix Capital Partners", type: "INVESTOR" },
  ],
};

function mail(from: Participant, subject: string, text: string, o: Parameters<typeof emailInput>[0] extends infer T ? Partial<T> : never = {}): ExtractionInput {
  return { ...emailInput({ from, subject, text, ...o }), known: WORLD };
}
const x = (i: ExtractionInput) => extractWithRules(i, NOW);

const LUMEN_1 = mail(
  RACHEL,
  "Escalation: assay turnaround at 19 days vs 10 contracted",
  "Dear CEO,\n\nThis is the third month in a row that we've missed the SLA. Median assay turnaround is now 19 days against the 10 days in our agreement, and two of our programs are waiting on data.\n\nOur renewal committee meets in three weeks, and I can't recommend renewal without a credible recovery plan. I'd like to discuss it on our call.\n\nRachel Moore\nDirector of Toxicology, Lumen Biologics",
  { cc: [DANIEL], classification: { category: "CUSTOMER", relevance: "HIGH", relevanceScore: 0.77 } },
);
const LUMEN_3 = mail(
  RACHEL,
  "Re: Escalation: assay turnaround at 19 days vs 10 contracted",
  "Thanks, Daniel. That's the right shape, and I'll take it to our renewal committee once we've walked through it together.\n\nOne additional request: we need the revised electrophysiology dataset for compounds LB-2207 and LB-2219 by October 20. Our safety review board meets the following day and this data is on the critical path.\n\nPlease confirm you can meet that date.\n\nRachel",
  { cc: [DANIEL], classification: { category: "CUSTOMER", relevance: "CRITICAL", relevanceScore: 0.97 } },
);
const CALDER_1 = mail(
  HENRIK,
  "Calder paid validation study",
  "Hi CEO,\n\nGood news: our finance committee approved the budget for the paid validation study this afternoon. We'd like to start with the 40-compound panel we discussed and keep the same scientific team on both sides.\n\nCould you send over the statement of work so procurement can issue the PO?\n\nBest regards,\nHenrik",
  { classification: { category: "CUSTOMER" } },
);
const CALDER_3 = mail(
  HENRIK,
  "Re: Calder paid validation study",
  "Hi CEO,\n\nThanks for the update on the SOW. One more request from our side: please send the revised data package by Friday. Once we review it, we can discuss expanding the study.\n\nBest regards,\nHenrik",
  { classification: { category: "CUSTOMER", relevance: "CRITICAL", relevanceScore: 0.9 } },
);
const NORTHBRIDGE_1 = mail(
  SARAH,
  "Northbridge partner meeting confirmed",
  "Hi CEO,\n\nGreat news: the partner meeting is confirmed for Thursday at 10:00 am at our Boston office. The partners will want to see cohort retention by customer and a clear view of why the human heart dataset is defensible. Could you bring both?\n\nBest,\nSarah",
  { classification: { category: "INVESTOR", relevance: "CRITICAL", relevanceScore: 0.87 } },
);
const NORTHBRIDGE_3 = mail(
  SARAH,
  "Re: Northbridge partner meeting confirmed",
  "Perfect, thank you. One more thing so there are no surprises: if the partner meeting goes the way I expect, we will send the term sheet next week. We would ask for 30 days of exclusivity alongside it, so it's worth thinking about before we meet.\n\nSarah",
  { classification: { category: "INVESTOR" } },
);
const CELLWAVE_1 = mail(
  JAN,
  "Shipment delay: FlexSense MEA systems (PO 4471)",
  "Dear CEO,\n\nI'm writing to let you know that the shipment of the two FlexSense multi-electrode array systems on PO 4471 will be delayed by approximately six weeks because of a component shortage at our supplier. The revised delivery date is November 17.\n\nWe sincerely apologize for the inconvenience. Please let me know if you would like to discuss interim options.\n\nKind regards,\nJan Richter\nCustomer Logistics Manager\nCellwave Instruments GmbH | Munich",
  { cc: [ELENA], classification: { category: "MAJOR_VENDOR", relevance: "NORMAL", relevanceScore: 0.52 } },
);
const CELLWAVE_2 = mail(
  ELENA,
  "Re: Shipment delay: FlexSense MEA systems (PO 4471)",
  "Jan,\n\nThis delay affects our functional assay capacity for the hearts arriving from our new hospital site in November. Can you confirm by the end of the week whether a loaner system is available in the meantime?\n\nElena Costa\nCOO, CytoHub",
  { to: [JAN], cc: [CEO_PARTY], direction: "INTERNAL", classification: { category: "MAJOR_VENDOR", relevance: "LOW", relevanceScore: 0.33 } },
);
const BUDGET = mail(
  JONAS,
  "Approval needed: Q4 marketing budget ($180K)",
  "Hi CEO,\n\nI need your approval on the Q4 marketing budget: $180K in total, $70K for our BIO-Europe presence and $110K for the CardioPredict v2 launch campaign. It's above your $100K approval threshold. I need a decision by Thursday to secure the booth.\n\nJonas",
  { classification: { category: "FINANCE" } },
);
const LAURA = mail(
  SOFIA,
  "Laura Mitchell: competing offer",
  "Hi CEO,\n\nLaura Mitchell told me this morning that she has a competing offer with a deadline. Her references were strong, four out of four, and the one flag on management style was addressed in the follow-up call.\n\nI need your decision on the offer package (base $240K, OTE $310K, 1.1% equity) by Wednesday. If you approve, could you call her yourself to close? It would mean a lot to her.\n\nSofia",
  { classification: { category: "RECRUITING" } },
);
const BRIGHTWATER = mail(
  KAREN,
  "Brightwater MSA v5: clause 7.3",
  "Hi CEO,\n\nOur legal team accepted 14 of the 16 redlines in v5. Clause 7.3 (rights to derivative models) is the one that remains open, and we think 11.2 is close. Legal will return their revised language on clause 7.3 by Friday.\n\nOur CSO would like a CEO-to-CEO conversation before tomorrow's negotiation. Can you make time in the morning?\n\nThanks,\nKaren",
  { cc: [P("Priya Raman", "priya@cytohub.example")] },
);
const GRANITE = mail(
  MICHAEL,
  "Granite Peak: Series B pro-rata",
  "Hi CEO,\n\nHappy to confirm that Granite Peak will take its full pro-rata in the Series B ($4M). The partnership signed off this morning; written confirmation from our counsel will follow.\n\nMichael",
  { classification: { category: "BOARD", relevance: "CRITICAL", relevanceScore: 0.85 } },
);
const ASTER = mail(
  ALEX,
  "Aster Cloud agreement: compute credits",
  "Hi CEO,\n\nGood news from our side: I got approval to offer 40% compute credits for the first two years if we sign by October 31. That's roughly $400K of training compute.\n\nOn the open items, the liability cap and data residency, our legal team will send their comments back by Wednesday. Apologies for the delay on our end.\n\nBest,\nAlex Rivera",
  { cc: [ELENA], classification: { category: "STRATEGIC_PARTNER" } },
);
const BOARD = mail(
  MICHAEL,
  "Board pre-read: Series B timeline and runway scenarios",
  "Hi CEO,\n\nFor Friday's pre-read, please include the Series B timeline with named lead candidates and two runway scenarios: base, and the raise slipping one quarter. The board expects a named lead by mid-November to keep the December first close.\n\nThanks,\nMichael",
  { cc: [JONAS], classification: { category: "BOARD", relevance: "CRITICAL", relevanceScore: 1 } },
);
const HELIX = mail(
  DAVID,
  "Helix: diligence and data room access",
  "Hi CEO,\n\nThanks again for the data request call with Jonas. Our investment committee has asked us to move into full diligence. Could you grant us access to the data room and propose two or three dates next week for a diligence session with your team?\n\nBest regards,\nDavid Morel",
  { classification: { category: "INVESTOR", relevance: "CRITICAL", relevanceScore: 0.87 } },
);
const RUNWAY = mail(
  JONAS,
  "Runway scenarios: model v12",
  "Hi CEO,\n\nModel v12 is uploaded to the data room. Headlines:\n\n- Runway is 16.6 months at current burn ($1.15M a month).\n- With a $40M close in December, runway extends past 24 months.\n- If the raise slips one quarter, we are at 13.1 months and should defer two of the Q1 hires.\n\nCan we review the scenarios together before Michael's pre-read goes out?\n\nJonas",
  { classification: { category: "FUNDRAISING" } },
);
const NDA_REPLY = mail(CEO_PARTY, "Re: Vantage NDA ready", "Thanks, Marcus. Agreed on both: go ahead and accept 11.2 at 2x. I'll sign the Vantage NDA tonight.", { to: [MARCUS], direction: "INTERNAL", classification: { category: "LEGAL" } });

describe("quality: customer escalation (Lumen)", () => {
  it("one HIGH renewal risk with the cause in the title, and a specific CEO action", () => {
    const r = x(LUMEN_1);
    assert.equal(r.risks.length, 1);
    assert.equal(r.risks[0].title, "Lumen renewal at risk: third missed SLA");
    assert.equal(r.risks[0].category, "CUSTOMER");
    assert.ok(r.risks[0].severity >= 4);
    assert.ok(r.risks[0].confidence >= 0.82);
    assert.equal(r.tasks.length, 0);
    assert.equal(r.recommendedActions[0].action, "Call Rachel Moore today and commit to a dated recovery plan");
    assert.ok(!r.recommendedActions.some((a) => /^Address:/.test(a.action)));
    assert.equal(r.summary, "Rachel Moore (Lumen Biologics) raises a risk: Lumen renewal at risk: third missed SLA.");
  });

  it("a dated deliverable request absorbs 'please confirm you can meet that date'", () => {
    const r = x(LUMEN_3);
    assert.deepEqual(r.tasks.map((t) => [t.title, t.ownerIsCeo, t.dueDate]), [["Deliver revised electrophysiology dataset (LB-2207, LB-2219)", true, "2026-10-20"]]);
    assert.ok(r.tasks[0].confidence >= 0.82);
    assert.equal(r.commitments.length, 0, "'I'll take it to our renewal committee' has only a pronoun object");
    assert.equal(r.deadlines.length, 0);
    assert.match(r.recommendedActions[0].action, /^Confirm to Rachel Moore you can deliver revised electrophysiology dataset/);
  });
});

describe("quality: customer requests and expansion (Calder)", () => {
  it("statement of work request is a HIGH task; the customer's budget approval is a fact, not our decision", () => {
    const r = x(CALDER_1);
    assert.deepEqual(r.tasks.map((t) => t.title), ["Send statement of work"]);
    assert.ok(r.tasks[0].confidence >= 0.82);
    assert.equal(r.decisions.length, 0);
    assert.ok(r.facts.some((f) => f.kind === "TEXT" && /finance committee approved the budget/i.test(f.value)));
  });

  it("revised data package request + HIGH expansion opportunity", () => {
    const r = x(CALDER_3);
    assert.deepEqual(r.tasks.map((t) => [t.title, t.dueDate]), [["Send revised data package", "2026-10-09"]]);
    assert.ok(r.tasks[0].confidence >= 0.85);
    assert.deepEqual(r.opportunities.map((o) => [o.title, o.kind]), [["Potential study expansion", "EXPANSION"]]);
    assert.ok(r.opportunities[0].confidence >= 0.82);
    assert.equal(r.recommendedActions[0].action, "Send revised data package to Dr. Henrik Sørensen by Friday");
  });
});

describe("quality: investors", () => {
  it("'Bring both' resolves to what the partners asked for", () => {
    const r = x(NORTHBRIDGE_1);
    assert.deepEqual(r.tasks.map((t) => t.title), ["Bring cohort retention by customer and human heart dataset defensibility"]);
  });

  it("term sheet promise is a HIGH inbound commitment (even conditional) and a fundraising opportunity", () => {
    const r = x(NORTHBRIDGE_3);
    const c = r.commitments[0];
    assert.deepEqual([c.direction, c.title, c.dueDate], ["INBOUND", "Send term sheet", "2026-10-12"]);
    assert.ok(c.confidence >= 0.82);
    assert.ok(r.opportunities.some((o) => o.kind === "FUNDRAISING" && o.title === "Potential term sheet from Northbridge Ventures"));
    assert.ok(r.facts.some((f) => f.label === "Exclusivity (days)" && f.numericValue === 30));
    assert.equal(r.recommendedActions.at(-1)!.action, "Watch for the term sheet from Sarah Chen by Monday");
  });

  it("pro-rata confirmation: inbound commitment + investment fact; the partnership's sign-off is not our decision", () => {
    const r = x(GRANITE);
    assert.deepEqual(r.commitments.map((c) => [c.direction, c.title, c.owedByName]), [["INBOUND", "Take full pro-rata in the Series B ($4M)", "Granite Peak Capital"]]);
    assert.ok(r.facts.some((f) => f.label === "Investment amount" && f.numericValue === 4_000_000));
    assert.equal(r.decisions.length, 0);
  });

  it("compound requests split into two HIGH tasks", () => {
    const r = x(HELIX);
    assert.deepEqual(r.tasks.map((t) => [t.title, t.dueDate]), [
      ["Grant access to the data room", null],
      ["Propose two or three dates for a diligence session with our team", "2026-10-12"],
    ]);
    assert.ok(r.tasks.every((t) => t.confidence >= 0.82));
  });
});

describe("quality: vendor delay (Cellwave)", () => {
  it("shipment delay is a HIGH risk with a noun-phrase title; the courtesy offer is LOW", () => {
    const r = x(CELLWAVE_1);
    assert.deepEqual(r.risks.map((k) => k.title), ["Cellwave shipment delayed ~6 weeks: component shortage"]);
    assert.ok(r.risks[0].confidence >= 0.82);
    assert.ok(r.tasks.every((t) => t.confidence < 0.55), "'let me know if you would like to discuss interim options' is a courtesy");
    assert.equal(r.opportunities.length, 0, "the CEO's possible interest is not an opportunity");
    assert.match(r.summary, /^Jan Richter \(Cellwave Instruments GmbH\) raises a risk: Cellwave shipment delayed/);
  });

  it("the COO's reply names the impact; her question to the vendor is not a CEO task", () => {
    const r = x(CELLWAVE_2);
    assert.deepEqual(r.risks.map((k) => k.title), ["Cellwave delay affects functional assay capacity"]);
    assert.equal(r.tasks.length, 0);
    assert.equal(r.deadlines.length, 0);
  });
});

describe("quality: decisions", () => {
  it("budget approval: one HIGH decision stating what is decided, with deadline and purpose; no task, no deadline", () => {
    const r = x(BUDGET);
    assert.deepEqual(r.decisions.map((d) => [d.status, d.title, d.deadline]), [["NEEDED", "Approve Q4 marketing budget ($180K)", "2026-10-08"]]);
    assert.ok(r.decisions[0].confidence >= 0.85);
    assert.equal(r.tasks.length, 0);
    assert.equal(r.deadlines.length, 0);
    assert.deepEqual(r.recommendedActions[0], { action: "Approve or decline Q4 marketing budget ($180K) by Thursday", why: "Jonas Weber needs your decision to secure the booth.", urgency: "THIS_WEEK" });
    assert.ok(r.facts.every((f) => f.label !== "Amount" && f.label !== "Percentage"));
  });

  it("offer package: decision names the candidate; the conditional call joins the decision; competing offer is a risk", () => {
    const r = x(LAURA);
    const d = r.decisions[0];
    assert.equal(d.title, "Decide on Laura Mitchell's offer package");
    assert.equal(d.deadline, "2026-10-07");
    assert.ok(d.decision?.includes("If approved: call Laura Mitchell to close"), d.decision ?? "");
    assert.equal(r.tasks.length, 0, "no 'Call yourself to close' task");
    assert.deepEqual(r.risks.map((k) => k.title), ["Laura Mitchell has a competing offer with a deadline"]);
    assert.equal(r.followUps.length, 0, "'the follow-up call' is a noun, not a follow-up");
  });

  it("a request without a stated topic takes it from the subject; options are attached", () => {
    const r = x(mail(P("Dr. Tom Okafor", "tom@cytohub.example"), "CardioPredict v2: hold-out results and launch scope", "Hi CEO,\n\nHold-out validation is complete.\n\nOptions:\n1. Launch GA now at 0.88.\n2. Delay GA six weeks for 0.90.\n3. Limited release to the three design partners.\n\nThe team recommends option 3. We need your call by Friday.\n\nTom"));
    assert.deepEqual(r.decisions.map((d) => [d.title, d.deadline]), [["Decide on CardioPredict v2 launch scope", "2026-10-09"]]);
    assert.equal(r.decisions[0].options.length, 3);
    assert.equal(r.risks.length, 0, "an option to delay is not a delay");
  });
});

describe("quality: weak asks and promises", () => {
  it("'Can you make time in the morning?' is a meeting request with a topic, not a task; Legal's promise is HIGH inbound", () => {
    const r = x(BRIGHTWATER);
    assert.equal(r.tasks.length, 0);
    assert.deepEqual(r.meetingRequests.map((m) => m.title), ["Meeting with Karen Liu re: CEO-to-CEO conversation before tomorrow's negotiation"]);
    const c = r.commitments[0];
    assert.deepEqual([c.direction, c.title, c.owedByName, c.dueDate], ["INBOUND", "Return revised language on clause 7.3", "Brightwater Therapeutics", "2026-10-09"]);
    assert.ok(c.confidence >= 0.82);
    assert.equal(r.deadlines.length, 0);
  });

  it("the CEO's promise to a teammate is a CEO task, not an internal commitment", () => {
    const r = x(NDA_REPLY);
    assert.deepEqual(r.tasks.map((t) => [t.title, t.ownerIsCeo, t.dueText]), [["Sign Vantage NDA", true, "tonight"]]);
    assert.ok(r.tasks[0].confidence >= 0.85);
    assert.equal(r.commitments.length, 0);
  });

  it("hedged promises are MEDIUM", () => {
    const r = x(mail(CEO_PARTY, "Re: data", "Hi Karen,\n\nI'll probably send the updated model next week.\n\nRajib", { to: [KAREN], direction: "OUTBOUND" }));
    assert.ok(r.commitments[0].confidence >= 0.55 && r.commitments[0].confidence < 0.8);
  });
});

describe("quality: board, partners, finance", () => {
  it("pre-read request is a HIGH task; 'the raise slipping one quarter' is a scenario, not a risk", () => {
    const r = x(BOARD);
    assert.deepEqual(r.tasks.map((t) => [t.title, t.dueDate]), [["Include Series B timeline with named lead candidates", "2026-10-09"]]);
    assert.equal(r.risks.length, 0);
    assert.ok(!r.recommendedActions.some((a) => /^Address/.test(a.action)));
  });

  it("compute credits are a HIGH opportunity with value; the apology is not a risk", () => {
    const r = x(ASTER);
    assert.deepEqual(r.opportunities.map((o) => [o.title, o.estimatedValue]), [["40% compute credits from Aster if signed by Oct 31", 400_000]]);
    assert.ok(r.opportunities[0].confidence >= 0.82);
    assert.equal(r.risks.length, 0);
    assert.deepEqual(r.commitments.map((c) => [c.direction, c.title, c.owedByName]), [["INBOUND", "Send comments back", "Aster Cloud"]]);
  });

  it("runway scenarios: meaningful facts, a meeting request, no hypothetical risk", () => {
    const r = x(RUNWAY);
    assert.ok(r.facts.some((f) => f.label === "Runway (months)" && f.numericValue === 16.6));
    assert.ok(!r.facts.some((f) => f.numericValue === 6), "never the '6 months' inside '16.6 months'");
    assert.ok(r.facts.some((f) => f.label === "Monthly burn" && f.numericValue === 1_150_000));
    assert.equal(r.risks.length, 0);
    assert.deepEqual(r.meetingRequests.map((m) => m.title), ["Meeting with Jonas Weber re: Runway scenarios"]);
  });

  it("dated third-party promises in a memo are INTERNAL commitments, not deadlines", () => {
    const memo = { ...documentInput({ title: "Q4 Operating Memo.md", docType: "INTERNAL_MEMO", text: "Priorities this week:\n- Daniel Kim will ship the assay turnaround dashboard for Lumen by October 12, 2026.\n- Lumen renewal ($500K) at risk over assay turnaround: 19 days against 10 contracted.\n- Aster Cloud compute agreement stuck in legal; the 40% compute credits lapse if it is not signed by October 26." }), known: WORLD };
    const r = x(memo);
    assert.deepEqual(r.commitments.map((c) => [c.direction, c.title, c.owedByName, c.companyName, c.dueDate]), [["INTERNAL", "Ship assay turnaround dashboard for Lumen", "Daniel Kim", "Lumen", "2026-10-12"]]);
    assert.equal(r.deadlines.length, 0);
    assert.deepEqual(r.risks.map((k) => k.title).sort(), ["Aster Cloud compute agreement stuck in legal", "Lumen renewal at risk"]);
  });

  it("expense reminders in the handbook produce no deadlines or tasks", () => {
    const r = x(documentInput({ title: "Employee Handbook — Time Off and Expenses", docType: "EMPLOYEE_DOCUMENT", text: "Submit receipts by October 6 for reimbursement. Expenses above $5,000 need CFO approval." }));
    assert.equal(r.deadlines.length, 0);
    assert.equal(r.tasks.length, 0);
  });
});

describe("quality: cold pitches are noise", () => {
  it("an unsolicited sales pitch from a stranger is MARKETING noise", () => {
    const c = classifyFacts({
      kind: "EMAIL_MESSAGE",
      title: "Quick question about CytoHub's pharma pipeline",
      text: "Hi,\n\nI help biotech CEOs book 20+ qualified meetings with pharma buyers every month. Would it be crazy to grab 15 minutes next week to see if we could do the same for CytoHub?",
      occurredAt: SENT,
      timezone: TZ,
      ceoFirstName: "Rajib",
      defaultSensitivity: "CONFIDENTIAL",
      participants: [
        { email: "jake@growthleads.example", name: "Jake Morrison", role: "SENDER", person: { id: "p_jake", name: "Jake Morrison", type: "OTHER", title: null, department: null, isCeo: false, company: null }, company: { id: "c_gl", name: "Growthleads", type: "OTHER" }, internal: false, isCeo: false },
      ],
      mentionedCompanies: [],
      email: { direction: "INBOUND", isAutomated: false, fromEmail: "jake@growthleads.example", labels: ["INBOX"], ceoInTo: true, ceoInCc: false, recipientCount: 1, ceoInThread: false, attachmentNames: [] },
    });
    assert.equal(c.isNoise, true);
    assert.equal(c.category, "MARKETING");
  });
});

describe("quality: every fixture validates unchanged and reads cleanly", () => {
  const all = { LUMEN_1, LUMEN_3, CALDER_1, CALDER_3, NORTHBRIDGE_1, NORTHBRIDGE_3, CELLWAVE_1, CELLWAVE_2, BUDGET, LAURA, BRIGHTWATER, GRANITE, ASTER, BOARD, HELIX, RUNWAY, NDA_REPLY };
  for (const [name, input] of Object.entries(all)) {
    it(name, () => {
      const raw = x(input);
      const { extraction, issues } = validateExtraction(raw, input.text, NOW);
      assert.deepEqual(issues, []);
      assert.deepEqual(extraction, raw);
      const titles = [...raw.tasks.map((t) => t.title), ...raw.commitments.map((c) => c.title), ...raw.decisions.map((d) => d.title), ...raw.risks.map((r) => r.title), ...raw.opportunities.map((o) => o.title)];
      for (const t of titles) {
        assert.ok(/^[\p{Lu}\d$~"“(]/u.test(t), `sentence case: ${t}`);
        assert.ok(!/…$/.test(t) && !/\s[,;:]/.test(t) && !/\(\s*[^)]*$/.test(t), `clean: ${t}`);
      }
      for (const r of raw.risks) assert.ok(r.title.length <= 70, r.title);
      for (const a of raw.recommendedActions) {
        assert.ok(a.action.length <= 110 && !/^Address:/.test(a.action), a.action);
        assert.ok(/^[\p{Lu}]/u.test(a.action));
      }
      assert.ok(!/\b(?:i|i'm|i'd)\b/.test(raw.summary.replace(/^[^:]+:/, "")), `no raw first-person fragment: ${raw.summary}`);
    });
  }

  it("calibration: explicit items are HIGH, nothing explicit lands in the 0.55–0.8 band", () => {
    const fixtures = [LUMEN_1, CALDER_1, CALDER_3, NORTHBRIDGE_3, BUDGET, LAURA, BRIGHTWATER, ASTER, HELIX];
    for (const f of fixtures) {
      const r = x(f);
      for (const item of [...r.tasks, ...r.commitments, ...r.risks, ...r.opportunities, ...r.decisions.filter((d) => !d.title.endsWith("?"))]) {
        assert.ok(item.confidence >= 0.8 || item.confidence < 0.55, `${f.title}: ${"title" in item ? item.title : ""} ${item.confidence}`);
      }
    }
    assert.equal(classification().relevance, "HIGH");
  });
});
