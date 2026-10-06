/**
 * Retention: apply the policy in AppSetting "retentionPolicy" (see
 * retention-policy.ts) and expire operational rows.
 *
 *   • content purges — raw email bodies, attachment and document blobs,
 *     superseded document text, AI extraction outputs;
 *   • upstream deletions — KEEP_HISTORY / REDACT_CONTENT / DELETE_DERIVED;
 *   • housekeeping — old audit entries, expired sessions, stale rate-limit
 *     buckets, finished jobs.
 *
 * Provenance snapshots (SourceReference) and metadata survive content purges,
 * so company history is never silently destroyed. DELETE_DERIVED removes only
 * records the Brain created from this one source that no human has confirmed
 * or touched; everything else is kept with its excerpt redacted.
 *
 * Preview and sweep share the same where-builders, so "Preview" shows exactly
 * what "Run retention sweep now" will purge.
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import type { EntityType, SourceItemKind, SourceProvider } from "@/generated/prisma/enums";
import { db as defaultDb, type Db, type Tx } from "@/lib/db";
import { DAY_MS } from "@/lib/dates";
import { audit } from "@/server/security/audit";
import { type DeletedSourceBehavior, getRetentionPolicy, type RetentionPolicy } from "./retention-policy";
import type { PipelineContext, StageData } from "./types";

type Client = Db | Tx;

// ─── Policy validation ───────────────────────────────────────────────────────

const days = z.number().int("Whole days only").min(1, "At least 1 day").max(3650, "At most 3650 days (10 years)");

/** Audit history must cover at least a quarter, so a retention change cannot erase recent evidence. */
export const MIN_AUDIT_LOG_DAYS = 90;

export const retentionPolicySchema = z.object({
  rawEmailDays: days.nullable(),
  storeAttachments: z.boolean(),
  attachmentDays: days.nullable(),
  rawDocumentDays: days.nullable(),
  documentTextDays: days.nullable(),
  extractionOutputDays: days.nullable(),
  onSourceDeleted: z.enum(["KEEP_HISTORY", "REDACT_CONTENT", "DELETE_DERIVED"]),
  auditLogDays: z.number().int("Whole days only").min(MIN_AUDIT_LOG_DAYS, `At least ${MIN_AUDIT_LOG_DAYS} days`).max(3650, "At most 3650 days (10 years)"),
}) satisfies z.ZodType<RetentionPolicy>;

// ─── Cutoffs ─────────────────────────────────────────────────────────────────

export const FINISHED_JOB_DAYS = 30;
/** Items still moving through the pipeline are not purged, unless they were ingested this long ago (stuck). */
const IN_FLIGHT_GRACE_DAYS = 30;
/** Revoked sessions are kept a day for incident review, then removed. */
const REVOKED_SESSION_GRACE_MS = DAY_MS;
/** Absolute session lifetime (session.ts) plus a day of slack. */
const SESSION_MAX_AGE_MS = 8 * DAY_MS;
/** Upstream deletions handled per sweep (each is a small transaction). */
const DELETION_BATCH = 200;

export interface RetentionCutoffs {
  now: Date;
  rawEmail: Date | null;
  /** `now` when attachments must not be stored at all. */
  attachments: Date | null;
  rawDocument: Date | null;
  documentText: Date | null;
  extraction: Date | null;
  auditLog: Date;
  finishedJobs: Date;
  inFlightGrace: Date;
}

const before = (now: Date, d: number | null) => (d == null ? null : new Date(now.getTime() - d * DAY_MS));

/** Instants before which each data class is purged (null = keep indefinitely). Pure. */
export function retentionCutoffs(policy: RetentionPolicy, now: Date): RetentionCutoffs {
  return {
    now,
    rawEmail: before(now, policy.rawEmailDays),
    attachments: policy.storeAttachments ? before(now, policy.attachmentDays) : now,
    rawDocument: before(now, policy.rawDocumentDays),
    documentText: before(now, policy.documentTextDays),
    extraction: before(now, policy.extractionOutputDays),
    auditLog: before(now, policy.auditLogDays)!,
    finishedJobs: before(now, FINISHED_JOB_DAYS)!,
    inFlightGrace: before(now, IN_FLIGHT_GRACE_DAYS)!,
  };
}

// ─── Rules (shared by preview and sweep) ─────────────────────────────────────

