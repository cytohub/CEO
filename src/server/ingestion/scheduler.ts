/**
 * Decides when connections sync. Uses each connection's frequency and
 * nextSyncAt, backs off after consecutive failures, and never polls more
 * than needed: webhook-enabled (REALTIME) connections only get an hourly
 * safety sync. Also schedules the nightly retention sweep.
 */
import type { IngestionRun, SourceConnection } from "@/generated/prisma/client";
import type { JobType, RunTrigger, SourceKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import { SYNC_FREQUENCY } from "@/lib/intelligence";
import { enqueue } from "./jobs/queue";

export const SYNC_JOB: Record<SourceKind, JobType> = {
  EMAIL: "EMAIL_SYNC",
  CALENDAR: "CALENDAR_SYNC",
  DOCUMENTS: "DOCUMENT_SYNC",
  MEETINGS: "MEETINGS_SYNC",
  CRM: "BUSINESS_SYNC",
  FINANCE: "BUSINESS_SYNC",
  CONTRACTS: "BUSINESS_SYNC",
};

const SYNCABLE: SourceConnection["status"][] = ["CONNECTED", "ERROR", "SYNCING"];

/** Next time a connection should sync after a run (with failure backoff). */
export function nextSyncTime(conn: Pick<SourceConnection, "syncFrequency" | "consecutiveFailures">, from: Date): Date | null {
  const minutes = SYNC_FREQUENCY[conn.syncFrequency].minutes;
  if (minutes == null) return null;
  const backoff = conn.consecutiveFailures > 0 ? Math.min(24 * 60, 15 * 2 ** (conn.consecutiveFailures - 1)) : 0;
  return new Date(from.getTime() + Math.max(minutes, backoff) * 60_000);
}

/** Create an IngestionRun and queue the sync job for one connection (idempotent while one is pending). */
export async function requestSync(connectionId: string, trigger: RunTrigger): Promise<{ run: IngestionRun; queued: boolean }> {
  const conn = await db.sourceConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const type = SYNC_JOB[conn.kind];
  const pending = await db.ingestionJob.findUnique({ where: { dedupeKey: `sync:${connectionId}` }, include: { run: true } });
  if (pending?.run) return { run: pending.run, queued: false };
  const run = await db.ingestionRun.create({ data: { connectionId, trigger, cursorBefore: conn.cursor ?? undefined } });
  await enqueue(type, {
    connectionId,
    runId: run.id,
    payload: { runId: run.id },
    dedupeKey: `sync:${connectionId}`,
    maxAttempts: 4,
  });
  return { run, queued: true };
}

/** Queue syncs for every connection that is due. Returns the number queued. */
export async function scheduleDueSyncs(now = new Date()): Promise<number> {
  const due = await db.sourceConnection.findMany({
    where: {
      status: { in: SYNCABLE },
      syncFrequency: { not: "MANUAL" },
      OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }],
    },
    select: { id: true },
  });
  let queued = 0;
  for (const c of due) {
    const res = await requestSync(c.id, "SCHEDULED");
    if (res.queued) queued++;
  }
  await enqueue("RETENTION_SWEEP", { dedupeKey: `retention:${dayKey(now)}`, runAt: now });
  return queued;
}

/** Queue a sync for every active connection (used by the Daily Brain Refresh). */
export async function requestAllSyncs(trigger: RunTrigger): Promise<IngestionRun[]> {
  const conns = await db.sourceConnection.findMany({ where: { status: { in: SYNCABLE } }, select: { id: true } });
  const runs: IngestionRun[] = [];
  for (const c of conns) runs.push((await requestSync(c.id, trigger)).run);
  return runs;
}
