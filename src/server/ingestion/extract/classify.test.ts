import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PersonType } from "@/generated/prisma/enums";
import { type ClassifyFacts, type CompanyFacts, type ParticipantFacts, classifyFacts, detectDocType, meetingCategoryFor, relevanceFromScore, teamCategory } from "./classify-rules";
import { SENT, TZ } from "./testing/fixtures";

const NORTHBRIDGE: CompanyFacts = { id: "c1", name: "Northbridge Ventures", type: "INVESTOR" };
const BRIGHTWATER: CompanyFacts = { id: "c2", name: "Brightwater Therapeutics", type: "PROSPECT" };
const AURELIUS: CompanyFacts = { id: "c3", name: "Aurelius Pharma", type: "CUSTOMER" };
const GRANITE: CompanyFacts = { id: "c4", name: "Granite Peak Capital", type: "INVESTOR" };
const NHI: CompanyFacts = { id: "c5", name: "Nordic Heart Institute", type: "ACADEMIC" };

function person(name: string, type: PersonType, opts: Partial<ParticipantFacts> & { title?: string; department?: string; company?: CompanyFacts | null } = {}): ParticipantFacts {
  const company = opts.company ?? null;
  return {
    email: opts.email ?? `${name.split(" ")[0].toLowerCase()}@x.example`,
    name,
    role: opts.role ?? "SENDER",
    person: { id: `p_${name}`, name, type, title: opts.title ?? null, department: opts.department ?? null, isCeo: false, company },
    company,
    internal: type === "TEAM",
    isCeo: false,
  };
}

const CEO_P: ParticipantFacts = { email: "ceo@cytohub.example", name: "Rajib Sen", role: "RECIPIENT", person: null, company: null, internal: true, isCeo: true };

function emailFacts(o: { title: string; text: string; participants: ParticipantFacts[]; ceoInTo?: boolean; ceoInCc?: boolean; isAutomated?: boolean; fromEmail?: string; labels?: string[]; direction?: "INBOUND" | "OUTBOUND" | "INTERNAL"; ceoInThread?: boolean }): ClassifyFacts {
  return {
    kind: "EMAIL_MESSAGE",
    title: o.title,
    text: o.text,
    occurredAt: SENT,
    timezone: TZ,
    ceoFirstName: "Rajib",
    defaultSensitivity: "CONFIDENTIAL",
    participants: [...o.participants, { ...CEO_P, role: o.ceoInCc ? "CC" : "RECIPIENT" }],
    mentionedCompanies: [],
    email: {
      direction: o.direction ?? "INBOUND",
      isAutomated: o.isAutomated ?? false,
      fromEmail: o.fromEmail ?? o.participants[0]?.email ?? "x@x.example",
      labels: o.labels ?? ["INBOX"],
      ceoInTo: o.ceoInTo ?? !o.ceoInCc,
      ceoInCc: o.ceoInCc ?? false,
      recipientCount: 1 + o.participants.length,
      ceoInThread: o.ceoInThread ?? false,
      attachmentNames: [],
    },
  };
}