export const RETENTION_RULES = {
  emailContent: { label: "Raw email bodies", description: "Text, snippet and encrypted raw payload of email messages past the email retention window." },
  attachmentBlobs: { label: "Email attachments", description: "Encrypted attachment copies past the attachment window (or all of them when attachments are not stored)." },
  documentBlobs: { label: "Raw document copies", description: "Encrypted original files of document versions past the document window." },
  documentText: { label: "Superseded document text", description: "Extracted text of older document versions, counted from when they were superseded." },
  extractionOutputs: { label: "AI extraction outputs", description: "Validated extraction JSON stored on source items." },
  deletedUpstream: { label: "Deleted at source", description: "Items deleted in their source system, handled per the deleted-source behavior." },
  auditLogs: { label: "Audit log entries", description: "Entries older than the audit retention window." },
  sessions: { label: "Expired sessions", description: "Sign-in sessions that expired or were revoked." },
  rateLimitBuckets: { label: "Rate-limit counters", description: "Expired rate-limit windows." },
  finishedJobs: { label: "Finished jobs", description: `Succeeded, cancelled and failed ingestion jobs completed more than ${FINISHED_JOB_DAYS} days ago.` },
} as const;

export type RetentionRuleKey = keyof typeof RETENTION_RULES;
export type RetentionCounts = Record<RetentionRuleKey | "derivedRecordsDeleted" | "referencesRedacted", number>;

export function emptyCounts(): RetentionCounts {
  return {
    emailContent: 0,
    attachmentBlobs: 0,
    documentBlobs: 0,
    documentText: 0,
    extractionOutputs: 0,
    deletedUpstream: 0,
    auditLogs: 0,
    sessions: 0,
    rateLimitBuckets: 0,
    finishedJobs: 0,
    derivedRecordsDeleted: 0,
    referencesRedacted: 0,
  };
}

const IN_FLIGHT = ["PENDING", "PROCESSING"] as const;

function settled(c: RetentionCutoffs): Prisma.SourceItemWhereInput {
  return { OR: [{ status: { notIn: [...IN_FLIGHT] } }, { ingestedAt: { lt: c.inFlightGrace } }] };
}

export function emailContentWhere(c: RetentionCutoffs): Prisma.SourceItemWhereInput | null {
  if (!c.rawEmail) return null;
  return { AND: [{ kind: "EMAIL_MESSAGE", occurredAt: { lt: c.rawEmail }, contentPurgedAt: null }, settled(c)] };
}

/** Blobs referenced only by attachments, all of them past the attachment window. Shared blobs wait for every reference. */
export function attachmentBlobWhere(c: RetentionCutoffs): Prisma.StoredBlobWhereInput | null {
  if (!c.attachments) return null;
  return { data: { not: null }, attachments: { some: {}, every: { message: { sentAt: { lt: c.attachments } } } }, versions: { none: {} } };
}

/** Blobs referenced by document versions, all past the document window (and any attachment references past theirs). */
export function documentBlobWhere(c: RetentionCutoffs): Prisma.StoredBlobWhereInput | null {
  if (!c.rawDocument) return null;
  return {
    data: { not: null },
    versions: { some: {}, every: { createdAt: { lt: c.rawDocument } } },
    attachments: c.attachments ? { every: { message: { sentAt: { lt: c.attachments } } } } : { none: {} },
  };
}

/** Text of versions that were superseded before the cutoff (the current version always keeps its text). */
export function documentTextWhere(c: RetentionCutoffs): Prisma.DocumentVersionWhereInput | null {
  if (!c.documentText) return null;
  return { text: { not: null }, nextVersion: { is: { createdAt: { lt: c.documentText } } } };
}

export function extractionWhere(c: RetentionCutoffs): Prisma.SourceItemWhereInput | null {
  if (!c.extraction) return null;
  return { AND: [{ extraction: { not: Prisma.DbNull }, extractedAt: { lt: c.extraction } }, settled(c)] };
}

/** Upstream deletions not yet handled (an item purged by age before it was deleted is handled again). */
export function deletedUpstreamWhere(client: Client): Prisma.SourceItemWhereInput {
  return {
    deletedAtSource: { not: null },
    OR: [{ contentPurgedAt: null }, { contentPurgedAt: { lt: client.sourceItem.fields.deletedAtSource } }],
  };
}

export function sessionWhere(c: RetentionCutoffs): Prisma.SessionWhereInput {
  return {
    OR: [
      { expiresAt: { lt: c.now } },
      { revokedAt: { lt: new Date(c.now.getTime() - REVOKED_SESSION_GRACE_MS) } },
      { createdAt: { lt: new Date(c.now.getTime() - SESSION_MAX_AGE_MS) } },
    ],
  };
}

export function finishedJobWhere(c: RetentionCutoffs): Prisma.IngestionJobWhereInput {
  return {
    status: { in: ["SUCCEEDED", "CANCELLED", "DEAD"] },
    OR: [{ completedAt: { lt: c.finishedJobs } }, { completedAt: null, updatedAt: { lt: c.finishedJobs } }],
  };
}

// ─── Preview ─────────────────────────────────────────────────────────────────

