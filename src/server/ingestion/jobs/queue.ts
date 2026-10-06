/**
 * Postgres-backed job queue for the ingestion pipeline.
 *
 * - enqueue() is idempotent while a job with the same dedupeKey is queued or
 *   running (the key is released when the job finishes, so the same work can
 *   be scheduled again later).
 * - claim() takes the next runnable job with FOR UPDATE SKIP LOCKED, so any
 *   number of workers can drain the queue concurrently.
 * - fail() retries with exponential backoff + jitter until maxAttempts, then
 *   marks the job DEAD for the health dashboard.
 * - Stale RUNNING jobs (worker crashed) are recovered after LOCK_TIMEOUT_MS.
 */
import type { IngestionJob, Prisma } from "@/generated/prisma/client";
import type { JobType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

export const LOCK_TIMEOUT_MS = 10 * 60_000;
const BASE_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 30 * 60_000;

/** Default priorities: sync and user-facing work first, maintenance last. */
export const JOB_PRIORITY: Record<JobType, number> = {
  DAILY_BRAIN_REFRESH: 100,
  EMAIL_SYNC: 80,
  CALENDAR_SYNC: 80,
  DOCUMENT_SYNC: 70,
  DOCUMENT_PARSE: 60,
  ENTITY_EXTRACTION: 50,
  ENTITY_RESOLUTION: 50,
  RELATIONSHIP_MAPPING: 50,
  INTELLIGENCE_EXTRACTION: 45,
  BRAIN_WRITE: 45,
  THREAD_SUMMARY: 30,
  PRIORITY_RECALC: 20,
  RETENTION_SWEEP: 5,
};

export interface EnqueueOptions {
  payload?: Record<string, unknown>;
  dedupeKey?: string;
  runAt?: Date;
  priority?: number;
  maxAttempts?: number;
  connectionId?: string | null;
  sourceItemId?: string | null;
  runId?: string | null;
}

/** Queue a job. Returns the existing job when an identical one is already pending. */
export async function enqueue(type: JobType, opts: EnqueueOptions = {}): Promise<IngestionJob> {
  const data: Prisma.IngestionJobUncheckedCreateInput = {
    type,
    payload: (opts.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    dedupeKey: opts.dedupeKey ?? null,
    runAt: opts.runAt ?? new Date(),
    priority: opts.priority ?? JOB_PRIORITY[type],
    maxAttempts: opts.maxAttempts ?? 5,
    connectionId: opts.connectionId ?? null,
    sourceItemId: opts.sourceItemId ?? null,
    runId: opts.runId ?? null,
  };
  if (!opts.dedupeKey) return db.ingestionJob.create({ data });
  const existing = await db.ingestionJob.findUnique({ where: { dedupeKey: opts.dedupeKey } });
  if (existing) return existing;
  try {
    return await db.ingestionJob.create({ data });
  } catch (error) {
    // Lost a race with another enqueue of the same key.
    const raced = await db.ingestionJob.findUnique({ where: { dedupeKey: opts.dedupeKey } });
    if (raced) return raced;
    throw error;
  }
}

/** Atomically claim the next runnable job (optionally restricted to some types). */
export async function claim(workerId: string, types?: JobType[]): Promise<IngestionJob | null> {
  const typeFilter = types?.length ? types : null;
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "IngestionJob" SET
      "status" = 'RUNNING',
      "lockedAt" = now(),
      "lockedBy" = ${workerId},
      "startedAt" = now(),
      "attempts" = "attempts" + 1,
      "updatedAt" = now()
    WHERE "id" = (
      SELECT "id" FROM "IngestionJob"
      WHERE "status" IN ('QUEUED', 'FAILED')
        AND "runAt" <= now()
        AND (${typeFilter}::text[] IS NULL OR "type"::text = ANY(${typeFilter}::text[]))
      ORDER BY "priority" DESC, "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING "id"`;
  if (!rows.length) return null;
  return db.ingestionJob.findUnique({ where: { id: rows[0].id } });
}

export async function complete(job: IngestionJob, result?: Record<string, unknown>) {
  const now = new Date();
  await db.ingestionJob.update({
    where: { id: job.id },
    data: {
      status: "SUCCEEDED",
      completedAt: now,
      durationMs: job.startedAt ? now.getTime() - job.startedAt.getTime() : null,
      lockedAt: null,
      lockedBy: null,
      dedupeKey: null,
      lastError: null,
      result: (result ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export function backoffMs(attempts: number): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
  return Math.round(exp * (0.75 + Math.random() * 0.5));
}

/** Record a failure: retry later, or give up (DEAD) after maxAttempts / on a permanent error. */
export async function fail(job: IngestionJob, error: unknown, opts: { permanent?: boolean } = {}) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  const now = new Date();
  const dead = opts.permanent || job.attempts >= job.maxAttempts;
  await db.ingestionJob.update({
    where: { id: job.id },
    data: {
      status: dead ? "DEAD" : "FAILED",
      lastError: message,
      lockedAt: null,
      lockedBy: null,
      completedAt: dead ? now : null,
      durationMs: job.startedAt ? now.getTime() - job.startedAt.getTime() : null,
      runAt: dead ? job.runAt : new Date(now.getTime() + backoffMs(job.attempts)),
      dedupeKey: dead ? null : job.dedupeKey,
    },
  });
  return dead;
}

/** Requeue jobs whose worker died mid-run. */
export async function recoverStale(): Promise<number> {
  const res = await db.ingestionJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - LOCK_TIMEOUT_MS) } },
    data: { status: "FAILED", lockedAt: null, lockedBy: null, lastError: "Worker lost the lock (timed out); retrying." },
  });
  return res.count;
}

/** Manual retry from the health dashboard. */
export async function retryJob(jobId: string) {
  return db.ingestionJob.update({
    where: { id: jobId },
    data: { status: "QUEUED", runAt: new Date(), attempts: 0, lastError: null, completedAt: null, lockedAt: null, lockedBy: null },
  });
}

export async function pendingCount(types?: JobType[]): Promise<number> {
  return db.ingestionJob.count({ where: { status: { in: ["QUEUED", "FAILED", "RUNNING"] }, ...(types ? { type: { in: types } } : {}) } });
}

/** Marks a failure as permanent (no retry), e.g. validation errors or revoked access. */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}
