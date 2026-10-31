/**
 * Decides when connections sync. Uses each connection's frequency and
 * nextSyncAt, backs off after consecutive failures, and never polls more
 * than needed: webhook-enabled (REALTIME) connections only get an hourly
 * safety sync, and work-hours connections stay quiet overnight and at
 * weekends (CEO's timezone). Also schedules the daily retention sweep.
 */
import type { IngestionRun, SourceConnection } from "@/generated/prisma/client";
import type { JobType, RunTrigger, SourceKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { dayFromKey, dayKey } from "@/lib/dates";
import { SYNC_FREQUENCY } from "@/lib/intelligence";
import { inWorkHours, nextWorkHoursInstant } from "@/lib/live-schedule";
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

/** Next time a connection should sync after a run (with failure backoff), in the CEO's timezone. */
export function nextSyncTime(conn: Pick<SourceConnection, "syncFrequency" | "consecutiveFailures">, from: Date, timeZone: string): Date | null {
  const minutes = SYNC_FREQUENCY[conn.syncFrequency].minutes;
  if (minutes == null) return null;
  const backoff = conn.consecutiveFailures > 0 ? Math.min(24 * 60, 15 * 2 ** (conn.consecutiveFailures - 1)) : 0;
  const next = new Date(from.getTime() + Math.max(minutes, backoff) * 60_000);
  return conn.syncFrequency === "WORK_HOURS" ? nextWorkHoursInstant(next, timeZone) : next;
}

/** The timezone schedules run in: the CEO's (the first user's before one exists). */
export async function scheduleTimezone(): Promise<string> {
  const user =
    (await db.user.findFirst({ where: { role: "CEO", active: true }, orderBy: { createdAt: "asc" }, select: { timezone: true } })) ??
    (await db.user.findFirst({ orderBy: { createdAt: "asc" }, select: { timezone: true } }));
  return user?.timezone ?? "America/New_York";
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
  const workHours = inWorkHours(now, await scheduleTimezone());
  const due = await db.sourceConnection.findMany({
    where: {
      status: { in: SYNCABLE },
      syncFrequency: workHours ? { not: "MANUAL" } : { notIn: ["MANUAL", "WORK_HOURS"] },
      OR: [{ nextSyncAt: null }, { nextSyncAt: { lte: now } }],
    },
    select: { id: true },
  });
  let queued = 0;
  for (const c of due) {
    const res = await requestSync(c.id, "SCHEDULED");
    if (res.queued) queued++;
  }
  // Once a day: a finished job releases its dedupe key, so check for today's run too.
  const today = dayKey(now);
  const swept = await db.ingestionJob.findFirst({ where: { type: "RETENTION_SWEEP", createdAt: { gte: dayFromKey(today) } }, select: { id: true } });
  if (!swept) await enqueue("RETENTION_SWEEP", { dedupeKey: `retention:${today}`, runAt: now });
  return queued;
}

/** Queue a sync for every active connection (used by the Daily Brain Refresh). */
export async function requestAllSyncs(trigger: RunTrigger): Promise<IngestionRun[]> {
  const conns = await db.sourceConnection.findMany({ where: { status: { in: SYNCABLE } }, select: { id: true } });
  const runs: IngestionRun[] = [];
  for (const c of conns) runs.push((await requestSync(c.id, trigger)).run);
  return runs;
}
