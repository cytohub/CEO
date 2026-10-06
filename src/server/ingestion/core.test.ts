import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyExtraction, evidenceFound, extractionJsonSchema, normalizeForEvidence, validateExtraction } from "./extraction-schema";
import { backoffMs } from "./jobs/queue";
import { contentHashFor } from "./raw";
import { nextSyncTime } from "./scheduler";

const SOURCE = "Rajib, please send the revised data package by Friday. Once we review it, we can discuss expanding the study.";
const now = new Date("2026-10-06T15:00:00Z");

const task = (evidence: string, dueDate: string | null = "2026-10-09") => ({
  title: "Send revised data package",
  description: null,
  ownerName: "Rajib",
  ownerIsCeo: true,
  dueDate,
  dueText: "by Friday",
  priorityHint: null,
  companyName: null,
  focusArea: null,
  confidence: 0.9,
  evidence,
});

describe("extraction validation", () => {
  it("keeps items whose evidence is quoted from the source", () => {
    const { extraction, issues } = validateExtraction({ ...emptyExtraction(), tasks: [task("please send the revised data package by Friday.")] }, SOURCE, now);
    assert.equal(extraction.tasks.length, 1);
    assert.equal(issues.length, 0);
  });

  it("drops hallucinated items and reports them", () => {
    const { extraction, issues } = validateExtraction({ ...emptyExtraction(), tasks: [task("sign the contract tomorrow")] }, SOURCE, now);
    assert.equal(extraction.tasks.length, 0);
    assert.match(issues[0].reason, /verbatim/);
  });

  it("tolerates typographic quotes, case and whitespace, and elided quotes", () => {
    assert.ok(evidenceFound("Please  send the REVISED data package", normalizeForEvidence(SOURCE)));
    assert.ok(evidenceFound("please send … expanding the study", normalizeForEvidence(SOURCE)));
    assert.ok(!evidenceFound("please send … signing the contract", normalizeForEvidence(SOURCE)));
  });

  it("nulls out-of-range dates instead of writing them", () => {
    const { extraction, issues } = validateExtraction({ ...emptyExtraction(), tasks: [task("please send the revised data package", "1999-01-01")] }, SOURCE, now);
    assert.equal(extraction.tasks[0].dueDate, null);
    assert.ok(issues.some((i) => i.path.endsWith("dueDate")));
  });

  it("turns unparseable output into an empty extraction", () => {
    const { extraction, issues } = validateExtraction({ tasks: "nope" }, SOURCE, now);
    assert.deepEqual(extraction, emptyExtraction());
    assert.ok(issues.length > 0);
  });

  it("exposes a strict JSON schema for structured outputs", () => {
    const schema = extractionJsonSchema() as { additionalProperties: boolean; required: string[]; properties: Record<string, unknown> };
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
    assert.ok(!JSON.stringify(schema).includes("maxLength"));
  });
});

describe("pipeline plumbing", () => {
  it("hashes content deterministically and sensitively", () => {
    const a = contentHashFor({ kind: "EMAIL_MESSAGE", title: "Hi", text: "Body" });
    assert.equal(a, contentHashFor({ kind: "EMAIL_MESSAGE", title: "Hi", text: "Body" }));
    assert.notEqual(a, contentHashFor({ kind: "EMAIL_MESSAGE", title: "Hi", text: "Body!" }));
    assert.notEqual(a, contentHashFor({ kind: "EMAIL_MESSAGE", title: "Hi", text: "Body", hashMaterial: "start=10:00" }));
  });

  it("backs off exponentially with jitter and a ceiling", () => {
    for (let attempt = 1; attempt <= 12; attempt++) {
      const ms = backoffMs(attempt);
      assert.ok(ms >= 15_000 * 0.75 * Math.min(2 ** (attempt - 1), 120) - 1);
      assert.ok(ms <= 30 * 60_000 * 1.25 + 1);
    }
  });

  it("schedules syncs by frequency and backs off after failures", () => {
    const from = new Date("2026-10-06T12:00:00Z");
    assert.equal(nextSyncTime({ syncFrequency: "MANUAL", consecutiveFailures: 0 }, from), null);
    assert.equal(nextSyncTime({ syncFrequency: "HOURLY", consecutiveFailures: 0 }, from)?.toISOString(), "2026-10-06T13:00:00.000Z");
    assert.equal(nextSyncTime({ syncFrequency: "DAILY", consecutiveFailures: 0 }, from)?.toISOString(), "2026-10-07T12:00:00.000Z");
    const failing = nextSyncTime({ syncFrequency: "HOURLY", consecutiveFailures: 5 }, from)!;
    assert.equal(failing.getTime() - from.getTime(), 240 * 60_000);
  });
});
