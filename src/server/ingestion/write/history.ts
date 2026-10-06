/**
 * Append-only history. Every Brain change writes an Activity row with the
 * actor, a from/to in metadata and the source item it came from; existing
 * Activity rows are never updated or deleted by ingestion.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { ActivityType } from "@/generated/prisma/enums";
import type { WriteEnv } from "./env";

export interface ActivityLinks {
  taskId?: string | null;
  goalId?: string | null;
  milestoneId?: string | null;
  decisionId?: string | null;
  meetingId?: string | null;
  companyId?: string | null;
  personId?: string | null;
  commitmentId?: string | null;
  riskId?: string | null;
  opportunityId?: string | null;
  documentId?: string | null;
}

export async function recordActivity(
  env: WriteEnv,
  type: ActivityType,
  summary: string,
  links: ActivityLinks = {},
  metadata: Record<string, unknown> = {},
  opts: { actor?: string; at?: Date } = {},
) {
  const meta: Record<string, unknown> = { ...metadata };
  if (env.source) meta.sourceItemId = env.source.id;
  if (env.approvedBy) meta.approvedBy = env.approvedBy.email;
  return env.tx.activity.create({
    data: {
      type,
      summary: summary.slice(0, 500),
      actor: opts.actor ?? env.actor,
      metadata: meta as Prisma.InputJsonValue,
      sourceItemId: env.source?.id ?? null,
      taskId: links.taskId ?? null,
      goalId: links.goalId ?? null,
      milestoneId: links.milestoneId ?? null,
      decisionId: links.decisionId ?? null,
      meetingId: links.meetingId ?? null,
      companyId: links.companyId ?? null,
      personId: links.personId ?? null,
      commitmentId: links.commitmentId ?? null,
      riskId: links.riskId ?? null,
      opportunityId: links.opportunityId ?? null,
      documentId: links.documentId ?? null,
      createdAt: opts.at ?? env.now,
    },
  });
}

/** Whether the CEO has personally touched a task (any CEO activity on it). */
export async function isCeoTouchedTask(env: WriteEnv, taskId: string): Promise<boolean> {
  return (await env.tx.activity.count({ where: { taskId, actor: "CEO" } })) > 0;
}