describe("classification: noise", () => {
  it("newsletters are NOISE", () => {
    const c = classifyFacts(
      emailFacts({
        title: "BioPharma Dive Weekly Digest — issue #212",
        text: "Top stories this week in cardiac safety.\nUnsubscribe | Manage preferences",
        participants: [{ email: "newsletter@biopharmadive.example", name: "BioPharma Dive", role: "SENDER", person: null, company: null, internal: false, isCeo: false }],
        fromEmail: "newsletter@biopharmadive.example",
        isAutomated: true,
      }),
    );
    assert.equal(c.isNoise, true);
    assert.equal(c.relevance, "NOISE");
    assert.equal(c.category, "NEWSLETTER");
  });

  it("marketing, notifications and spam", () => {
    const vendor = { email: "marketing@labsupply.example", name: "LabSupply", role: "SENDER" as const, person: null, company: null, internal: false, isCeo: false };
    assert.equal(classifyFacts(emailFacts({ title: "Save 30% off pipettes — register now for our webinar", text: "Limited time. Unsubscribe.", participants: [vendor] })).category, "MARKETING");
    const receipt = { ...vendor, email: "no-reply@billing.example" };
    const n = classifyFacts(emailFacts({ title: "Your receipt from Example Cloud", text: "Thanks for your payment.", participants: [receipt], fromEmail: receipt.email }));
    assert.equal(n.category, "NOTIFICATION");
    assert.equal(n.isNoise, true);
    assert.equal(classifyFacts(emailFacts({ title: "Congratulations", text: "You have won the lottery! Claim your prize.", participants: [vendor] })).category, "SPAM");
  });

  it("a noise-looking email from a known investor is NOT noise", () => {
    const sarah = person("Sarah Chen", "INVESTOR", { title: "Partner", company: NORTHBRIDGE });
    const c = classifyFacts(emailFacts({ title: "Northbridge portfolio newsletter — Q3 digest", text: "Rajib, can you share a two-line update for our LP letter by Friday?\nUnsubscribe", participants: [sarah] }));
    assert.equal(c.isNoise, false);
    assert.equal(c.category, "INVESTOR");
  });

  it("outbound mail is never noise", () => {
    const c = classifyFacts(emailFacts({ title: "Re: webinar", text: "Thanks, no.", participants: [person("Karen Liu", "CUSTOMER", { role: "RECIPIENT", company: BRIGHTWATER })], direction: "OUTBOUND", ceoInTo: false }));
    assert.equal(c.isNoise, false);
  });
});

