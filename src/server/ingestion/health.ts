/**
 * Ingestion health metrics for the dashboard (/brain/ingestion) and the CLI
 * worker. Aggregates (counts, sums, avg/p95 durations) run in Postgres; the
 * per-day series is gap-filled in JS (fillDailySeries, unit-tested).
 *
 * Nothing here filters by viewer: these are operational counts and
 * identifiers. Titles of source items are returned with their sensitivity and
 * connection so the caller (queries/health.ts) can mask what the viewer may
 * not read.
 */
import type { IngestionRun } from "@/generated/prisma/client";
import type { JobStatus, JobType, SourceKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { DAY_MS, addDays, dayFromKey, dayKey, dayKeyInTz } from "@/lib/dates";
import { PROCESSING_STAGES } from "./pipeline";

const HOUR_MS = 3_600_000;
export const CHART_DAYS = 14;
const SYNC_TYPES: JobType[] = ["EMAIL_SYNC", "CALENDAR_SYNC", "DOCUMENT_SYNC"];
/** Order stages appear in the timing table: sync, then the pipeline, then follow-ups. */
export const STAGE_ORDER: JobType[] = [...SYNC_TYPES, ...PROCESSING_STAGES, "THREAD_SUMMARY", "PRIORITY_RECALC", "DAILY_BRAIN_REFRESH", "RETENTION_SWEEP"];

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Fill a per-day count series for the `days` calendar days ending at `endKey` (inclusive), oldest first. */
export function fillDailySeries(rows: { day: string; count: number }[], endKey: string, days: number): { day: string; count: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const end = dayFromKey(endKey);
  return Array.from({ length: days }, (_, i) => {
    const key = dayKey(addDays(end, i - days + 1));
    return { day: key, count: byDay.get(key) ?? 0 };
  });
}

// ─── Snapshot ────────────────────────────────────────────────────────────────

export interface KindSync {
  kind: SourceKind;
  connections: number;
  lastSuccess: { at: Date; connectionLabel: string; provider: string; runId: string } | null;
  inError: { id: string; label: string; provider: string; status: "ERROR" | "NEEDS_REAUTH"; lastError: string | null; lastErrorAt: Date | null }[];
}

export interface StageTiming {
  type: JobType;
  count: number;
  avgMs: number | null;
  p95Ms: number | null;
}

export interface PendingByType {
  type: JobType;
  queued: number;
  running: number;
  retrying: number;
}

export interface HealthSnapshot {
  now: Date;
  sync: KindSync[];
  processed: { last24h: number; last7d: number; skipped7d: number };
  failures: { failedItems: number; deadJobs: number };
  pending: { total: number; byType: PendingByType[] };
  extraction: { errors24h: number; errors7d: number };
  duplicates: { prevented7d: number; prevented24h: number; crossProvider: number; crossProvider7d: number };
  review: { pending: number; oldestPendingAt: Date | null };
  timing: { stages: StageTiming[]; avgLatencyMs: number | null; p95LatencyMs: number | null };
  brain: { lastRefresh: { at: Date; status: string } | null; lastProcessedAt: Date | null };
  daily: { day: string; count: number }[];
}

/** Always shown; meeting notes, CRM, finance and contracts appear once connected. */
const BASE_KINDS: SourceKind[] = ["EMAIL", "CALENDAR", "DOCUMENTS"];
const KIND_ORDER: SourceKind[] = ["EMAIL", "CALENDAR", "DOCUMENTS", "MEETINGS", "CRM", "FINANCE", "CONTRACTS"];

/** Every dashboard metric in one round of parallel queries. */
export async function healthSnapshot(opts: { now?: Date; timezone: string }): Promise<HealthSnapshot> {
  const now = opts.now ?? new Date();
  const h24 = new Date(now.getTime() - 24 * HOUR_MS);
  const d7 = new Date(now.getTime() - 7 * DAY_MS);
  const chartStart = new Date(now.getTime() - (CHART_DAYS + 1) * DAY_MS);
  const tz = opts.timezone;

  const [
    connections,
    lastRuns,
    processed24,
    processed7,
    skipped7,
    failedItems,
    deadJobs,
    pendingRows,
    runSums24,
    runSums7,
    crossProvider,
    crossProvider7,
    reviewPending,
    oldestReview,
    timingRows,
    latencyRows,
    lastRefresh,
    lastProcessed,
    dailyRows,
  ] = await Promise.all([
    db.sourceConnection.findMany({
      where: { status: { not: "DISCONNECTED" } },
      select: { id: true, kind: true, label: true, provider: true, status: true, lastError: true, lastErrorAt: true },
    }),
    // Latest successful run per kind (DISTINCT ON keeps one row per kind).
    db.$queryRaw<{ kind: SourceKind; runId: string; at: Date; label: string; provider: string }[]>`
      SELECT DISTINCT ON (c."kind") c."kind", r."id" AS "runId", COALESCE(r."completedAt", r."startedAt") AS "at", c."label", c."provider"::text AS "provider"
      FROM "IngestionRun" r JOIN "SourceConnection" c ON c."id" = r."connectionId"
      WHERE r."status" IN ('SUCCEEDED', 'PARTIAL')
      ORDER BY c."kind", COALESCE(r."completedAt", r."startedAt") DESC`,
    db.sourceItem.count({ where: { status: { in: ["PROCESSED", "SKIPPED"] }, processedAt: { gte: h24 } } }),
    db.sourceItem.count({ where: { status: { in: ["PROCESSED", "SKIPPED"] }, processedAt: { gte: d7 } } }),
    db.sourceItem.count({ where: { status: "SKIPPED", processedAt: { gte: d7 } } }),
    db.sourceItem.count({ where: { status: "FAILED" } }),
    db.ingestionJob.count({ where: { status: "DEAD" } }),
    db.ingestionJob.groupBy({ by: ["type", "status"], where: { status: { in: ["QUEUED", "RUNNING", "FAILED"] } }, _count: { _all: true } }),
    db.ingestionRun.aggregate({ where: { startedAt: { gte: h24 } }, _sum: { extractionErrors: true, duplicatesPrevented: true } }),
    db.ingestionRun.aggregate({ where: { startedAt: { gte: d7 } }, _sum: { extractionErrors: true, duplicatesPrevented: true } }),
    db.sourceItem.count({ where: { duplicateOfId: { not: null } } }),
    db.sourceItem.count({ where: { duplicateOfId: { not: null }, ingestedAt: { gte: d7 } } }),
    db.reviewQueueItem.count({ where: { status: "PENDING" } }),
    db.reviewQueueItem.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.$queryRaw<{ type: JobType; count: bigint; avg: number | null; p95: number | null }[]>`
      SELECT "type"::text AS "type", count(*) AS "count", avg("durationMs")::float8 AS "avg",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "durationMs")::float8 AS "p95"
      FROM "IngestionJob"
      WHERE "status" = 'SUCCEEDED' AND "durationMs" IS NOT NULL AND "completedAt" >= ${d7}
      GROUP BY "type"`,
    db.$queryRaw<{ avg: number | null; p95: number | null }[]>`
      SELECT avg(EXTRACT(EPOCH FROM ("processedAt" - "ingestedAt")) * 1000)::float8 AS "avg",
             percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("processedAt" - "ingestedAt")) * 1000)::float8 AS "p95"
      FROM "SourceItem"
      WHERE "status" = 'PROCESSED' AND "processedAt" >= ${d7} AND "processedAt" >= "ingestedAt"`,
    db.brainRefresh.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, completedAt: true, status: true } }),
    db.sourceItem.findFirst({ where: { processedAt: { not: null } }, orderBy: { processedAt: "desc" }, select: { processedAt: true } }),
    // Timestamps are stored as UTC without zone: interpret as UTC, then bucket by the CEO's calendar day.
    db.$queryRaw<{ day: string; count: bigint }[]>`
      SELECT to_char((("processedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS "day", count(*) AS "count"
      FROM "SourceItem"
      WHERE "status" IN ('PROCESSED', 'SKIPPED') AND "processedAt" >= ${chartStart}
      GROUP BY 1`,
  ]);

  const kinds = KIND_ORDER.filter((k) => BASE_KINDS.includes(k) || connections.some((c) => c.kind === k));
  const sync: KindSync[] = kinds.map((kind) => {
    const last = lastRuns.find((r) => r.kind === kind);
    return {
      kind,
      connections: connections.filter((c) => c.kind === kind).length,
      lastSuccess: last ? { at: last.at, connectionLabel: last.label, provider: last.provider, runId: last.runId } : null,
      inError: connections
        .filter((c): c is typeof c & { status: "ERROR" | "NEEDS_REAUTH" } => c.kind === kind && (c.status === "ERROR" || c.status === "NEEDS_REAUTH"))
        .map((c) => ({ id: c.id, label: c.label, provider: c.provider, status: c.status, lastError: c.lastError, lastErrorAt: c.lastErrorAt })),
    };
  });

  const pendingMap = new Map<JobType, PendingByType>();
  for (const row of pendingRows) {
    const entry = pendingMap.get(row.type) ?? { type: row.type, queued: 0, running: 0, retrying: 0 };
    const n = row._count._all;
    const status: JobStatus = row.status;
    if (status === "QUEUED") entry.queued += n;
    else if (status === "RUNNING") entry.running += n;
    else entry.retrying += n;
    pendingMap.set(row.type, entry);
  }
  const byType = STAGE_ORDER.map((t) => pendingMap.get(t)).filter((e): e is PendingByType => Boolean(e));

  const stages: StageTiming[] = STAGE_ORDER.map((type) => {
    const row = timingRows.find((r) => r.type === type);
    return row ? { type, count: Number(row.count), avgMs: row.avg, p95Ms: row.p95 } : null;
  }).filter((s): s is StageTiming => Boolean(s));

  return {
    now,
    sync,
    processed: { last24h: processed24, last7d: processed7, skipped7d: skipped7 },
    failures: { failedItems, deadJobs },
    pending: { total: byType.reduce((s, e) => s + e.queued + e.running + e.retrying, 0), byType },
    extraction: { errors24h: runSums24._sum.extractionErrors ?? 0, errors7d: runSums7._sum.extractionErrors ?? 0 },
    duplicates: {
      prevented24h: runSums24._sum.duplicatesPrevented ?? 0,
      prevented7d: runSums7._sum.duplicatesPrevented ?? 0,
      crossProvider,
      crossProvider7d: crossProvider7,
    },
    review: { pending: reviewPending, oldestPendingAt: oldestReview?.createdAt ?? null },
    timing: { stages, avgLatencyMs: latencyRows[0]?.avg ?? null, p95LatencyMs: latencyRows[0]?.p95 ?? null },
    brain: {
      lastRefresh: lastRefresh ? { at: lastRefresh.completedAt ?? lastRefresh.startedAt, status: lastRefresh.status } : null,
      lastProcessedAt: lastProcessed?.processedAt ?? null,
    },
    daily: fillDailySeries(
      dailyRows.map((r) => ({ day: r.day, count: Number(r.count) })),
      dayKeyInTz(now, tz),
      CHART_DAYS,
    ),
  };
}

