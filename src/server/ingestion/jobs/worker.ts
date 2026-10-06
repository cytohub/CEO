/**
 * Drains the ingestion queue within a time budget. Safe to run from several
 * places at once (cron tick, Run sync now, Daily Brain Refresh, the CLI
 * worker) because claims use FOR UPDATE SKIP LOCKED.
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import type { JobType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { createPipelineContext } from "../context";
import { markStageFailed } from "../pipeline";
import { CursorExpiredError, ProviderAuthError } from "../types";
import { HANDLERS, STAGE_TYPES } from "./handlers";
import { claim, complete, fail, PermanentJobError, recoverStale } from "./queue";

export interface DrainResult {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
  /** Jobs still runnable when the budget ran out. */
  remaining: number;
  durationMs: number;
}

export async function drainQueue(
  opts: {
    budgetMs?: number;
    maxJobs?: number;
    types?: JobType[];
    workerId?: string;
    /** Simulated clock for every job's PipelineContext (seeding / time-travel tests). */
    now?: Date;
    /** Also wait for jobs scheduled within this many ms (debounced summaries, priority recalcs). */
    settleMs?: number;
  } = {},
): Promise<DrainResult> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 55_000;
  const workerId = opts.workerId ?? `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  const result: DrainResult = { processed: 0, succeeded: 0, failed: 0, dead: 0, remaining: 0, durationMs: 0 };
  await recoverStale();

  while (Date.now() - started < budget && (!opts.maxJobs || result.processed < opts.maxJobs)) {
    const job = await claim(workerId, opts.types);
    if (!job) {
      // Debounced follow-up work (thread summaries, priority recalcs) is scheduled a few
      // seconds out; when asked to settle, wait for it instead of leaving it queued.
      if (!opts.settleMs) break;
      const next = await db.ingestionJob.findFirst({
        where: { status: { in: ["QUEUED", "FAILED"] }, runAt: { lte: new Date(Date.now() + opts.settleMs) }, ...(opts.types ? { type: { in: opts.types } } : {}) },
        orderBy: { runAt: "asc" },
        select: { runAt: true },
      });
      const waitMs = next ? next.runAt.getTime() - Date.now() : -1;
      if (!next || waitMs > budget - (Date.now() - started)) break;
      await new Promise((r) => setTimeout(r, Math.max(50, waitMs + 50)));
      continue;
    }
    result.processed++;
    const ctx = await createPipelineContext({ runId: job.runId, trigger: "MANUAL", now: opts.now });
    try {
      const out = await HANDLERS[job.type](job, ctx);
      await complete(job, out ?? undefined);
      result.succeeded++;
    } catch (error) {
      const permanent = error instanceof PermanentJobError || error instanceof ProviderAuthError;
      if (error instanceof ProviderAuthError && job.connectionId) {
        await db.sourceConnection.update({
          where: { id: job.connectionId },
          data: { status: "NEEDS_REAUTH", lastError: error.message, lastErrorAt: new Date() },
        });
      }
      if (error instanceof CursorExpiredError && job.connectionId) {
        // Next attempt performs a full resync from a fresh cursor.
        await db.sourceConnection.update({ where: { id: job.connectionId }, data: { cursor: Prisma.DbNull } });
      }
      const dead = await fail(job, error, { permanent });
      if (job.sourceItemId && STAGE_TYPES.has(job.type)) await markStageFailed(job.sourceItemId, job.type, error, dead);
      if (dead) result.dead++;
      else result.failed++;
      console.error(`[ingest] ${job.type} ${job.id} failed (attempt ${job.attempts}${dead ? ", giving up" : ""}):`, error instanceof Error ? error.message : error);
    } finally {
      await ctx.flush();
    }
  }

  result.remaining = await db.ingestionJob.count({
    where: { status: { in: ["QUEUED", "FAILED"] }, runAt: { lte: new Date() }, ...(opts.types ? { type: { in: opts.types } } : {}) },
  });
  result.durationMs = Date.now() - started;
  return result;
}