export interface RetentionPreviewRow {
  key: RetentionRuleKey;
  label: string;
  description: string;
  /** Records the rule would purge now (null = rule disabled by the policy). */
  count: number | null;
}

/** How many records each rule would purge right now. Read-only. */
export async function previewRetention(opts: { policy?: RetentionPolicy; now?: Date; client?: Client } = {}): Promise<RetentionPreviewRow[]> {
  const client = opts.client ?? defaultDb;
  const policy = opts.policy ?? (await getRetentionPolicy(client));
  const c = retentionCutoffs(policy, opts.now ?? new Date());
  const count = <W>(where: W | null, fn: (w: W) => Promise<number>) => (where ? fn(where) : Promise.resolve(null));

  const [emailContent, attachmentBlobs, documentBlobs, documentText, extractionOutputs, deletedUpstream, auditLogs, sessions, rateLimitBuckets, finishedJobs] =
    await Promise.all([
      count(emailContentWhere(c), (where) => client.sourceItem.count({ where })),
      count(attachmentBlobWhere(c), (where) => client.storedBlob.count({ where })),
      count(documentBlobWhere(c), (where) => client.storedBlob.count({ where })),
      count(documentTextWhere(c), (where) => client.documentVersion.count({ where })),
      count(extractionWhere(c), (where) => client.sourceItem.count({ where })),
      policy.onSourceDeleted === "KEEP_HISTORY" ? Promise.resolve(null) : client.sourceItem.count({ where: deletedUpstreamWhere(client) }),
      client.auditLog.count({ where: { at: { lt: c.auditLog } } }),
      client.session.count({ where: sessionWhere(c) }),
      client.rateLimitBucket.count({ where: { expiresAt: { lt: c.now } } }),
      client.ingestionJob.count({ where: finishedJobWhere(c) }),
    ]);
  const counts: Record<RetentionRuleKey, number | null> = {
    emailContent,
    attachmentBlobs,
    documentBlobs,
    documentText,
    extractionOutputs,
    deletedUpstream,
    auditLogs,
    sessions,
    rateLimitBuckets,
    finishedJobs,
  };
  return (Object.keys(RETENTION_RULES) as RetentionRuleKey[]).map((key) => ({ key, ...RETENTION_RULES[key], count: counts[key] }));
}

// ─── Sweep ───────────────────────────────────────────────────────────────────

export interface RetentionActor {
  userId: string;
  email: string;
}

/**
 * Purge per policy. Called by the RETENTION_SWEEP job (nightly via the
 * scheduler) and by "Run retention sweep now". Returns per-class counts.
 */
