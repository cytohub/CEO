import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { familyMembers, familyRoot, knownForms, knownOrganizationByName, knownParent } from "./known-organizations";

describe("known pharma families", () => {
  it("maps abbreviations to the canonical organization", () => {
    assert.equal(knownOrganizationByName("J&J")?.canonical, "Johnson & Johnson");
    assert.equal(knownOrganizationByName("JNJ")?.canonical, "Johnson & Johnson");
    assert.equal(knownOrganizationByName("Johnson and Johnson")?.canonical, "Johnson & Johnson");
    assert.equal(knownOrganizationByName("MSD")?.canonical, "Merck & Co.");
    assert.equal(knownOrganizationByName("Merck & Co., Inc.")?.canonical, "Merck & Co.");
    assert.equal(knownOrganizationByName("AZ")?.canonical, "AstraZeneca");
    assert.equal(knownOrganizationByName("GlaxoSmithKline")?.canonical, "GSK");
    assert.equal(knownOrganizationByName("Bristol-Myers Squibb")?.canonical, "Bristol Myers Squibb");
    assert.equal(knownOrganizationByName("BI")?.canonical, "Boehringer Ingelheim");
    assert.equal(knownOrganizationByName("Lilly")?.canonical, "Eli Lilly");
    assert.equal(knownOrganizationByName("Brightwater Therapeutics"), null);
  });

  it("knows subsidiaries and their parents", () => {
    const janssen = knownOrganizationByName("Janssen Pharmaceuticals, Inc.");
    assert.equal(janssen?.canonical, "Janssen");
    assert.equal(knownParent(janssen!)?.canonical, "Johnson & Johnson");
    assert.equal(familyRoot(knownOrganizationByName("Genentech")!).canonical, "Roche");
    assert.equal(familyRoot(knownOrganizationByName("Genzyme")!).canonical, "Sanofi");
    assert.equal(familyRoot(knownOrganizationByName("Allergan")!).canonical, "AbbVie");
    assert.equal(familyRoot(knownOrganizationByName("Shire")!).canonical, "Takeda");
  });

  it("lists a whole family from any member", () => {
    const names = familyMembers(knownOrganizationByName("J&J")!).map((o) => o.canonical);
    assert.deepEqual(names, ["Johnson & Johnson", "Janssen"]);
    assert.ok(familyMembers(knownOrganizationByName("Genentech")!).some((o) => o.canonical === "Chugai"));
    assert.ok(knownForms(knownOrganizationByName("JNJ")!).includes("j and j"));
  });
});
