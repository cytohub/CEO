"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { JOB_TYPES } from "@/lib/intelligence";
import { retryJob } from "@/server/ingestion/jobs/queue";
import { audit } from "@/server/security/audit";
import { requireViewer } from "@/server/security/session";
import { attemptAs, fail, id, ok, type ActionResult } from "./result";

/** Health dashboard: put a retrying or failed (DEAD) job back on the queue now. */
export async function retryIngestionJob(jobId: string): Promise<ActionResult> {
  return attemptAs("integrations.manage", async () => {
    id.parse(jobId);
    const viewer = await requireViewer();
    const job = await db.ingestionJob.findUnique({ where: { id: jobId }, select: { id: true, type: true, status: true, attempts: true, lastError: true, sourceItemId: true, connectionId: true } });
    if (!job) return fail("Job not found — it may have finished or been cleaned up");
    if (job.status !== "DEAD" && job.status !== "FAILED") return fail(`Only failed jobs can be retried (this one is ${job.status.toLowerCase()})`);
    await retryJob(job.id);
    await audit({
      action: "job.retry",
      viewer,
      targetType: "IngestionJob",
      targetId: job.id,
      metadata: { type: job.type, previousStatus: job.status, attempts: job.attempts, sourceItemId: job.sourceItemId, connectionId: job.connectionId, lastError: job.lastError?.slice(0, 300) ?? null },
    });
    revalidatePath("/brain/ingestion");
    return ok(undefined, `${JOB_TYPES[job.type].label} queued for retry`);
  });
}
