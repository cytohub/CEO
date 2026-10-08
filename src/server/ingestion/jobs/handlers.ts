import type { IngestionJob } from "@/generated/prisma/client";
import type { JobType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { recommendTopFive, rescoreTasks } from "@/server/brain/priorities";
import { getPriorityWeights } from "@/server/settings";
import { summarizeThread } from "../extract/threads";
import { PROCESSING_STAGES, runStage } from "../pipeline";
import { runRetentionSweep } from "../retention";
import { syncBusinessConnection } from "../business/run";
import { syncConnection } from "../sync";
import type { PipelineContext } from "../types";
import { PermanentJobError } from "./queue";

export type JobHandler = (job: IngestionJob, ctx: PipelineContext) => Promise<Record<string, unknown> | void>;

const payload = <T>(job: IngestionJob) => (job.payload ?? {}) as T;

async function sync(job: IngestionJob, ctx: PipelineContext) {
  const { runId } = payload<{ runId?: string }>(job);
  if (!job.connectionId) throw new PermanentJobError("Sync job without a connection");
  const outcome = await syncConnection(ctx, job.connectionId, runId ?? job.runId ?? "");
  return outcome as unknown as Record<string, unknown>;
}

async function businessSync(job: IngestionJob, ctx: PipelineContext) {
  const { runId } = payload<{ runId?: string }>(job);
  if (!job.connectionId) throw new PermanentJobError("Sync job without a connection");
  const outcome = await syncBusinessConnection(ctx, job.connectionId, runId ?? job.runId ?? "");
  return outcome as unknown as Record<string, unknown>;
}

async function stage(job: IngestionJob, ctx: PipelineContext) {
  if (!job.sourceItemId) throw new PermanentJobError(`${job.type} job without a source item`);
  return (await runStage(job.type, job.sourceItemId, ctx)) as unknown as Record<string, unknown>;
}

export const HANDLERS: Record<JobType, JobHandler> = {
  EMAIL_SYNC: sync,
  CALENDAR_SYNC: sync,
  DOCUMENT_SYNC: sync,
  MEETINGS_SYNC: businessSync,
  BUSINESS_SYNC: businessSync,
  DOCUMENT_PARSE: stage,
  ENTITY_EXTRACTION: stage,
  ENTITY_RESOLUTION: stage,
  RELATIONSHIP_MAPPING: stage,
  INTELLIGENCE_EXTRACTION: stage,
  BRAIN_WRITE: stage,
  THREAD_SUMMARY: async (job, ctx) => {
    const { threadId } = payload<{ threadId?: string }>(job);
    if (!threadId) throw new PermanentJobError("THREAD_SUMMARY without threadId");
    await summarizeThread(ctx, threadId);
    return { threadId };
  },
  PRIORITY_RECALC: async (_job, ctx) => {
    const updated = await rescoreTasks(db, { today: ctx.ceo.today, weights: await getPriorityWeights(db), ceoPersonId: ctx.ceo.personId, now: ctx.now });
    const top = await recommendTopFive(db, { today: ctx.ceo.today, ceoPersonId: ctx.ceo.personId });
    return { rescored: updated, top5: top.length };
  },
  DAILY_BRAIN_REFRESH: async () => {
    // Dynamic import: the refresh itself drains this queue.
    const { runBrainRefresh } = await import("@/server/brain/refresh");
    const outcome = await runBrainRefresh({ trigger: "SCHEDULED" });
    if (outcome.status === "FAILED") throw new Error(outcome.error ?? "Daily Brain Refresh failed");
    return outcome as unknown as Record<string, unknown>;
  },
  RETENTION_SWEEP: async (_job, ctx) => runRetentionSweep(ctx),
};

export const STAGE_TYPES = new Set<JobType>(PROCESSING_STAGES);
