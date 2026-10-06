/**
 * Brain insights written by ingestion (risks, opportunities, important
 * changes, follow-ups, delegation hints). Identity is the fingerprint, so
 * re-processing updates the same insight; an insight the CEO dismissed is
 * never resurrected.
 */
import type { InsightType } from "@/generated/prisma/enums";
import type { WriteEnv } from "./env";
import { hasReferenceFrom, reference } from "./provenance";

export interface InsightLinks {
  personId?: string | null;
  companyId?: string | null;
  goalId?: string | null;
  milestoneId?: string | null;
  taskId?: string | null;
  decisionId?: string | null;
  dealId?: string | null;
  commitmentId?: string | null;
  riskId?: string | null;
  opportunityId?: string | null;
  documentId?: string | null;
  meetingId?: string | null;
}

export interface InsightInput {
  type: InsightType;
  fingerprint: string;
  title: string;
  summary?: string | null;
  recommendation?: string | null;
  importance: number;
  requiresCeo?: boolean;
  /** CHANGE insights: meeting_rescheduled, customer_deliverable_requested… */
  changeKind?: string | null;
  links?: InsightLinks;
  occurredAt?: Date;
  excerpt?: string | null;
  confidence?: number | null;
  /** Another source reporting the same thing: keep the insight as first written, add a CORROBORATED_BY reference. */
  corroborateOnly?: boolean;
}

export interface InsightResult {
  id: string;
  created: boolean;
  importance: number;
  requiresCeo: boolean;
  type: InsightType;
  changeKind: string | null;
  title: string;
}

const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(n)));

export async function upsertInsight(env: WriteEnv, input: InsightInput): Promise<InsightResult | null> {
  const links = input.links ?? {};
  const data = {
    type: input.type,
    title: input.title.slice(0, 300),
    summary: input.summary?.slice(0, 2000) ?? null,
    recommendation: input.recommendation?.slice(0, 1000) ?? null,
    importance: clamp(input.importance),
    requiresCeo: input.requiresCeo ?? false,
    changeKind: input.changeKind ?? null,
    personId: links.personId ?? null,
    companyId: links.companyId ?? null,
    goalId: links.goalId ?? null,
    milestoneId: links.milestoneId ?? null,
    taskId: links.taskId ?? null,
    decisionId: links.decisionId ?? null,
    dealId: links.dealId ?? null,
    commitmentId: links.commitmentId ?? null,
    riskId: links.riskId ?? null,
    opportunityId: links.opportunityId ?? null,
    documentId: links.documentId ?? null,
    meetingId: links.meetingId ?? null,
  };
  const existing = await env.tx.brainInsight.findUnique({ where: { fingerprint: input.fingerprint }, select: { id: true, status: true, importance: true, requiresCeo: true, title: true } });
  let id: string;
  let created = false;
  if (existing && input.corroborateOnly) {
    if (existing.status === "DISMISSED") return null;
    if (env.source && !(await hasReferenceFrom(env.tx, "INSIGHT", existing.id, env.source.id))) {
      await reference(env, "INSIGHT", existing.id, "CORROBORATED_BY", { excerpt: input.excerpt, confidence: input.confidence });
    }
    if (!env.summary.insightIds.includes(existing.id)) env.summary.insightIds.push(existing.id);
    return { id: existing.id, created: false, importance: existing.importance, requiresCeo: existing.requiresCeo, type: input.type, changeKind: data.changeKind, title: existing.title };
  }
  if (existing) {
    if (existing.status === "DISMISSED") return null;
    // Keep links already established when the new evidence lacks them.
    const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null));
    await env.tx.brainInsight.update({ where: { id: existing.id }, data: { ...patch, updatedAt: env.now } });
    id = existing.id;
  } else {
    const row = await env.tx.brainInsight.create({
      data: {
        ...data,
        fingerprint: input.fingerprint,
        sourceItemId: env.source?.id ?? null,
        occurredAt: input.occurredAt ?? env.source?.occurredAt ?? env.now,
        createdAt: env.now,
        updatedAt: env.now,
      },
    });
    id = row.id;
    created = true;
  }
  if (created || !env.source || !(await hasReferenceFrom(env.tx, "INSIGHT", id, env.source.id))) {
    await reference(env, "INSIGHT", id, created ? "CREATED_FROM" : "UPDATED_FROM", { excerpt: input.excerpt, confidence: input.confidence });
  }
  if (!env.summary.insightIds.includes(id)) env.summary.insightIds.push(id);
  return { id, created, importance: data.importance, requiresCeo: data.requiresCeo, type: input.type, changeKind: data.changeKind, title: data.title };
}
