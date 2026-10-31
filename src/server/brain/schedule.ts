/**
 * Runs the Brain on the live-update schedule (see lib/live-schedule): the
 * morning brief at 6:30 AM every day, then hourly on weekdays through 7 PM,
 * in the CEO's timezone. The ingestion worker calls this every cycle.
 *
 * Each slot runs once. A refresh someone starts by hand (or the server's
 * cron) counts for the slot it falls in, and a queued or retrying refresh
 * holds the slot's dedupe key, so slots never double up.
 */
import { db } from "@/lib/db";
import { dueBrainSlot } from "@/lib/live-schedule";
import { enqueue } from "@/server/ingestion/jobs/queue";
import { scheduleTimezone } from "@/server/ingestion/scheduler";

/** Minutes a refresh is treated as still running before another may start. */
export const REFRESH_OVERLAP_MINUTES = 15;

/** Queue the Brain refresh for the current slot if it hasn't run. Returns the slot key when one was queued. */
export async function scheduleBrainRefresh(now = new Date()): Promise<string | null> {
  const slot = dueBrainSlot(now, await scheduleTimezone());
  if (!slot) return null;
  const ran = await db.brainRefresh.findFirst({ where: { startedAt: { gte: slot.at } }, select: { id: true } });
  if (ran || (await refreshInProgress(now))) return null;
  const dedupeKey = `brain:${slot.key}`;
  if (await db.ingestionJob.findUnique({ where: { dedupeKey }, select: { id: true } })) return null;
  await enqueue("DAILY_BRAIN_REFRESH", { dedupeKey, payload: { slot: slot.key }, maxAttempts: 2 });
  return slot.key;
}

/** A refresh started in the last few minutes that hasn't finished, if any. */
export async function refreshInProgress(now = new Date()) {
  return db.brainRefresh.findFirst({
    where: { status: "RUNNING", startedAt: { gte: new Date(now.getTime() - REFRESH_OVERLAP_MINUTES * 60_000) } },
    select: { id: true, startedAt: true },
  });
}
