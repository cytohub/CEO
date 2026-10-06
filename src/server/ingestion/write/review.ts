/**
 * Brain Review Queue: uncertain or protected conclusions wait here for a
 * human. createReviewItem() files them (deduplicated by fingerprint, and never
 * re-filed once a reviewer rejected or ignored them); resolveReviewItem()
 * applies the reviewer's decision through the same functions the automatic
 * writer uses, with provenance, history and an audit entry.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EntityType, ReviewKind, ReviewStatus, Sensitivity } from "@/generated/prisma/enums";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/server/security/audit";
import { loadCeoContext } from "@/server/context";
import { findDuplicateTask } from "./dedupe";
import { BRAIN_ACTOR, emptyCounters, emptySummary, snapshotOf, type WriteEnv } from "./env";
import { recordActivity, type ActivityLinks } from "./history";
import { mergeCompanies, mergePeople } from "./merge";
import { addSourceReference } from "./provenance";
import {
  adoptIntoCompany,
  addAlias,
  applyDeadline,
  applyDecision,
  applyFieldChange,
  corroborate,
  createCommitment,
  createCompanyFromProposal,
  createInvestorFromProposal,
  createMeetingFromProposal,
  createOpportunity,
  createPersonFromProposal,
  createRisk,
  createTask,
} from "./records";
import { applyEdit, parseProposal, type ProposalFor } from "./review-schemas";

export type ReviewDecision =
  | { action: "APPROVE"; note?: string }
  | { action: "EDIT"; edited: Record<string, unknown>; note?: string }
  | { action: "REJECT"; note?: string }
  | { action: "MERGE"; mergeIntoId: string; note?: string }
  | { action: "IGNORE"; note?: string };

export interface ReviewOutcome {
  status: ReviewStatus;
  resultType?: EntityType;
  resultId?: string;
}

/** A reviewer-facing failure (already resolved, record gone, invalid edit). */
export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

// ─── Filing ──────────────────────────────────────────────────────────────────

export interface CreateReviewInput<K extends ReviewKind = ReviewKind> {
  kind: K;
  title: string;
  /** Why this needs a human (shown to the reviewer). */
  reason: string;
  /** 1–5 */
  impact: number;
  confidenceScore: number;
  proposal: unknown;
  targetType?: EntityType | null;
  targetId?: string | null;
  candidates?: { entityId: string; label: string; score: number }[] | null;
  excerpt?: string | null;
  fingerprint: string;
  sensitivity?: Sensitivity;
  sourceItemId?: string | null;
  now?: Date;
}

function band(score: number) {
  return score >= 0.8 ? "HIGH" : score >= 0.55 ? "MEDIUM" : "LOW";
}

/**
 * File a review item. Returns null when the same proposal (fingerprint) was
 * already resolved — a rejected or ignored conclusion is never asked again.
 * A still-pending item is refreshed with the latest proposal instead of duplicated.
 */
