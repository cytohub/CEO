import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MentionDraft } from "../types";
import { actionLineOwners, extractMentions, scanSignatures, scanTextMentions } from "./mentions";
import { CEO, CEO_PARTY, JONAS, KAREN, MAYA, SARAH, documentItem, emailItem, eventItem, notesItem } from "./testing/fixtures";
import { companyNameFromDomain, isFreeMailDomain, registrableDomain } from "./text";

const find = (ms: MentionDraft[], type: MentionDraft["entityType"], text: string) => ms.find((m) => m.entityType === type && m.text === text);

describe("extractMentions: email", () => {
  const item = emailItem({
    from: KAREN,
    to: [CEO_PARTY],
    cc: [{ name: "Priya Raman", email: "priya@cytohub.example" }, { name: "Tom", email: "tom.k@gmail.com" }],
    subject: "Revised data package for CardioPredict",
    text: "Hi Rajib,\n\nPlease send the revised data package by Friday. Dr. Henrik Sørensen at Calder Biosciences suggested HeartReady data too, ahead of your Series B.\n\nBest,\nKaren\nKaren Liu | VP Discovery | Brightwater Therapeutics",
  });
  const ms = extractMentions(item, CEO);

  it("captures sender, recipients and cc with roles, emails and domains", () => {
    const karen = ms.find((m) => m.email === "karen@brightwater.example")!;
    assert.equal(karen.role, "SENDER");
    assert.equal(karen.entityType, "PERSON");
    assert.equal(karen.text, "Karen Liu");
    assert.equal(karen.domain, "brightwater.example");
    assert.ok(karen.confidence >= 0.9);
    assert.equal(ms.find((m) => m.email === "priya@cytohub.example")!.role, "CC");
  });

  it("keeps the CEO's own address as a mention (resolution decides)", () => {
    const ceo = ms.find((m) => m.email === CEO.email)!;
    assert.equal(ceo.role, "RECIPIENT");
  });

  it("derives companies from business domains only (not free mail, not our own domain)", () => {
    const companies = ms.filter((m) => m.entityType === "COMPANY");
    const bw = companies.find((c) => c.domain === "brightwater.example")!;
    assert.equal(bw.role, "SENDER");
    assert.equal(bw.text, "Brightwater Therapeutics", "upgraded from the signature");
    assert.ok(!companies.some((c) => c.domain === "gmail.com"));
    assert.ok(!companies.some((c) => c.domain === "cytohub.example"));
  });

  it("finds organizations, titled people and products in the body", () => {
    assert.ok(find(ms, "COMPANY", "Calder Biosciences"));
    const henrik = find(ms, "PERSON", "Dr. Henrik Sørensen")!;
    assert.equal(henrik.role, "MENTIONED");
    assert.ok(henrik.confidence < 0.9);
    assert.ok(find(ms, "PROJECT", "CardioPredict"));
    assert.ok(find(ms, "PROJECT", "HeartReady"));
    assert.ok(find(ms, "PROJECT", "Series B"));
  });

  it("deduplicates the signature name into the sender", () => {
    assert.equal(ms.filter((m) => m.entityType === "PERSON" && /Karen/.test(m.text)).length, 1);
  });
});

describe("extractMentions: calendar, documents, notes", () => {
  it("calendar: organizer and attendees with their companies", () => {
    const ms = extractMentions(
      eventItem({ title: "Northbridge partner meeting", description: "Agenda: Series B terms with Granite Peak Capital", organizer: SARAH, attendees: [SARAH, CEO_PARTY, MAYA, { name: "Room 4", email: "c_188@resource.calendar.google.com" }] }),
      CEO,
    );
    assert.equal(ms.find((m) => m.email === SARAH.email)!.role, "ORGANIZER");
    assert.equal(ms.find((m) => m.email === MAYA.email)!.role, "ATTENDEE");
    assert.ok(ms.find((m) => m.entityType === "COMPANY" && m.domain === "northbridge.example"));
    assert.ok(find(ms, "COMPANY", "Granite Peak Capital"));
    assert.ok(!ms.some((m) => m.email?.includes("resource.calendar")));
  });

  it("documents: author and organizations", () => {
    const ms = extractMentions(documentItem({ title: "Brightwater MSA v3", author: "Jonas Weber", text: "This Master Services Agreement is between CytoHub Inc. and Brightwater Therapeutics, Inc." }), CEO);
    assert.equal(find(ms, "PERSON", "Jonas Weber")!.role, "AUTHOR");
    assert.ok(ms.some((m) => m.entityType === "COMPANY" && /^Brightwater Therapeutics/.test(m.text)));
    assert.ok(!ms.some((m) => m.entityType === "COMPANY" && /^CytoHub/.test(m.text)), "our own company is not a counterparty mention");
  });

  it("meeting notes: owners of action lines", () => {
    const ms = extractMentions(notesItem("Attendees: CEO, Maya, Jonas\nAction items:\n- Maya to send the assay report by Oct 9\n- [ ] Jonas to update the runway model\nPriya: follow up with Calder"), CEO);
    for (const n of ["Maya", "Jonas", "Priya"]) assert.ok(find(ms, "PERSON", n), n);
  });

  it("dedupes by type + email / normalized text", () => {
    const ms = extractMentions(emailItem({ from: JONAS, to: [CEO_PARTY, JONAS], subject: "Model", text: "Jonas Weber here. Jonas Weber again." }), CEO);
    assert.equal(ms.filter((m) => m.email === JONAS.email).length, 1);
    assert.equal(ms.find((m) => m.email === JONAS.email)!.role, "SENDER");
  });
});

describe("text scanning helpers", () => {
  it("parses pipe signatures and sign-off blocks", () => {
    assert.deepEqual(scanSignatures("Karen Liu | VP Discovery | Brightwater Therapeutics"), [{ name: "Karen Liu", title: "VP Discovery", org: "Brightwater Therapeutics" }]);
    const block = scanSignatures("Thanks,\nSarah Chen\nPartner\nNorthbridge Ventures\n+1 617 555 0100");
    assert.deepEqual(block, [{ name: "Sarah Chen", title: "Partner", org: "Northbridge Ventures" }]);
  });
  it("is conservative with capitalized words", () => {
    const ms = scanTextMentions("Great Meeting today. Thanks Karen Liu for hosting. The Board approved it. Please Review The Deck.");
    assert.ok(ms.some((m) => m.text === "Karen Liu"));
    assert.ok(!ms.some((m) => /Great|Board|Review|Deck/.test(m.text)));
  });
  it("lists action-line owners", () => {
    assert.deepEqual(actionLineOwners("Action: Maya to send the deck\nAI: Tom will retrain the model\nWe to discuss"), ["Maya", "Tom"]);
  });
  it("domain helpers", () => {
    assert.equal(isFreeMailDomain("gmail.com"), true);
    assert.equal(isFreeMailDomain("yahoo.fr"), true);
    assert.equal(isFreeMailDomain("brightwater.example"), false);
    assert.equal(registrableDomain("mail.aurelius.co.uk"), "aurelius.co.uk");
    assert.equal(companyNameFromDomain("aster-cloud.com"), "Aster Cloud");
    assert.equal(companyNameFromDomain("nhi.example"), "NHI");
  });
});