describe("classification: CEO category and relevance", () => {
  it("investor email asking the CEO with a deadline → INVESTOR, CRITICAL/HIGH, with reasons", () => {
    const sarah = person("Sarah Chen", "INVESTOR", { title: "Partner", company: NORTHBRIDGE });
    const c = classifyFacts(emailFacts({ title: "Series B next steps", text: "Hi Rajib,\n\nCould you share the updated data room index by Thursday? We are targeting a $40M round.", participants: [sarah] }));
    assert.equal(c.category, "INVESTOR");
    assert.ok(c.relevance === "CRITICAL" || c.relevance === "HIGH", c.relevance);
    assert.ok(c.relevanceScore >= 0.85);
    assert.ok(c.reasons.includes("Investor: Northbridge Ventures"));
    assert.ok(c.reasons.includes("Asks you directly"));
    assert.ok(c.reasons.includes("Deadline: Thursday"));
    assert.ok(c.reasons.some((r) => r.startsWith("Mentions $40M")));
    assert.ok(c.activityTags.includes("FUNDRAISING"));
  });

  it("investor update without an ask is HIGH, not CRITICAL; CC lowers relevance", () => {
    const sarah = person("Sarah Chen", "INVESTOR", { company: NORTHBRIDGE });
    const direct = classifyFacts(emailFacts({ title: "Portfolio update", text: "Sharing our latest thinking on cardiac safety.", participants: [sarah] }));
    assert.equal(direct.relevance, "HIGH");
    const cc = classifyFacts(emailFacts({ title: "Portfolio update", text: "Sharing our latest thinking on cardiac safety.", participants: [sarah], ceoInCc: true }));
    assert.ok(cc.relevanceScore < direct.relevanceScore);
    assert.ok(cc.reasons.includes("You're cc'd"));
  });

  it("board member → BOARD and RESTRICTED", () => {
    const michael = person("Michael Grant", "BOARD", { title: "Managing Partner · Board member", company: GRANITE });
    const c = classifyFacts(emailFacts({ title: "Board pre-read", text: "Attached is my feedback on the board deck.", participants: [michael] }));
    assert.equal(c.category, "BOARD");
    assert.equal(c.sensitivity, "RESTRICTED");
    assert.ok(c.reasons.includes("Board member: Michael Grant"));
  });

  it("prospect → COMMERCIAL_OPPORTUNITY; customer → CUSTOMER", () => {
    assert.equal(classifyFacts(emailFacts({ title: "MSA", text: "Thanks for the call.", participants: [person("Karen Liu", "CUSTOMER", { company: BRIGHTWATER })] })).category, "COMMERCIAL_OPPORTUNITY");
    assert.equal(classifyFacts(emailFacts({ title: "Site 3", text: "Update on the rollout.", participants: [person("James Whitfield", "CUSTOMER", { company: AURELIUS })] })).category, "CUSTOMER");
  });

  it("customer escalation is CRITICAL", () => {
    const rachel = person("Rachel Moore", "CUSTOMER", { company: { id: "c9", name: "Lumen Biologics", type: "CUSTOMER" } });
    const c = classifyFacts(emailFacts({ title: "Turnaround times", text: "Rajib, this is unacceptable. Please call me today.", participants: [rachel] }));
    assert.equal(c.category, "CUSTOMER");
    assert.equal(c.relevance, "CRITICAL");
    assert.ok(c.reasons.includes("Escalation language"));
  });

  it("team members by title / department, and internal escalation", () => {
    assert.equal(teamCategory("Chief Financial Officer", "Finance"), "FINANCE");
    assert.equal(teamCategory("General Counsel", "Legal"), "LEGAL");
    assert.equal(teamCategory("Head of People", "People"), "RECRUITING");
    assert.equal(teamCategory("Chief Scientific Officer", "Science"), "SCIENTIFIC_LEADERSHIP");
    assert.equal(teamCategory("Head of Product", "Product"), "EXECUTIVE_TEAM");
    const jonas = person("Jonas Weber", "TEAM", { title: "Chief Financial Officer", department: "Finance" });
    assert.equal(classifyFacts(emailFacts({ title: "October close", text: "Close is on track.", participants: [jonas], direction: "INTERNAL" })).category, "FINANCE");
    const c = classifyFacts(emailFacts({ title: "URGENT: assay outage", text: "The plate reader is down; this is urgent.", participants: [person("Maya Lindqvist", "TEAM", { title: "Chief Scientific Officer" })], direction: "INTERNAL" }));
    assert.equal(c.category, "INTERNAL_ESCALATION");
  });

  it("keyword overlays: fundraising and legal on weak categories; personal", () => {
    const jonas = person("Jonas Weber", "TEAM", { title: "Chief Financial Officer", department: "Finance" });
    const f = classifyFacts(emailFacts({ title: "Data room", text: "I uploaded the cap table to the data room for diligence.", participants: [jonas], direction: "INTERNAL" }));
    assert.equal(f.category, "FUNDRAISING");
    assert.equal(f.sensitivity, "RESTRICTED");
    const lawyer = { email: "a@lawfirm.example", name: "A. Counsel", role: "SENDER" as const, person: null, company: null, internal: false, isCeo: false };
    const l = classifyFacts(emailFacts({ title: "Redlines", text: "Our redline of clause 7.3 is attached.", participants: [lawyer] }));
    assert.equal(l.category, "LEGAL");
    assert.equal(l.sensitivity, "RESTRICTED");
    const dentist = { email: "frontdesk@smiles.example", name: "Smiles Dental", role: "SENDER" as const, person: null, company: null, internal: false, isCeo: false };
    const p = classifyFacts(emailFacts({ title: "Appointment reminder", text: "Your dentist appointment is Thursday at 4pm.", participants: [dentist] }));
    assert.equal(p.category, "PERSONAL");
    assert.equal(p.sensitivity, "RESTRICTED");
  });

  it("candidate offers are RECRUITING and RESTRICTED", () => {
    const laura = person("Laura Mitchell", "CANDIDATE", { title: "VP Sales candidate" });
    const c = classifyFacts(emailFacts({ title: "Offer", text: "Thanks for the offer — can we discuss the equity grant?", participants: [laura] }));
    assert.equal(c.category, "RECRUITING");
    assert.equal(c.sensitivity, "RESTRICTED");
  });

  it("academic partner on science → SCIENTIFIC_LEADERSHIP", () => {
    const ingrid = person("Ingrid Holm", "PARTNER", { title: "Director", company: NHI });
    assert.equal(classifyFacts(emailFacts({ title: "Donor heart data", text: "The tissue validation dataset is ready.", participants: [ingrid] })).category, "SCIENTIFIC_LEADERSHIP");
    assert.equal(classifyFacts(emailFacts({ title: "Dinner", text: "Great to see you in Copenhagen.", participants: [ingrid] })).category, "STRATEGIC_PARTNER");
  });

  it("never lowers sensitivity below the connection default", () => {
    const facts = emailFacts({ title: "Hello", text: "Hi.", participants: [person("Karen Liu", "CUSTOMER", { company: BRIGHTWATER })] });
    assert.equal(classifyFacts({ ...facts, defaultSensitivity: "RESTRICTED" }).sensitivity, "RESTRICTED");
    assert.equal(classifyFacts(facts).sensitivity, "CONFIDENTIAL");
  });

  it("thresholds", () => {
    assert.equal(relevanceFromScore(0.9), "CRITICAL");
    assert.equal(relevanceFromScore(0.85), "CRITICAL");
    assert.equal(relevanceFromScore(0.7), "HIGH");
    assert.equal(relevanceFromScore(0.5), "NORMAL");
    assert.equal(relevanceFromScore(0.2), "LOW");
  });
});