export async function createReviewItem(tx: Tx, input: CreateReviewInput): Promise<{ id: string; created: boolean } | null> {
  const proposal = parseProposal(input.kind, input.proposal) as unknown as Prisma.InputJsonValue;
  const score = Math.max(0, Math.min(1, input.confidenceScore));
  const existing = await tx.reviewQueueItem.findUnique({ where: { fingerprint: input.fingerprint }, select: { id: true, status: true, confidenceScore: true } });
  if (existing) {
    if (existing.status !== "PENDING") return null;
    const best = Math.max(existing.confidenceScore, score);
    await tx.reviewQueueItem.update({
      where: { id: existing.id },
      data: {
        proposal,
        title: input.title.slice(0, 300),
        reason: input.reason.slice(0, 1000),
        impact: Math.max(1, Math.min(5, Math.round(input.impact))),
        confidenceScore: best,
        confidence: band(best),
        ...(input.excerpt ? { excerpt: input.excerpt.slice(0, 600) } : {}),
        ...(input.candidates ? { candidates: input.candidates as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    return { id: existing.id, created: false };
  }
  const row = await tx.reviewQueueItem.create({
    data: {
      kind: input.kind,
      status: "PENDING",
      title: input.title.slice(0, 300),
      reason: input.reason.slice(0, 1000),
      impact: Math.max(1, Math.min(5, Math.round(input.impact))),
      confidence: band(score),
      confidenceScore: score,
      proposal,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      candidates: input.candidates ? (input.candidates as unknown as Prisma.InputJsonValue) : undefined,
      excerpt: input.excerpt?.slice(0, 600) ?? null,
      fingerprint: input.fingerprint,
      sensitivity: input.sensitivity ?? "CONFIDENTIAL",
      sourceItemId: input.sourceItemId ?? null,
      ...(input.now ? { createdAt: input.now, updatedAt: input.now } : {}),
    },
  });
  return { id: row.id, created: true };
}

/** createReviewItem bound to a write environment (summary + counters). */
export async function queueReview(env: WriteEnv, input: Omit<CreateReviewInput, "sourceItemId" | "now"> & { sensitivity?: Sensitivity }): Promise<string | null> {
  const r = await createReviewItem(env.tx, { ...input, sourceItemId: env.source?.id ?? null, now: env.now });
  if (!r) return null;
  if (!env.summary.reviewItemIds.includes(r.id)) env.summary.reviewItemIds.push(r.id);
  if (r.created) env.counters.reviewItems++;
  return r.id;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

const STATUS_FOR: Record<ReviewDecision["action"], ReviewStatus> = {
  APPROVE: "APPROVED",
  EDIT: "APPROVED",
  REJECT: "REJECTED",
  MERGE: "MERGED",
  IGNORE: "IGNORED",
};

type Applied = { type: EntityType; id: string } | null;

type LoadedReview = Prisma.ReviewQueueItemGetPayload<{ include: { sourceItem: { include: { connection: { select: { provider: true } } } } } }>;

async function applyProposal(env: WriteEnv, kind: ReviewKind, proposal: unknown): Promise<Applied> {
  switch (kind) {
    case "TASK": {
      const p = proposal as ProposalFor<"TASK">;
      // The same action may have been captured from another source while this waited.
      const dup = await findDuplicateTask(env.tx, p.title, {
        sourceItemId: null,
        threadId: null,
        meetingId: p.meetingId,
        companyIds: p.companyId ? [p.companyId] : [],
        ownerPersonId: p.ownerPersonId,
        now: env.now,
      });
      if (dup) {
        await corroborate(env, "TASK", dup.record.id, { excerpt: p.evidence, confidence: p.confidence });
        return { type: "TASK", id: dup.record.id };
      }
      return { type: "TASK", id: (await createTask(env, p)).id };
    }
    case "COMMITMENT":
      return { type: "COMMITMENT", id: (await createCommitment(env, proposal as ProposalFor<"COMMITMENT">)).id };
    case "DEADLINE":
      return applyDeadline(env, proposal as ProposalFor<"DEADLINE">);
    case "DECISION":
      return { type: "DECISION", id: (await applyDecision(env, proposal as ProposalFor<"DECISION">)).id };
    case "RISK":
      return { type: "RISK", id: (await createRisk(env, proposal as ProposalFor<"RISK">)).id };
    case "OPPORTUNITY":
      return { type: "OPPORTUNITY", id: (await createOpportunity(env, proposal as ProposalFor<"OPPORTUNITY">)).id };
    case "MEETING":
      return { type: "MEETING", id: (await createMeetingFromProposal(env, proposal as ProposalFor<"MEETING">)).id };
    case "ENTITY_MERGE": {
      const p = proposal as ProposalFor<"ENTITY_MERGE">;
      const r = p.entityType === "COMPANY" ? await mergeCompanies(env, p.keepId, p.mergeId) : await mergePeople(env, p.keepId, p.mergeId);
      return { type: p.entityType, id: r.id };
    }
    case "NEW_PERSON":
      return { type: "PERSON", id: (await createPersonFromProposal(env, proposal as ProposalFor<"NEW_PERSON">)).id };
    case "NEW_COMPANY":
      return { type: "COMPANY", id: (await createCompanyFromProposal(env, proposal as ProposalFor<"NEW_COMPANY">)).id };
    case "NEW_INVESTOR":
      return { type: "COMPANY", id: (await createInvestorFromProposal(env, proposal as ProposalFor<"NEW_INVESTOR">)).id };
    case "FIELD_CHANGE": {
      const r = await applyFieldChange(env, proposal as ProposalFor<"FIELD_CHANGE">);
      return { type: r.type, id: r.id };
    }
    case "DOCUMENT_CHANGE": {
      const p = proposal as ProposalFor<"DOCUMENT_CHANGE">;
      await env.tx.brainInsight.updateMany({ where: { documentId: p.documentId, type: "CHANGE", status: "NEW" }, data: { status: "ACKNOWLEDGED", updatedAt: env.now } });
      return { type: "DOCUMENT", id: p.documentId };
    }
  }
}

const RECORD_KIND_TARGET: Partial<Record<ReviewKind, EntityType>> = {
  TASK: "TASK",
  COMMITMENT: "COMMITMENT",
  DECISION: "DECISION",
  RISK: "RISK",
  OPPORTUNITY: "OPPORTUNITY",
  MEETING: "MEETING",
};

async function recordExists(tx: Tx, type: EntityType, id: string): Promise<boolean> {
  const where = { where: { id } };
  switch (type) {
    case "TASK":
      return (await tx.task.count(where)) > 0;
    case "COMMITMENT":
      return (await tx.commitment.count(where)) > 0;
    case "DECISION":
      return (await tx.decision.count(where)) > 0;
    case "RISK":
      return (await tx.risk.count(where)) > 0;
    case "OPPORTUNITY":
      return (await tx.opportunity.count(where)) > 0;
    case "MEETING":
      return (await tx.meeting.count(where)) > 0;
    case "COMPANY":
      return (await tx.company.count(where)) > 0;
    case "PERSON":
      return (await tx.person.count(where)) > 0;
    default:
      return false;
  }
}

/** MERGE: "this is the same as existing record X". */
async function applyMerge(env: WriteEnv, item: LoadedReview, mergeIntoId: string): Promise<Applied> {
  const kind = item.kind;
  if (kind === "ENTITY_MERGE") {
    const p = parseProposal("ENTITY_MERGE", item.proposal);
    if (mergeIntoId !== p.keepId && mergeIntoId !== p.mergeId) throw new ReviewError("Pick one of the two records to keep.");
    const drop = mergeIntoId === p.keepId ? p.mergeId : p.keepId;
    const r = p.entityType === "COMPANY" ? await mergeCompanies(env, mergeIntoId, drop) : await mergePeople(env, mergeIntoId, drop);
    return { type: p.entityType, id: r.id };
  }
  if (kind === "NEW_COMPANY" || kind === "NEW_INVESTOR") {
    const p = parseProposal(kind, item.proposal);
    return { type: "COMPANY", id: (await adoptIntoCompany(env, mergeIntoId, { name: p.name, domain: p.domain, personIds: p.personIds })).id };
  }
  if (kind === "NEW_PERSON") {
    const p = parseProposal("NEW_PERSON", item.proposal);
    if (!(await recordExists(env.tx, "PERSON", mergeIntoId))) throw new ReviewError("That person no longer exists.");
    if (p.email) await addAlias(env.tx, "PERSON", mergeIntoId, p.email, "EMAIL", "USER", 1, env.now);
    await addAlias(env.tx, "PERSON", mergeIntoId, p.name, "NAME", "USER", 1, env.now);
    return { type: "PERSON", id: mergeIntoId };
  }
  const target: EntityType | undefined =
    RECORD_KIND_TARGET[kind] ?? (kind === "DEADLINE" ? ((await recordExists(env.tx, "TASK", mergeIntoId)) ? "TASK" : "COMMITMENT") : undefined);
  if (!target) throw new ReviewError("Merge is not available for this kind of review item.");
  if (!(await recordExists(env.tx, target, mergeIntoId))) throw new ReviewError("The record to merge into no longer exists.");
  if (env.source) {
    await addSourceReference(env.tx, { targetType: target, targetId: mergeIntoId, item: env.source, role: "CORROBORATED_BY", excerpt: item.excerpt, confidence: item.confidenceScore, engine: env.engine, now: env.now });
  }
  return { type: target, id: mergeIntoId };
}

function linksFor(result: Applied): ActivityLinks {
  if (!result) return {};
  switch (result.type) {
    case "TASK":
      return { taskId: result.id };
    case "COMMITMENT":
      return { commitmentId: result.id };
    case "DECISION":
      return { decisionId: result.id };
    case "RISK":
      return { riskId: result.id };
    case "OPPORTUNITY":
      return { opportunityId: result.id };
    case "MEETING":
      return { meetingId: result.id };
    case "MILESTONE":
      return { milestoneId: result.id };
    case "COMPANY":
      return { companyId: result.id };
    case "PERSON":
      return { personId: result.id };
    case "DOCUMENT":
      return { documentId: result.id };
    default:
      return {};
  }
}

const VERB: Record<ReviewDecision["action"], string> = { APPROVE: "approved", EDIT: "approved with edits", REJECT: "rejected", MERGE: "merged", IGNORE: "ignored" };

/**
 * Apply a reviewer's decision. The PENDING → resolved transition is claimed
 * atomically (concurrent reviewers cannot both apply), and everything —
 * claim, records, provenance, history — commits or rolls back together.
 * Callers must have verified the `review.resolve` capability.
 */
export async function resolveReviewItem(reviewItemId: string, decision: ReviewDecision, actor: { userId: string; email: string }, opts: { now?: Date } = {}): Promise<ReviewOutcome> {
  const now = opts.now ?? new Date();
  const ceo = await loadCeoContext(db, now);
  const [ceoUser, user] = await Promise.all([
    db.user.findUnique({ where: { id: ceo.userId }, select: { email: true } }),
    db.user.findUnique({ where: { id: actor.userId }, select: { name: true, personId: true } }),
  ]);
  // "CEO" as actor marks the work as CEO-touched (dedupe then protects its dates and owner).
  const actorLabel = user?.personId && user.personId === ceo.personId ? "CEO" : (user?.name ?? actor.email);
  const status = STATUS_FOR[decision.action];

  const outcome = await db.$transaction(
    async (tx) => {
      const item = await tx.reviewQueueItem.findUnique({ where: { id: reviewItemId }, include: { sourceItem: { include: { connection: { select: { provider: true } } } } } });
      if (!item) throw new ReviewError("Review item not found.");

      let edited: ProposalFor<ReviewKind> | null = null;
      if (decision.action === "EDIT") {
        try {
          edited = applyEdit(item.kind, item.proposal, decision.edited ?? {});
        } catch (error) {
          const msg = error instanceof Error && "issues" in error ? (error as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(error);
          throw new ReviewError(`Invalid edit — ${msg}`);
        }
      }

      const claimed = await tx.reviewQueueItem.updateMany({
        where: { id: reviewItemId, status: "PENDING" },
        data: {
          status,
          resolvedByUserId: actor.userId,
          resolvedAt: now,
          resolutionNote: decision.note?.slice(0, 1000) ?? null,
          ...(edited ? { edited: edited as unknown as Prisma.InputJsonValue } : {}),
        },
      });
      if (claimed.count === 0) throw new ReviewError("This review item has already been resolved.");

      const env: WriteEnv = {
        tx,
        now,
        today: ceo.today,
        timezone: ceo.timezone,
        ceo: { personId: ceo.personId, userId: ceo.userId, name: ceo.name, email: ceoUser?.email ?? null },
        actor: BRAIN_ACTOR,
        source: item.sourceItem ? snapshotOf(item.sourceItem) : null,
        engine: item.sourceItem?.extractionEngine ?? null,
        relevance: item.sourceItem?.relevance ?? null,
        summary: emptySummary(),
        counters: emptyCounters(),
        approvedBy: actor,
      };

      let result: Applied = null;
      if (decision.action === "APPROVE") result = await applyProposal(env, item.kind, parseProposal(item.kind, item.proposal));
      else if (decision.action === "EDIT") result = await applyProposal(env, item.kind, edited);
      else if (decision.action === "MERGE") {
        if (!decision.mergeIntoId) throw new ReviewError("Choose the record to merge into.");
        result = await applyMerge(env, item, decision.mergeIntoId);
      }

      if (result) await tx.reviewQueueItem.update({ where: { id: reviewItemId }, data: { resultType: result.type, resultId: result.id } });
      await recordActivity(env, "REVIEW_RESOLVED", `Review ${VERB[decision.action]}: ${item.title}`, linksFor(result), {
        reviewItemId,
        kind: item.kind,
        action: decision.action,
        resultType: result?.type ?? null,
        resultId: result?.id ?? null,
      }, { actor: actorLabel });
      return { status, resultType: result?.type, resultId: result?.id, kind: item.kind };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  await audit({
    action: "review.resolve",
    viewer: actor,
    targetType: "ReviewQueueItem",
    targetId: reviewItemId,
    metadata: { kind: outcome.kind, action: decision.action, resultType: outcome.resultType ?? null, resultId: outcome.resultId ?? null },
  });
  return { status: outcome.status, resultType: outcome.resultType, resultId: outcome.resultId };
}
