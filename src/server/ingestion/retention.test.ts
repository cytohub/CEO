import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachmentBlobWhere,
  DELETABLE_TYPES,
  derivedVerdict,
  documentBlobWhere,
  documentTextWhere,
  emailContentWhere,
  emptyCounts,
  extractionWhere,
  finishedJobWhere,
  RETENTION_RULES,
  retentionCutoffs,
  retentionPolicySchema,
  sessionWhere,
  type DerivedFacts,
} from "./retention";
import { DEFAULT_RETENTION, type RetentionPolicy } from "./retention-policy";

const NOW = new Date("2026-10-06T12:00:00Z");
const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

describe("retentionCutoffs", () => {
  it("turns day counts into instants before now", () => {
    const c = retentionCutoffs(DEFAULT_RETENTION, NOW);
    assert.equal(c.rawEmail?.toISOString(), daysAgo(365).toISOString());
    assert.equal(c.extraction?.toISOString(), daysAgo(180).toISOString());
    assert.equal(c.auditLog.toISOString(), daysAgo(730).toISOString());
    assert.equal(c.finishedJobs.toISOString(), daysAgo(30).toISOString());
  });

  it("keeps a class indefinitely when its days are null", () => {
    const c = retentionCutoffs(DEFAULT_RETENTION, NOW);
    assert.equal(c.documentText, null); // default: superseded text kept indefinitely
    assert.equal(documentTextWhere(c), null);
  });

  it("purges every attachment copy when attachments must not be stored", () => {
    const c = retentionCutoffs({ ...DEFAULT_RETENTION, storeAttachments: false, attachmentDays: null }, NOW);
    assert.equal(c.attachments?.toISOString(), NOW.toISOString());
    assert.ok(attachmentBlobWhere(c));
  });

  it("disables rules whose window is indefinite", () => {
    const forever: RetentionPolicy = { ...DEFAULT_RETENTION, rawEmailDays: null, attachmentDays: null, rawDocumentDays: null, documentTextDays: null, extractionOutputDays: null };
    const c = retentionCutoffs(forever, NOW);
    assert.equal(emailContentWhere(c), null);
    assert.equal(attachmentBlobWhere(c), null);
    assert.equal(documentBlobWhere(c), null);
    assert.equal(extractionWhere(c), null);
  });
});

describe("rule filters", () => {
  const c = retentionCutoffs(DEFAULT_RETENTION, NOW);

  it("purges only settled email items that still have content", () => {
    const where = emailContentWhere(c)!;
    const json = JSON.stringify(where);
    assert.match(json, /"kind":"EMAIL_MESSAGE"/);
    assert.match(json, /"contentPurgedAt":null/);
    // In-flight items wait unless they were ingested long ago (stuck).
    assert.match(json, /"notIn":\["PENDING","PROCESSING"\]/);
  });

  it("only purges a shared blob when every reference has aged out", () => {
    const where = attachmentBlobWhere(c)!;
    assert.ok(where.attachments && "every" in where.attachments && "some" in where.attachments);
    assert.deepEqual(where.versions, { none: {} });
    const docs = documentBlobWhere(c)!;
    assert.ok(docs.versions && "every" in docs.versions);
  });

  it("measures superseded text from when the next version replaced it", () => {
    const where = retentionCutoffs({ ...DEFAULT_RETENTION, documentTextDays: 90 }, NOW);
    const w = documentTextWhere(where)!;
    assert.deepEqual(w.nextVersion, { is: { createdAt: { lt: daysAgo(90) } } });
  });

  it("expires sessions that ended, were revoked a day ago, or outlived the absolute lifetime", () => {
    const w = sessionWhere(c);
    assert.equal(w.OR?.length, 3);
  });

  it("cleans finished jobs only (never queued, running or retrying ones)", () => {
    const w = finishedJobWhere(c);
    assert.deepEqual(w.status, { in: ["SUCCEEDED", "CANCELLED", "DEAD"] });
  });
});

describe("retentionPolicySchema", () => {
  it("accepts the defaults", () => {
    assert.deepEqual(retentionPolicySchema.parse(DEFAULT_RETENTION), DEFAULT_RETENTION);
  });

  it("rejects an audit window shorter than 90 days (a policy change must not erase recent evidence)", () => {
    assert.equal(retentionPolicySchema.safeParse({ ...DEFAULT_RETENTION, auditLogDays: 30 }).success, false);
  });

  it("rejects zero, negative, fractional and absurd day counts", () => {
    for (const rawEmailDays of [0, -1, 1.5, 5000]) {
      assert.equal(retentionPolicySchema.safeParse({ ...DEFAULT_RETENTION, rawEmailDays }).success, false, String(rawEmailDays));
    }
  });

  it("accepts null (keep indefinitely) for content classes", () => {
    assert.equal(retentionPolicySchema.safeParse({ ...DEFAULT_RETENTION, rawEmailDays: null, extractionOutputDays: null }).success, true);
  });

  it("rejects unknown deleted-source behaviors and missing fields", () => {
    assert.equal(retentionPolicySchema.safeParse({ ...DEFAULT_RETENTION, onSourceDeleted: "SHRED" }).success, false);
    const { auditLogDays: _omit, ...partial } = DEFAULT_RETENTION;
    void _omit;
    assert.equal(retentionPolicySchema.safeParse(partial).success, false);
  });
});

describe("derivedVerdict (DELETE_DERIVED)", () => {
  const base: DerivedFacts = {
    type: "TASK",
    exists: true,
    createdFromItem: true,
    otherSources: false,
    humanTouched: false,
    confirmedInReview: false,
    statusChanged: false,
  };

  it("deletes an untouched record the Brain created only from this source", () => {
    assert.equal(derivedVerdict(base).action, "delete");
    for (const type of DELETABLE_TYPES) assert.equal(derivedVerdict({ ...base, type }).action, "delete", type);
  });

  it("never deletes shared entities", () => {
    for (const type of ["PERSON", "COMPANY", "MEETING", "GOAL", "MILESTONE", "DEAL", "DOCUMENT", "PROJECT"] as const) {
      assert.equal(derivedVerdict({ ...base, type }).action, "keep", type);
    }
  });

  it("keeps records only updated or corroborated by this source", () => {
    assert.deepEqual(derivedVerdict({ ...base, createdFromItem: false }).action, "keep");
  });

  it("keeps records also supported by another source", () => {
    assert.equal(derivedVerdict({ ...base, otherSources: true }).reason, "Also supported by other sources");
  });

  it("keeps anything a person confirmed, edited or moved on", () => {
    assert.equal(derivedVerdict({ ...base, confirmedInReview: true }).action, "keep");
    assert.equal(derivedVerdict({ ...base, humanTouched: true }).action, "keep");
    assert.equal(derivedVerdict({ ...base, statusChanged: true }).action, "keep");
  });

  it("reports records that no longer exist as already removed", () => {
    assert.equal(derivedVerdict({ ...base, exists: false }).reason, "Already removed");
  });
});

describe("counts", () => {
  it("has a zeroed counter for every rule plus derived totals", () => {
    const counts = emptyCounts();
    for (const key of Object.keys(RETENTION_RULES)) assert.equal(counts[key as keyof typeof counts], 0, key);
    assert.equal(counts.derivedRecordsDeleted, 0);
    assert.equal(counts.referencesRedacted, 0);
  });
});