describe("classification: calendar", () => {
  const event = (title: string, attendees: ParticipantFacts[]): ClassifyFacts => ({
    kind: "CALENDAR_EVENT",
    title,
    text: title,
    occurredAt: SENT,
    timezone: TZ,
    ceoFirstName: "Rajib",
    defaultSensitivity: "CONFIDENTIAL",
    participants: [{ ...CEO_P, role: "ATTENDEE" }, ...attendees.map((a) => ({ ...a, role: "ATTENDEE" as const }))],
    mentionedCompanies: [],
    event: { status: "CONFIRMED", ceoResponse: "ACCEPTED", isRecurring: false, attendeeCount: attendees.length + 1, ceoIsOrganizer: false },
  });

  it("meeting categories from attendees and title keywords", () => {
    const sarah = person("Sarah Chen", "INVESTOR", { title: "Partner", company: NORTHBRIDGE });
    const maya = person("Maya Lindqvist", "TEAM", { title: "Chief Scientific Officer" });
    assert.equal(meetingCategoryFor(event("Northbridge partner meeting", [sarah])), "INVESTOR");
    assert.equal(meetingCategoryFor(event("Diligence session: data room walkthrough", [sarah])), "FUNDRAISING");
    assert.equal(meetingCategoryFor(event("Q4 Board meeting", [person("Michael Grant", "BOARD", { company: GRANITE })])), "BOARD");
    assert.equal(meetingCategoryFor(event("Aurelius QBR", [person("James Whitfield", "CUSTOMER", { company: AURELIUS })])), "CUSTOMER");
    assert.equal(meetingCategoryFor(event("Brightwater MSA call", [person("Karen Liu", "CUSTOMER", { company: BRIGHTWATER })])), "SALES");
    assert.equal(meetingCategoryFor(event("Interview: VP Sales", [person("Laura Mitchell", "CANDIDATE")])), "RECRUITING");
    assert.equal(meetingCategoryFor(event("1:1 Maya", [maya])), "INTERNAL_LEADERSHIP");
    assert.equal(meetingCategoryFor(event("Weekly leadership standup", [maya])), "INTERNAL_LEADERSHIP");
    assert.equal(meetingCategoryFor(event("HeartReady data review", [maya])), "SCIENTIFIC");
    assert.equal(meetingCategoryFor(event("Dentist", [])), "PERSONAL");
  });

  it("senior external attendees raise relevance; board meetings are restricted", () => {
    const michael = person("Michael Grant", "BOARD", { title: "Managing Partner · Board member", company: GRANITE });
    const c = classifyFacts(event("Q4 Board meeting", [michael]));
    assert.equal(c.meetingCategory, "BOARD");
    assert.equal(c.category, "BOARD");
    assert.equal(c.sensitivity, "RESTRICTED");
    assert.ok(c.reasons.some((r) => r.startsWith("Senior external attendee")));
    assert.ok(c.relevance === "CRITICAL" || c.relevance === "HIGH");
    const p = classifyFacts(event("Dentist", []));
    assert.equal(p.category, "PERSONAL");
    assert.equal(p.relevance, "LOW");
  });
});