// ─── Tables ──────────────────────────────────────────────────────────────────

export type RecentRun = IngestionRun & { connection: { id: string; label: string; provider: string; kind: SourceKind; accountEmail: string | null } | null };

export async function recentRuns(limit = 15): Promise<RecentRun[]> {
  return db.ingestionRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { connection: { select: { id: true, label: true, provider: true, kind: true, accountEmail: true } } },
  });
}

/** Jobs that are retrying or gave up, newest first. */
export async function failingJobs(limit = 25) {
  return db.ingestionJob.findMany({
    where: { status: { in: ["FAILED", "DEAD"] } },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      type: true,
      status: true,
      attempts: true,
      maxAttempts: true,
      lastError: true,
      runAt: true,
      updatedAt: true,
      connection: { select: { id: true, label: true, provider: true } },
      sourceItem: { select: { id: true, title: true, kind: true, sensitivity: true, connectionId: true } },
    },
  });
}

/** Source items whose processing failed (or is failing), newest first. */
export async function itemsWithErrors(limit = 20) {
  return db.sourceItem.findMany({
    where: { OR: [{ status: "FAILED" }, { processingError: { not: null } }] },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      kind: true,
      status: true,
      stage: true,
      attempts: true,
      processingError: true,
      sensitivity: true,
      updatedAt: true,
      connection: { select: { id: true, provider: true, label: true } },
    },
  });
}

/** Recent validation issues recorded by the extraction stage (stageData.extractionErrors). */
export async function recentExtractionIssues(limit = 10) {
  return db.$queryRaw<{ id: string; title: string; sensitivity: string; connectionId: string; extractedAt: Date | null; errors: { path: string; reason: string }[] }[]>`
    SELECT "id", "title", "sensitivity"::text AS "sensitivity", "connectionId", "extractedAt", "stageData"->'extractionErrors' AS "errors"
    FROM "SourceItem"
    WHERE jsonb_typeof("stageData"->'extractionErrors') = 'array' AND jsonb_array_length("stageData"->'extractionErrors') > 0
    ORDER BY "extractedAt" DESC NULLS LAST
    LIMIT ${limit}`;
}

/** One line for logs (cron tick, CLI worker). */
export async function queueSummary(): Promise<{ queued: number; running: number; retrying: number; dead: number }> {
  const rows = await db.ingestionJob.groupBy({ by: ["status"], _count: { _all: true } });
  const n = (s: JobStatus) => rows.find((r) => r.status === s)?._count._all ?? 0;
  return { queued: n("QUEUED"), running: n("RUNNING"), retrying: n("FAILED"), dead: n("DEAD") };
}
