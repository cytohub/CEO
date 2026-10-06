import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayFromKey } from "@/lib/dates";
import {
  buildEdit,
  coerceValue,
  commitmentDue,
  displayValue,
  fieldChangeLabel,
  fieldChangeSpec,
  formatBytes,
  getIn,
  humanizeKey,
  inferType,
  proposalFields,
  readCandidates,
  readChanges,
  readKeyFacts,
  readPeople,
  safeHttpUrl,
  setIn,
  severityLabel,
  sortByUrgency,
  validateEdit,
  validateUploadFile,
} from "./model";

describe("safeHttpUrl", () => {
  it("keeps http(s) links", () => {
    assert.equal(safeHttpUrl("https://drive.example/fx-deck"), "https://drive.example/fx-deck");
    assert.equal(safeHttpUrl("http://outlook.example/m/1?x=1"), "http://outlook.example/m/1?x=1");
  });
  it("drops script, data and file URLs and garbage", () => {
    assert.equal(safeHttpUrl("javascript:alert(1)"), null);
    assert.equal(safeHttpUrl("JaVaScRiPt:alert(1)"), null);
    assert.equal(safeHttpUrl("data:text/html,<script>"), null);
    assert.equal(safeHttpUrl("file:///etc/passwd"), null);
    assert.equal(safeHttpUrl("not a url"), null);
    assert.equal(safeHttpUrl(null), null);
    assert.equal(safeHttpUrl(`https://x.example/${"a".repeat(3000)}`), null);
  });
});

describe("validateUploadFile", () => {
  it("accepts allowed extensions under 25 MB", () => {
    assert.equal(validateUploadFile({ name: "Deck v7.PPTX", size: 2_000_000 }), null);
    assert.equal(validateUploadFile({ name: "notes.md", size: 10 }), null);
  });
  it("rejects other extensions, empty and oversized files", () => {
    assert.match(validateUploadFile({ name: "run.exe", size: 10 })!, /aren’t supported/);
    assert.match(validateUploadFile({ name: "noext", size: 10 })!, /aren’t supported/);
    assert.match(validateUploadFile({ name: "a.pdf", size: 0 })!, /empty/);
    assert.match(validateUploadFile({ name: "a.pdf", size: 25 * 1024 * 1024 + 1 })!, /limit is 25 MB/);
  });
  it("formats sizes", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5 MB");
    assert.equal(formatBytes(null), "—");
  });
});

describe("commitmentDue", () => {
  const today = dayFromKey("2026-10-06");
  it("labels overdue, today, soon and later", () => {
    assert.deepEqual(commitmentDue(dayFromKey("2026-10-05"), today), { days: -1, overdue: true, label: "1d overdue", tone: "critical" });
    assert.equal(commitmentDue(dayFromKey("2026-10-06"), today).label, "Due today");
    assert.equal(commitmentDue(dayFromKey("2026-10-08"), today).tone, "warning");
    assert.equal(commitmentDue(dayFromKey("2026-10-20"), today).tone, "neutral");
    assert.equal(commitmentDue(null, today).label, "No date");
  });
  it("never flags closed commitments as overdue", () => {
    const s = commitmentDue(dayFromKey("2026-10-01"), today, false);
    assert.equal(s.overdue, false);
    assert.equal(s.label, "Oct 1");
  });
  it("sorts overdue first, undated last", () => {
    const at = new Date("2026-10-01T00:00:00Z");
    const rows = [
      { id: "later", dueDate: dayFromKey("2026-10-20"), committedAt: at },
      { id: "none", dueDate: null, committedAt: at },
      { id: "overdue", dueDate: dayFromKey("2026-10-02"), committedAt: at },
      { id: "soon", dueDate: dayFromKey("2026-10-07"), committedAt: at },
    ];
    assert.deepEqual(
      sortByUrgency(rows).map((r) => r.id),
      ["overdue", "soon", "later", "none"],
    );
  });
});