describe("classification: documents", () => {
  it("document types from title and content", () => {
    assert.equal(detectDocType("CytoHub Series B investor deck", null, "We are raising $40M to scale the dataset.", "PPTX").type, "INVESTOR_DECK");
    assert.equal(detectDocType("Runway model FY27", null, "Monthly burn and runway by scenario", "XLSX").type, "FINANCIAL_MODEL");
    assert.equal(detectDocType("Brightwater MSA v3", null, "This Master Services Agreement", "DOCX").type, "CUSTOMER_CONTRACT");
    assert.equal(detectDocType("Aster Cloud compute partnership agreement", null, "", "PDF").type, "PARTNERSHIP_AGREEMENT");
    assert.equal(detectDocType("Mutual NDA - Vantage", null, "", "PDF").type, "NDA");
    assert.equal(detectDocType("Calder validation study SOW", null, "", "DOCX").type, "CUSTOMER_PROPOSAL");
    assert.equal(detectDocType("Q4 Board pre-read", null, "", "PDF").type, "BOARD_DOCUMENT");
    assert.equal(detectDocType("CardioPredict v2 validation report", null, "", "PDF").type, "EXPERIMENT_REPORT");
    assert.equal(detectDocType("Human heart dataset manuscript draft", null, "", "DOCX").type, "PUBLICATION");
    assert.equal(detectDocType("HeartReady pre-IND briefing package", null, "", "PDF").type, "REGULATORY_DOCUMENT");
    assert.equal(detectDocType("CytoHub.AI API spec", null, "", "MARKDOWN").type, "PRODUCT_SPECIFICATION");
    assert.equal(detectDocType("Leadership meeting notes", null, "", "DOCX").type, "MEETING_NOTES");
    assert.equal(detectDocType("Memo: pricing changes", null, "", "DOCX").type, "INTERNAL_MEMO");
    assert.equal(detectDocType("Employee handbook 2026", null, "", "PDF").type, "EMPLOYEE_DOCUMENT");
    assert.equal(detectDocType("plate_reads_oct", "/data/plate_reads_oct.csv", "donor_id,well,apd90,beat_rate", "CSV").type, "SCIENTIFIC_DATA_SUMMARY");
    assert.equal(detectDocType("Random notes", null, "", "TXT").type, "MEETING_NOTES");
    assert.equal(detectDocType("Photo", null, "", "IMAGE").type, "OTHER");
  });

  it("financial model is RESTRICTED and FINANCE with document reason", () => {
    const c = classifyFacts({
      kind: "DOCUMENT",
      title: "Runway model FY27",
      text: "Monthly burn $1.2M; runway 19 months.",
      occurredAt: SENT,
      timezone: TZ,
      ceoFirstName: "Rajib",
      defaultSensitivity: "CONFIDENTIAL",
      participants: [],
      mentionedCompanies: [],
      document: { path: "/Finance/Runway model FY27.xlsx", format: "XLSX", mimeType: "application/vnd.ms-excel" },
    });
    assert.equal(c.docType, "FINANCIAL_MODEL");
    assert.ok((c.docTypeConfidence ?? 0) >= 0.8);
    assert.equal(c.category, "FINANCE");
    assert.equal(c.sensitivity, "RESTRICTED");
    assert.ok(c.reasons.includes("Financial model"));
  });
});
