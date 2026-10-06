import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  companyCoreName,
  companyShortName,
  conversationalName,
  domainLookupKeys,
  domainOf,
  isFreeMailDomain,
  isFuzzyCompanyMatch,
  isNameLike,
  isRoleMailbox,
  jaroWinkler,
  looksLikeInvestor,
  normalizeCompanyName,
  normalizePersonName,
  personDisplayName,
  prettifyDomain,
  prettifyLocalPart,
  registrableLabel,
  stripAccents,
  tokenSetSimilarity,
} from "./names";

describe("person names", () => {
  it("strips titles, suffixes, accents and punctuation", () => {
    assert.equal(normalizePersonName("Dr. Henrik Sørensen, PhD"), "henrik sorensen");
    assert.equal(normalizePersonName("Prof. Ingrid Holm"), "ingrid holm");
    assert.equal(normalizePersonName("Mrs.  Anna   Berg MD"), "anna berg");
    assert.equal(normalizePersonName("José Álvarez-Núñez"), "jose alvarez nunez");
    assert.equal(normalizePersonName("Sarah O’Neil"), "sarah oneil");
  });

  it("swaps Last, First and ignores parentheticals and addresses", () => {
    assert.equal(normalizePersonName("Sørensen, Henrik"), "henrik sorensen");
    assert.equal(normalizePersonName("Karen Liu (Brightwater)"), "karen liu");
    assert.equal(normalizePersonName("Karen Liu <karen@brightwater.example>"), "karen liu");
  });

  it("handles letters NFD cannot decompose", () => {
    assert.equal(stripAccents("Sørensen Ærø Straße Łódź"), "Sorensen AEro Strasse Lodz");
  });

  it("derives display names", () => {
    assert.equal(prettifyLocalPart("henrik.sorensen"), "Henrik Sorensen");
    assert.equal(prettifyLocalPart("j_doe+cytohub"), "J Doe");
    assert.equal(personDisplayName("Sørensen, Henrik", "h@calder.example"), "Henrik Sørensen");
    assert.equal(personDisplayName(null, "maria.garcia@atlas.example"), "Maria Garcia");
    assert.equal(personDisplayName("maria@atlas.example", "maria@atlas.example"), "Maria");
    assert.equal(conversationalName("Dr. Henrik Sørensen"), "Henrik Sørensen");
    assert.equal(conversationalName("Prof. Ingrid Holm, PhD"), "Ingrid Holm");
    assert.equal(isNameLike("Henrik"), true);
    assert.equal(isNameLike("henrik@calder.example"), false);
  });
});

describe("domains", () => {
  it("parses and walks domains", () => {
    assert.equal(domainOf("Karen@Brightwater.Example"), "brightwater.example");
    assert.equal(domainOf("nobody"), null);
    assert.deepEqual(domainLookupKeys("eu.mail.acme.com"), ["eu.mail.acme.com", "mail.acme.com", "acme.com"]);
    assert.equal(registrableLabel("mail.brightwater.co.uk"), "brightwater");
    assert.equal(prettifyDomain("brightwater-tx.example"), "Brightwater Tx");
    assert.equal(prettifyDomain("orbitventures.example"), "Orbit Ventures");
    assert.equal(prettifyDomain("atlasbiopartners.com"), "Atlas Bio Partners");
    assert.equal(prettifyDomain("bio.example"), "Bio");
  });

  it("recognizes free-mail and role mailboxes", () => {
    for (const d of ["gmail.com", "yahoo.co.uk", "outlook.com", "gmx.de", "icloud.com"]) assert.equal(isFreeMailDomain(d), true, d);
    assert.equal(isFreeMailDomain("brightwater.example"), false);
    assert.equal(isRoleMailbox("no-reply@calder.example"), true);
    assert.equal(isRoleMailbox("notifications+abc@github.com"), true);
    assert.equal(isRoleMailbox("henrik@calder.example"), false);
  });

  it("spots investment firms by name or domain", () => {
    assert.equal(looksLikeInvestor("Atlas Bio Partners", null), true);
    assert.equal(looksLikeInvestor(null, "orbitventures.example"), true);
    assert.equal(looksLikeInvestor("Brightwater Therapeutics", "brightwater.example"), false);
  });
});

describe("company names", () => {
  it("normalizes legal suffixes, ampersands and leading 'the'", () => {
    assert.equal(normalizeCompanyName("The Brightwater Therapeutics, Inc."), "brightwater therapeutics");
    assert.equal(normalizeCompanyName("Merck & Co."), "merck");
    assert.equal(normalizeCompanyName("Johnson & Johnson"), "johnson and johnson");
    assert.equal(normalizeCompanyName("Bayer AG"), "bayer");
    assert.equal(normalizeCompanyName("Novo Nordisk A/S"), "novo nordisk");
    assert.equal(normalizeCompanyName("GSK plc"), "gsk");
  });

  it("finds the distinctive core and a conversational short name", () => {
    assert.equal(companyCoreName("helix capital partners"), "helix");
    assert.equal(companyCoreName("nordic heart institute"), "nordic heart");
    assert.equal(companyCoreName("pharma"), "pharma");
    assert.equal(companyShortName("Lumen Biologics"), "Lumen");
    assert.equal(companyShortName("Granite Peak Capital"), "Granite Peak");
    assert.equal(companyShortName("Fjord Life Science Ventures"), "Fjord");
  });

  it("scores fuzzy matches", () => {
    assert.ok(jaroWinkler("brightwater", "brightwatter") > 0.95);
    assert.ok(jaroWinkler("aurelius", "calder") < 0.7);
    assert.equal(tokenSetSimilarity("aurelius pharma", "pharma aurelius"), 1);
    assert.ok(tokenSetSimilarity("aurelius", "aurelius pharma") >= 0.9);
    assert.ok(tokenSetSimilarity("pharma", "aurelius pharma") <= 0.5, "generic overlap is not a match");
    assert.equal(isFuzzyCompanyMatch("brightwater therapeutic", "brightwater therapeutics").match, true);
    assert.equal(isFuzzyCompanyMatch("lumen biologics", "calder biosciences").match, false);
  });
});