describe("proposal field model", () => {
  it("humanizes keys", () => {
    assert.equal(humanizeKey("counterpartyName"), "Counterparty name");
    assert.equal(humanizeKey("due_text"), "Due text");
    assert.equal(humanizeKey("estimatedValueUSD"), "Estimated value usd");
  });

  it("shows known task fields first, editable always-on ones even when absent", () => {
    const fields = proposalFields("TASK", { title: "Book BIO-Europe meetings", ownerName: "Priya", confidence: 0.5, evidence: "Priya can book", scores: { strategicImpact: 3 } });
    assert.deepEqual(
      fields.map((x) => x.key),
      ["title", "ownerPersonId", "dueDate"],
    );
    const owner = fields.find((x) => x.key === "ownerPersonId")!;
    assert.equal(owner.nameValue, "Priya");
    assert.equal(owner.value, null);
    assert.ok(fields.every((x) => x.editable));
  });

  it("marks schema-locked fields read-only (commitment direction)", () => {
    const fields = proposalFields("COMMITMENT", { direction: "OUTBOUND", title: "Introduce Henrik to Maya", text: "I can probably introduce you.", dueDate: null, confidence: 0.6 });
    assert.equal(fields.find((x) => x.key === "direction")!.editable, false);
    assert.equal(fields.find((x) => x.key === "title")!.editable, true);
    assert.equal(fields.find((x) => x.key === "counterpartyPersonId")!.editable, true);
  });

  it("keeps unknown fields visible with inferred editors, hides internal ids", () => {
    const fields = proposalFields("COMMITMENT", {
      direction: "OUTBOUND",
      title: "Introduce Henrik to Maya",
      text: "I can probably introduce you to Maya next week.",
      counterpartyName: "Dr. Henrik Sørensen",
      companyId: "c1",
      threadId: "t1",
      urgencyScore: 0.4,
      channel: "email",
      tags: ["intro", "calder"],
    });
    const keys = fields.map((x) => x.key);
    assert.ok(keys.includes("companyId"));
    assert.ok(!keys.includes("threadId"));
    assert.ok(!keys.includes("counterpartyName"), "name is carried by the person picker");
    assert.equal(fields.find((x) => x.key === "counterpartyPersonId")!.nameValue, "Dr. Henrik Sørensen");
    const score = fields.find((x) => x.key === "urgencyScore")!;
    assert.equal(score.type, "number");
    assert.equal(score.editable, false, "unknown keys are read-only unless the schema allows editing them");
    assert.equal(fields.find((x) => x.key === "tags")!.type, "list");
  });

  it("flattens nested objects one level (read-only)", () => {
    const fields = proposalFields("NEW_INVESTOR", { name: "Halvorsen Capital", domain: "halvorsencapital.example", contact: { name: "Erik Halvorsen", email: "erik@halvorsencapital.example" } });
    const keys = fields.map((x) => x.key);
    assert.deepEqual(keys.slice(0, 3), ["name", "domain", "createDeal"]);
    const contact = fields.find((x) => x.key === "contact.email")!;
    assert.equal(contact.label, "Contact · email");
    assert.equal(contact.editable, false);
  });

  it("leaves structural keys to the dedicated renderers", () => {
    assert.deepEqual(proposalFields("ENTITY_MERGE", { entityType: "COMPANY", keepId: "a", keepLabel: "A", mergeId: "b", mergeLabel: "B", score: 0.9, reason: "x" }), []);
    const fc = proposalFields("FIELD_CHANGE", { targetType: "TASK", targetId: "t", targetLabel: "Send package", field: "dueDate", from: "2026-10-09", to: "2026-10-08", note: null, extra: "kept" });
    assert.deepEqual(
      fc.map((x) => x.key),
      ["to", "note", "extra"],
    );
    assert.equal(fc[0].type, "date");
    assert.equal(fc[0].label, "New due date");
  });

  it("types the FIELD_CHANGE editor by target field", () => {
    assert.equal(fieldChangeSpec("TASK", "ownerId").type, "person");
    assert.equal(fieldChangeSpec("DEAL", "value").type, "money");
    assert.equal(fieldChangeSpec("RISK", "severity").type, "rating");
    const status = fieldChangeSpec("COMMITMENT", "status");
    assert.equal(status.type, "enum");
    assert.ok(status.options!.some((o) => o.value === "FULFILLED"));
  });

  it("coerces values by type", () => {
    assert.equal(coerceValue("text", "  hi "), "hi");
    assert.equal(coerceValue("text", "   "), null);
    assert.equal(coerceValue("date", "2026-10-09"), "2026-10-09");
    assert.equal(coerceValue("date", "next friday"), null);
    assert.equal(coerceValue("money", "$350,000"), 350000);
    assert.equal(coerceValue("money", "abc"), null);
    assert.equal(coerceValue("rating", "9"), 5);
    assert.equal(coerceValue("boolean", "true"), true);
    assert.deepEqual(coerceValue("list", "a\n\n b \n"), ["a", "b"]);
  });

  it("builds the edit patch from editable fields only", () => {
    const draft = { title: "  Book BIO-Europe partnering meetings ", ownerName: "Priya", ownerPersonId: "p-priya", dueDate: "2026-10-20", confidence: 0.5, internal: "x" };
    const edit = buildEdit("TASK", draft);
    assert.deepEqual(edit, { title: "Book BIO-Europe partnering meetings", ownerPersonId: "p-priya", dueDate: "2026-10-20" });
    const fc = buildEdit("FIELD_CHANGE", { targetType: "TASK", targetId: "t", field: "dueDate", from: "2026-10-09", to: "2026-10-07", note: " ok " });
    assert.deepEqual(fc, { to: "2026-10-07", note: "ok" });
  });

  it("formats read-only values", () => {
    assert.equal(displayValue({ type: "money", value: 350000 }), "$350,000");
    assert.equal(displayValue({ type: "date", value: "2026-10-09" }), "Oct 9, 2026");
    assert.equal(displayValue({ type: "rating", value: 4 }), "4/5 · High");
    assert.equal(displayValue({ type: "text", value: null }), "—");
    assert.equal(displayValue({ type: "list", value: [] }), "—");
    assert.equal(severityLabel(1), "Minimal");
    assert.equal(fieldChangeLabel("expectedClose"), "Expected close");
  });

  it("infers editors for unknown values", () => {
    assert.equal(inferType("startsAt", "2026-10-09"), "date");
    assert.equal(inferType("dealValue", 10), "money");
    assert.equal(inferType("x", { a: 1 }), "json");
    assert.equal(inferType("rows", [{ a: 1 }]), "json");
  });

  it("pre-validates edits against the writer's schema, reporting only edited fields", () => {
    const stored = { title: "Book BIO-Europe meetings", ownerPersonId: null, ownerName: "Priya", dueDate: null, confidence: 0.5, evidence: "Priya can book" };
    assert.deepEqual(validateEdit("TASK", stored, { title: "Book meetings", dueDate: "2026-10-20" }), {});
    assert.ok(validateEdit("TASK", stored, { title: "" }).title);
    // A stored proposal missing required bookkeeping does not block the reviewer's fields.
    assert.deepEqual(validateEdit("TASK", { title: "x" }, { title: "Book meetings" }), {});
    const fc = { targetType: "TASK", targetId: "t1", targetLabel: "Send package", field: "dueDate", from: "2026-10-09", to: "2026-10-08", confidence: 0.7 };
    assert.deepEqual(validateEdit("FIELD_CHANGE", fc, { to: "2026-10-07", note: null }), {});
    assert.ok(validateEdit("FIELD_CHANGE", fc, { to: "soon" }).to);
  });

  it("round-trips nested set/get immutably", () => {
    const original = { contact: { name: "Erik" } };
    const next = setIn(original, ["contact", "name"], "Erik Halvorsen");
    assert.equal(getIn(next, ["contact", "name"]), "Erik Halvorsen");
    assert.equal(getIn(original, ["contact", "name"]), "Erik");
  });
});

describe("tolerant readers", () => {
  it("reads document changes and key facts", () => {
    assert.deepEqual(readChanges([{ label: "Series B raise amount", from: "$35M", to: "$40M", significance: "HIGH" }, "junk", { field: "Runway", to: 18 }]), [
      { label: "Series B raise amount", from: "$35M", to: "$40M", significance: "HIGH" },
      { label: "Runway", from: null, to: "18", significance: null },
    ]);
    assert.deepEqual(readChanges(null), []);
    assert.deepEqual(readKeyFacts([{ label: "Runway", value: "16.6 months", kind: "METRIC" }, { label: "" }]), [{ label: "Runway", value: "16.6 months", kind: "METRIC" }]);
  });
  it("reads candidates and participants", () => {
    assert.deepEqual(readCandidates([{ entityId: "a", label: "Aurelius", score: 0.97 }, { id: "b" }, {}]), [
      { entityId: "a", label: "Aurelius", score: 0.97 },
      { entityId: "b", label: "b", score: null },
    ]);
    assert.deepEqual(readPeople([{ name: "Sarah", email: "s@x.example" }, 3]), [{ name: "Sarah", email: "s@x.example", role: null, personId: null }]);
  });
});
