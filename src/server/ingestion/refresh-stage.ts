/**
 * The ingest stage of the Daily Brain Refresh: incrementally sync every
 * connected source, drain the processing pipeline within a time budget, then
 * run the daily passes that depend on the clock (meetings that ended,
 * overdue commitments). Work that does not fit in the budget stays queued and
 * is picked up by the cron tick / worker.
 */
import type { RunTrigger } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { createPipelineContext } from "./context";
import { drainQueue } from "./jobs/worker";
import { requestAllSyncs } from "./scheduler";
import { sweepCommitments } from "./write/commitments";
import { markCompletedMeetings } from "./write/meetings";

export interface IngestStageResult {
  connections: number;
  runs: { connectionId: string | null; status: string; created: number; updated: number; error: string | null }[];
  jobsProcessed: number;
  jobsFailed: number;
  jobsRemaining: number;
  meetingsCompleted: number;
  overdueCommitments: number;
  errors: string[];
}

export async function runIngestStage(opts: { trigger: RunTrigger; now: Date; budgetMs: number }): Promise<IngestStageResult> {
  const errors: string[] = [];
  const runs = await requestAllSyncs(opts.trigger === "SEED" ? "SEED" : "REFRESH");
  const drain = await drainQueue({ budgetMs: opts.budgetMs, now: opts.now, settleMs: 10_000 });

  const ctx = await createPipelineContext({ trigger: "REFRESH", now: opts.now });
  const meetingsCompleted = await markCompletedMeetings(ctx).catch((e: unknown) => {
    errors.push(`meetings: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  });
  const commitments = await sweepCommitments(ctx).catch((e: unknown) => {
    errors.push(`commitments: ${e instanceof Error ? e.message : String(e)}`);
    return { overdue: 0, insights: 0, inbox: 0 };
  });
  await ctx.flush();

  const finished = await db.ingestionRun.findMany({
    where: { id: { in: runs.map((r) => r.id) } },
    select: { connectionId: true, status: true, created: true, updated: true, error: true },
  });
  for (const r of finished) if (r.status === "FAILED" && r.error) errors.push(r.error);

  return {
    connections: runs.length,
    runs: finished,
    jobsProcessed: drain.processed,
    jobsFailed: drain.failed + drain.dead,
    jobsRemaining: drain.remaining,
    meetingsCompleted,
    overdueCommitments: commitments.overdue,
    errors,
  };
}