export async function runRetentionSweep(ctx: PipelineContext, opts: { actor?: RetentionActor | null; policy?: RetentionPolicy } = {}): Promise<Record<string, number>> {
  const client = ctx.db;
  const now = ctx.now;
  const policy = opts.policy ?? (await getRetentionPolicy(client));
  const c = retentionCutoffs(policy, now);
  const counts = emptyCounts();

  const emailWhere = emailContentWhere(c);
  if (emailWhere) {
    counts.emailContent = (await client.sourceItem.updateMany({ where: emailWhere, data: { rawPayload: null, text: null, snippet: null, contentPurgedAt: now } })).count;
  }
  const attWhere = attachmentBlobWhere(c);
  if (attWhere) counts.attachmentBlobs = (await client.storedBlob.updateMany({ where: attWhere, data: { data: null, purgedAt: now } })).count;
  const docBlobWhere = documentBlobWhere(c);
  if (docBlobWhere) counts.documentBlobs = (await client.storedBlob.updateMany({ where: docBlobWhere, data: { data: null, purgedAt: now } })).count;
  const textWhere = documentTextWhere(c);
  if (textWhere) counts.documentText = (await client.documentVersion.updateMany({ where: textWhere, data: { text: null } })).count;
  const exWhere = extractionWhere(c);
  if (exWhere) counts.extractionOutputs = (await client.sourceItem.updateMany({ where: exWhere, data: { extraction: Prisma.DbNull } })).count;

  if (policy.onSourceDeleted !== "KEEP_HISTORY") {
    const mode = policy.onSourceDeleted;
    const items = await client.sourceItem.findMany({ where: deletedUpstreamWhere(client), select: { id: true }, orderBy: { deletedAtSource: "asc" }, take: DELETION_BATCH });
    for (const { id } of items) {
      try {
        const res = await withTransaction(client, (tx) => applySourceDeletion(tx, id, mode, now));
        counts.deletedUpstream++;
        counts.derivedRecordsDeleted += res.derivedDeleted;
        counts.referencesRedacted += res.referencesRedacted;
      } catch (error) {
        // One bad item must not stop the sweep; it is retried on the next one.
        ctx.log("RETENTION_SWEEP", `upstream deletion of ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  counts.auditLogs = (await client.auditLog.deleteMany({ where: { at: { lt: c.auditLog } } })).count;
  counts.sessions = (await client.session.deleteMany({ where: sessionWhere(c) })).count;
  counts.rateLimitBuckets = (await client.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: now } } })).count;
  counts.finishedJobs = (await client.ingestionJob.deleteMany({ where: finishedJobWhere(c) })).count;

  await audit({
    action: "retention.purge",
    viewer: opts.actor ?? null,
    actorLabel: "CytoHub Brain",
    targetType: "AppSetting",
    targetId: "retentionPolicy",
    metadata: { trigger: opts.actor ? "manual" : ctx.trigger, counts: { ...counts }, policy: { ...policy } },
  });
  return { ...counts };
}

/** Run in a transaction, or inline when already inside one (`db` is a Proxy, so probe the method instead of using `in`). */
async function withTransaction<T>(client: Client, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const full = client as Db;
  return typeof full.$transaction === "function" ? full.$transaction(fn, { timeout: 30_000 }) : fn(client as Tx);
}

// ─── Derived data of one source item ─────────────────────────────────────────

/** Record types DELETE_DERIVED may remove. People, companies, meetings, goals… are shared entities and always kept. */
export const DELETABLE_TYPES = ["TASK", "COMMITMENT", "RISK", "OPPORTUNITY", "DECISION", "INSIGHT", "INBOX_ITEM"] as const satisfies readonly EntityType[];
type DeletableType = (typeof DELETABLE_TYPES)[number];

const isDeletable = (t: EntityType): t is DeletableType => (DELETABLE_TYPES as readonly EntityType[]).includes(t);

/** Activity actors that are the system itself; any other actor is a human touch. */
const SYSTEM_ACTORS = ["CytoHub Brain"];

export interface DerivedFacts {
  type: EntityType;
  /** The record still exists. */
  exists: boolean;
  /** This item is a CREATED_FROM source of the record (the Brain created it from here). */
  createdFromItem: boolean;
  /** Provenance from any other source item (or a deleted one) exists. */
  otherSources: boolean;
  /** A person acted on it (Activity by a non-system actor, Top 5, delegation…). */
  humanTouched: boolean;
  /** It was approved or merged in the Review Queue. */
  confirmedInReview: boolean;
  /** Its status shows someone moved it on (done, fulfilled, acknowledged, resolved…). */
  statusChanged: boolean;
}

export type DerivedVerdict = { action: "delete" | "keep"; reason: string };

/** Whether DELETE_DERIVED removes a record derived from a deleted source. Pure. */
export function derivedVerdict(f: DerivedFacts): DerivedVerdict {
  if (!f.exists) return { action: "keep", reason: "Already removed" };
  if (!isDeletable(f.type)) return { action: "keep", reason: "Shared record — never deleted automatically" };
  if (!f.createdFromItem) return { action: "keep", reason: "Not created from this source (only updated or corroborated)" };
  if (f.otherSources) return { action: "keep", reason: "Also supported by other sources" };
  if (f.confirmedInReview) return { action: "keep", reason: "Confirmed in the Review Queue" };
  if (f.humanTouched) return { action: "keep", reason: "Edited or acted on by a person" };
  if (f.statusChanged) return { action: "keep", reason: "Status changed by a person" };
  return { action: "delete", reason: "Unconfirmed, created only from this source" };
}

export interface DerivedRecord extends DerivedVerdict {
  type: EntityType;
  id: string;
  /** Record title (callers mask it for viewers who cannot read the source). */
  label: string | null;
  via: "reference" | "link";
  referenceIds: string[];
}

export interface SourceDeletionPlan {
  item: {
    id: string;
    kind: SourceItemKind;
    provider: SourceProvider;
    connectionLabel: string;
    title: string;
    occurredAt: Date;
    contentPurgedAt: Date | null;
    deletedAtSource: Date | null;
  };
  records: DerivedRecord[];
  references: number;
  reviewItems: { pending: { id: string; title: string }[]; resolved: number };
  mentions: number;
  relationships: { total: number; deletable: number };
  content: { text: boolean; raw: boolean; extraction: boolean; attachments: number; versions: number };
}

const ACTIVITY_FK: Partial<Record<EntityType, keyof Prisma.ActivityWhereInput>> = {
  TASK: "taskId",
  COMMITMENT: "commitmentId",
  RISK: "riskId",
  OPPORTUNITY: "opportunityId",
  DECISION: "decisionId",
};

interface TargetState {
  label: string;
  statusChanged: boolean;
  touched: boolean;
}

/** Current title and "moved on" state of the targets, per type. */
async function loadTargets(client: Client, type: EntityType, ids: string[]): Promise<Map<string, TargetState>> {
  const map = new Map<string, TargetState>();
  if (!ids.length) return map;
  const where = { id: { in: ids } };
  switch (type) {
    case "TASK":
      for (const t of await client.task.findMany({
        where,
        select: { id: true, title: true, status: true, delegation: { select: { id: true } }, _count: { select: { dailyPriorities: true, notes: true, timeEntries: true } } },
      }))
        map.set(t.id, {
          label: t.title,
          statusChanged: t.status === "DONE" || t.status === "CANCELLED",
          // Delegated, planned into a Top 5, annotated or timed: a person worked with it.
          touched: Boolean(t.delegation) || t._count.dailyPriorities + t._count.notes + t._count.timeEntries > 0,
        });
      break;
    case "COMMITMENT":
      for (const r of await client.commitment.findMany({ where, select: { id: true, title: true, status: true } })) map.set(r.id, { label: r.title, statusChanged: r.status !== "OPEN", touched: false });
      break;
    case "RISK":
      for (const r of await client.risk.findMany({ where, select: { id: true, title: true, status: true } })) map.set(r.id, { label: r.title, statusChanged: r.status !== "OPEN", touched: false });
      break;
    case "OPPORTUNITY":
      for (const r of await client.opportunity.findMany({ where, select: { id: true, title: true, status: true } })) map.set(r.id, { label: r.title, statusChanged: r.status !== "OPEN", touched: false });
      break;
    case "DECISION":
      for (const r of await client.decision.findMany({ where, select: { id: true, title: true, status: true, _count: { select: { notes: true } } } }))
        map.set(r.id, { label: r.title, statusChanged: r.status !== "NEEDED", touched: r._count.notes > 0 });
      break;
    case "INSIGHT":
      for (const r of await client.brainInsight.findMany({ where, select: { id: true, title: true, status: true } })) map.set(r.id, { label: r.title, statusChanged: r.status !== "NEW", touched: false });
      break;
    case "INBOX_ITEM":
      for (const r of await client.inboxItem.findMany({ where, select: { id: true, title: true, status: true } })) map.set(r.id, { label: r.title, statusChanged: r.status !== "OPEN", touched: false });
      break;
    case "MEETING":
      for (const r of await client.meeting.findMany({ where, select: { id: true, title: true } })) map.set(r.id, { label: r.title, statusChanged: false, touched: false });
      break;
    case "PERSON":
      for (const r of await client.person.findMany({ where, select: { id: true, name: true } })) map.set(r.id, { label: r.name, statusChanged: false, touched: false });
      break;
    case "COMPANY":
      for (const r of await client.company.findMany({ where, select: { id: true, name: true } })) map.set(r.id, { label: r.name, statusChanged: false, touched: false });
      break;
    case "PROJECT":
      for (const r of await client.project.findMany({ where, select: { id: true, name: true } })) map.set(r.id, { label: r.name, statusChanged: false, touched: false });
      break;
    case "GOAL":
      for (const r of await client.goal.findMany({ where, select: { id: true, title: true } })) map.set(r.id, { label: r.title, statusChanged: false, touched: false });
      break;
    case "MILESTONE":
      for (const r of await client.milestone.findMany({ where, select: { id: true, title: true } })) map.set(r.id, { label: r.title, statusChanged: false, touched: false });
      break;
    case "DEAL":
      for (const r of await client.deal.findMany({ where, select: { id: true, name: true } })) map.set(r.id, { label: r.name, statusChanged: false, touched: false });
      break;
    case "DOCUMENT":
      for (const r of await client.document.findMany({ where, select: { id: true, title: true } })) map.set(r.id, { label: r.title, statusChanged: false, touched: false });
      break;
    default:
      // Other target types are listed by id only.
      for (const id of ids) map.set(id, { label: "", statusChanged: false, touched: false });
  }
  return map;
}

/** Everything derived from one source item, and what DELETE_DERIVED would do with each record. Read-only. */
export async function planSourceDeletion(client: Client, sourceItemId: string): Promise<SourceDeletionPlan | null> {
  const item = await client.sourceItem.findUnique({
    where: { id: sourceItemId },
    select: {
      id: true,
      kind: true,
      title: true,
      occurredAt: true,
      contentPurgedAt: true,
      deletedAtSource: true,
      text: true,
      rawPayload: true,
      extractedAt: true,
      connection: { select: { provider: true, label: true } },
      emailMessage: { select: { _count: { select: { attachments: true } } } },
      document: { select: { _count: { select: { versions: true } } } },
      extraction: true,
    },
  });
  if (!item) return null;

  // Sequential on purpose: this also runs inside an interactive transaction (one connection).
  const refs = await client.sourceReference.findMany({ where: { sourceItemId }, select: { id: true, targetType: true, targetId: true, role: true } });
  const directInsights = await client.brainInsight.findMany({ where: { sourceItemId }, select: { id: true } });
  const directInbox = await client.inboxItem.findMany({ where: { sourceItemId }, select: { id: true } });
  const reviewItems = await client.reviewQueueItem.findMany({ where: { sourceItemId }, select: { id: true, title: true, status: true } });
  const mentions = await client.entityMention.count({ where: { sourceItemId } });
  const relTotal = await client.relationship.count({ where: { sourceItemId } });
  const relDeletable = await client.relationship.count({ where: { sourceItemId, evidenceCount: { lte: 1 } } });

  // Group targets: provenance references plus direct sourceItem links on insights and inbox items.
  const targets = new Map<string, { type: EntityType; id: string; via: "reference" | "link"; createdFromItem: boolean; referenceIds: string[] }>();
  for (const r of refs) {
    const key = `${r.targetType}:${r.targetId}`;
    const t = targets.get(key) ?? { type: r.targetType, id: r.targetId, via: "reference" as const, createdFromItem: false, referenceIds: [] };
    t.referenceIds.push(r.id);
    if (r.role === "CREATED_FROM") t.createdFromItem = true;
    targets.set(key, t);
  }
  for (const [type, rows] of [["INSIGHT", directInsights], ["INBOX_ITEM", directInbox]] as const) {
    for (const r of rows) {
      const key = `${type}:${r.id}`;
      // A direct link means the Brain raised it from this item.
      if (!targets.has(key)) targets.set(key, { type, id: r.id, via: "link", createdFromItem: true, referenceIds: [] });
    }
  }

  const byType = new Map<EntityType, string[]>();
  for (const t of targets.values()) byType.set(t.type, [...(byType.get(t.type) ?? []), t.id]);

  const states = new Map<string, TargetState>();
  const otherSourced = new Set<string>();
  const humanTouched = new Set<string>();
  const confirmed = new Set<string>();
  for (const [type, ids] of byType) {
    const loaded = await loadTargets(client, type, ids);
    const others = await client.sourceReference.findMany({
      where: { targetType: type, targetId: { in: ids }, OR: [{ sourceItemId: null }, { sourceItemId: { not: sourceItemId } }] },
      select: { targetId: true },
    });
    const reviews = await client.reviewQueueItem.findMany({ where: { resultType: type, resultId: { in: ids }, status: { in: ["APPROVED", "MERGED"] } }, select: { resultId: true } });
    for (const [id, s] of loaded) states.set(`${type}:${id}`, s);
    for (const o of others) otherSourced.add(`${type}:${o.targetId}`);
    for (const r of reviews) if (r.resultId) confirmed.add(`${type}:${r.resultId}`);
    const fk = ACTIVITY_FK[type];
    if (fk) {
      const acts = await client.activity.findMany({
        where: { AND: [{ [fk]: { in: ids } } as Prisma.ActivityWhereInput, { actor: { notIn: SYSTEM_ACTORS } }] },
        select: { taskId: true, commitmentId: true, riskId: true, opportunityId: true, decisionId: true },
      });
      for (const a of acts) {
        const id = a[fk as "taskId"];
        if (id) humanTouched.add(`${type}:${id}`);
      }
    }
  }

  const records: DerivedRecord[] = [...targets.entries()].map(([key, t]) => {
    const s = states.get(key);
    const verdict = derivedVerdict({
      type: t.type,
      exists: Boolean(s),
      createdFromItem: t.createdFromItem,
      otherSources: otherSourced.has(key),
      humanTouched: humanTouched.has(key) || Boolean(s?.touched),
      confirmedInReview: confirmed.has(key),
      statusChanged: Boolean(s?.statusChanged),
    });
    return { type: t.type, id: t.id, label: s?.label || null, via: t.via, referenceIds: t.referenceIds, ...verdict };
  });
  records.sort((a, b) => (a.action === b.action ? a.type.localeCompare(b.type) : a.action === "delete" ? -1 : 1));

  return {
    item: {
      id: item.id,
      kind: item.kind,
      provider: item.connection.provider,
      connectionLabel: item.connection.label,
      title: item.title,
      occurredAt: item.occurredAt,
      contentPurgedAt: item.contentPurgedAt,
      deletedAtSource: item.deletedAtSource,
    },
    records,
    references: refs.length,
    reviewItems: { pending: reviewItems.filter((r) => r.status === "PENDING").map((r) => ({ id: r.id, title: r.title })), resolved: reviewItems.filter((r) => r.status !== "PENDING").length },
    mentions,
    relationships: { total: relTotal, deletable: relDeletable },
    content: {
      text: item.text != null,
      raw: item.rawPayload != null,
      extraction: item.extraction != null,
      attachments: item.emailMessage?._count.attachments ?? 0,
      versions: item.document?._count.versions ?? 0,
    },
  };
}

export type SourceDeletionMode = Exclude<DeletedSourceBehavior, "KEEP_HISTORY">;

export interface SourceDeletionResult {
  sourceItemId: string;
  mode: SourceDeletionMode;
  contentPurged: boolean;
  blobsPurged: number;
  referencesRedacted: number;
  derivedDeleted: number;
  reviewItemsDeleted: number;
  mentionsDeleted: number;
  relationshipsDeleted: number;
}

/** Stage outputs that only describe the item (no quoted content) survive a purge. */
function sanitizedStageData(stageData: Prisma.JsonValue): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const data = (stageData as StageData | null) ?? null;
  if (!data) return Prisma.DbNull;
  const kept: Partial<StageData> = {};
  if (data.classification) kept.classification = { ...data.classification, reasons: [] };
  if (data.write) kept.write = data.write;
  if (data.document) kept.document = data.document;
  if (data.relationshipsMapped != null) kept.relationshipsMapped = data.relationshipsMapped;
  return kept as unknown as Prisma.InputJsonValue;
}

/** Purge blobs whose every reference belongs to this item. */
async function purgeOwnBlobs(tx: Tx, blobIds: string[], own: { messageId: string | null; documentId: string | null }, now: Date): Promise<number> {
  if (!blobIds.length) return 0;
  const res = await tx.storedBlob.updateMany({
    where: {
      id: { in: blobIds },
      data: { not: null },
      attachments: own.messageId ? { every: { messageId: own.messageId } } : { none: {} },
      versions: own.documentId ? { every: { documentId: own.documentId } } : { none: {} },
    },
    data: { data: null, purgedAt: now },
  });
  return res.count;
}

/**
 * Redact or delete what one source item contributed. Runs inside a transaction
 * (the sweep and deleteSourceItemData wrap it). Idempotent.
 */
export async function applySourceDeletion(tx: Tx, sourceItemId: string, mode: SourceDeletionMode, now: Date): Promise<SourceDeletionResult> {
  const plan = mode === "DELETE_DERIVED" ? await planSourceDeletion(tx, sourceItemId) : null;
  const item = await tx.sourceItem.findUnique({
    where: { id: sourceItemId },
    select: {
      id: true,
      stageData: true,
      emailMessage: { select: { id: true, attachments: { select: { blobId: true } } } },
      document: { select: { id: true, versions: { select: { blobId: true } } } },
      calendarEvent: { select: { id: true } },
    },
  });
  const result: SourceDeletionResult = {
    sourceItemId,
    mode,
    contentPurged: false,
    blobsPurged: 0,
    referencesRedacted: 0,
    derivedDeleted: 0,
    reviewItemsDeleted: 0,
    mentionsDeleted: 0,
    relationshipsDeleted: 0,
  };
  if (!item) return result;

  // 1. Content: text, raw payload, extraction (it quotes evidence verbatim), files, event description.
  await tx.sourceItem.update({
    where: { id: item.id },
    data: { text: null, snippet: null, rawPayload: null, extraction: Prisma.DbNull, stageData: sanitizedStageData(item.stageData), contentPurgedAt: now },
  });
  result.contentPurged = true;
  const blobIds = [
    ...(item.emailMessage?.attachments.map((a) => a.blobId) ?? []),
    ...(item.document?.versions.map((v) => v.blobId) ?? []),
  ].filter((b): b is string => Boolean(b));
  result.blobsPurged = await purgeOwnBlobs(tx, [...new Set(blobIds)], { messageId: item.emailMessage?.id ?? null, documentId: item.document?.id ?? null }, now);
  if (item.document) await tx.documentVersion.updateMany({ where: { documentId: item.document.id }, data: { text: null } });
  if (item.calendarEvent) await tx.calendarEvent.update({ where: { id: item.calendarEvent.id }, data: { description: null } });

  // 2. Provenance snapshots stay, without their quoted excerpt.
  result.referencesRedacted = (await tx.sourceReference.updateMany({ where: { sourceItemId, excerpt: { not: null } }, data: { excerpt: null } })).count;
  await tx.reviewQueueItem.updateMany({ where: { sourceItemId, excerpt: { not: null } }, data: { excerpt: null } });

  if (mode !== "DELETE_DERIVED" || !plan) return result;

  // 3. Unconfirmed intelligence created only from this item.
  const doomed = plan.records.filter((r) => r.action === "delete");
  const idsOf = (t: EntityType) => doomed.filter((r) => r.type === t).map((r) => r.id);
  const taskIds = idsOf("TASK");
  const commitmentIds = idsOf("COMMITMENT");
  const riskIds = idsOf("RISK");
  const opportunityIds = idsOf("OPPORTUNITY");
  const decisionIds = idsOf("DECISION");

  // A CEO commitment is mirrored as a task; remove the mirror too unless a person touched it.
  if (commitmentIds.length) {
    const mirrors = await tx.commitment.findMany({ where: { id: { in: commitmentIds }, taskId: { not: null } }, select: { taskId: true } });
    const mirrorIds = mirrors.map((m) => m.taskId!).filter((id) => !taskIds.includes(id));
    if (mirrorIds.length) {
      const touched = new Set(
        (await tx.activity.findMany({ where: { taskId: { in: mirrorIds }, actor: { notIn: SYSTEM_ACTORS } }, select: { taskId: true } })).map((a) => a.taskId),
      );
      const safe = await tx.task.findMany({
        where: {
          id: { in: mirrorIds.filter((id) => !touched.has(id)) },
          status: { notIn: ["DONE", "CANCELLED"] },
          delegation: { is: null },
          dailyPriorities: { none: {} },
          notes: { none: {} },
          timeEntries: { none: {} },
        },
        select: { id: true },
      });
      taskIds.push(...safe.map((t) => t.id));
    }
  }

  // Insights and inbox items raised from this item or about the records being removed (only untouched ones).
  const linkedTo = { OR: [{ sourceItemId }, { taskId: { in: taskIds } }, { commitmentId: { in: commitmentIds } }, { riskId: { in: riskIds } }, { opportunityId: { in: opportunityIds } }, { decisionId: { in: decisionIds } }] };
  const insightIds = [...new Set([...idsOf("INSIGHT"), ...(await tx.brainInsight.findMany({ where: { AND: [linkedTo, { status: "NEW" }] }, select: { id: true } })).map((i) => i.id)])];
  const inboxIds = [
    ...new Set([
      ...idsOf("INBOX_ITEM"),
      ...(await tx.inboxItem.findMany({ where: { AND: [{ OR: [...linkedTo.OR, { insightId: { in: insightIds } }] }, { status: "OPEN" }] }, select: { id: true } })).map((i) => i.id),
    ]),
  ];

  // Dependents first (inbox → insight → record → mirrored task); sequential inside the transaction.
  const deletions = [
    await tx.inboxItem.deleteMany({ where: { id: { in: inboxIds } } }),
    await tx.brainInsight.deleteMany({ where: { id: { in: insightIds } } }),
    await tx.commitment.deleteMany({ where: { id: { in: commitmentIds } } }),
    await tx.risk.deleteMany({ where: { id: { in: riskIds } } }),
    await tx.opportunity.deleteMany({ where: { id: { in: opportunityIds } } }),
    await tx.decision.deleteMany({ where: { id: { in: decisionIds } } }),
    await tx.task.deleteMany({ where: { id: { in: taskIds } } }),
  ];
  result.derivedDeleted = deletions.reduce((sum, r) => sum + r.count, 0);

  // Provenance rows of removed records go with them (any source).
  const removed: [EntityType, string[]][] = [
    ["TASK", taskIds],
    ["COMMITMENT", commitmentIds],
    ["RISK", riskIds],
    ["OPPORTUNITY", opportunityIds],
    ["DECISION", decisionIds],
    ["INSIGHT", insightIds],
    ["INBOX_ITEM", inboxIds],
  ];
  const refOr = removed.filter(([, ids]) => ids.length).map(([targetType, ids]) => ({ targetType, targetId: { in: ids } }));
  if (refOr.length) await tx.sourceReference.deleteMany({ where: { OR: refOr } });

  result.reviewItemsDeleted = (await tx.reviewQueueItem.deleteMany({ where: { sourceItemId, status: "PENDING" } })).count;
  result.mentionsDeleted = (await tx.entityMention.deleteMany({ where: { sourceItemId } })).count;
  result.relationshipsDeleted = (await tx.relationship.deleteMany({ where: { sourceItemId, evidenceCount: { lte: 1 } } })).count;
  return result;
}

/** The deletion workflow in Settings → Retention: redact or delete one item's data, audited. */
export async function deleteSourceItemData(sourceItemId: string, mode: SourceDeletionMode, actor: RetentionActor, client: Db = defaultDb): Promise<SourceDeletionResult> {
  const exists = await client.sourceItem.findUnique({ where: { id: sourceItemId }, select: { id: true, kind: true, connectionId: true } });
  if (!exists) throw new Error("Source item not found");
  const now = new Date();
  const result = await client.$transaction((tx) => applySourceDeletion(tx, sourceItemId, mode, now), { timeout: 30_000 });
  await audit({
    action: "source.delete",
    viewer: actor,
    targetType: "SourceItem",
    targetId: sourceItemId,
    metadata: { ...result, kind: exists.kind, connectionId: exists.connectionId },
  });
  return result;
}
