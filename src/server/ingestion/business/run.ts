/**
 * Runs one business or meeting-notes connector sync (BUSINESS_SYNC /
 * MEETINGS_SYNC jobs) with the same bookkeeping as mail, calendar and
 * document syncs: an IngestionRun with counters and a log, connection status,
 * failure backoff, and NEEDS_REAUTH when the vendor rejects the credentials.
 */
import type { IngestionRun, Prisma, SourceConnection } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { BRAIN_SOURCE_KEY } from "@/server/brain/connectors";
import { syncGoalProgressFromMetrics } from "@/server/brain/goal-progress";
import { connectionSettings, getProviderContext } from "../connections";
import type { RefreshableProviderContext } from "../providers/http";
import { SYNC_JOB, nextSyncTime } from "../scheduler";
import { type PipelineContext, ProviderAuthError } from "../types";
import { getBusinessConnector } from "./registry";
import type { ConnectorSyncContext, SyncCounter } from "./types";

export interface BusinessSyncOutcome {
  connectionId: string;
  runId: string;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  error?: string;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

function appendLog(run: IngestionRun, notes: string[]): Prisma.InputJsonValue | undefined {
  if (!notes.length) return undefined;
  const previous = Array.isArray(run.log) ? (run.log as unknown[]) : [];
  return [...previous, ...notes].slice(-100) as Prisma.InputJsonValue;
}

export async function syncBusinessConnection(pipeline: PipelineContext, connectionId: string, runId: string): Promise<BusinessSyncOutcome> {
  const conn = await db.sourceConnection.findUnique({ where: { id: connectionId } });
  const counters: Record<SyncCounter, number> = { fetched: 0, created: 0, updated: 0, unchanged: 0, failed: 0 };
  const base: BusinessSyncOutcome = { connectionId, runId, ...counters };
  if (!conn) return { ...base, error: "Connection not found" };

  const run =
    (runId ? await db.ingestionRun.findUnique({ where: { id: runId } }) : null) ??
    (await db.ingestionRun.create({ data: { connectionId, trigger: pipeline.trigger, cursorBefore: conn.cursor ?? undefined } }));
  base.runId = run.id;
  const finish = async (status: "SUCCEEDED" | "PARTIAL" | "FAILED", extra: { error?: string | null; notes?: string[] } = {}) => {
    const now = new Date();
    await db.ingestionRun.update({
      where: { id: run.id },
      data: {
        status,
        completedAt: now,
        durationMs: now.getTime() - run.startedAt.getTime(),
        error: extra.error ?? null,
        fetched: { increment: counters.fetched },
        created: { increment: counters.created },
        updated: { increment: counters.updated },
        unchanged: { increment: counters.unchanged },
        failed: { increment: counters.failed },
        log: appendLog(run, extra.notes ?? []),
      },
    });
  };

  if (conn.status === "DISCONNECTED" || conn.status === "PAUSED") {
    await finish("SUCCEEDED", { notes: [`Skipped: connection is ${conn.status.toLowerCase()}`] });
    return base;
  }
  if (conn.status === "NEEDS_REAUTH") {
    const message = "Reconnect needed before this source can sync";
    await finish("FAILED", { error: message });
    throw new ProviderAuthError(message);
  }
  const connector = getBusinessConnector(conn.provider);
  if (!connector) {
    await finish("FAILED", { error: `${conn.provider} has no connector` });
    return { ...base, error: `${conn.provider} has no connector` };
  }

  // One sync per connection at a time (same rule as the mail/calendar/document syncs).
  const running = await db.ingestionJob.findMany({
    where: { connectionId, type: SYNC_JOB[conn.kind], status: "RUNNING" },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    select: { runId: true },
    take: 1,
  });
  if (running[0] && running[0].runId !== run.id) {
    await finish("SUCCEEDED", { notes: [`Merged into the sync already running (run ${running[0].runId ?? "unknown"})`] });
    return base;
  }

  await db.sourceConnection.update({ where: { id: conn.id }, data: { status: "SYNCING" } });
  const notes: string[] = [];
  let settings = connectionSettings(conn);
  const cursor = conn.cursor && typeof conn.cursor === "object" && !Array.isArray(conn.cursor) ? (conn.cursor as Record<string, unknown>) : null;
  const now = new Date();

  try {
    const http = (await getProviderContext(conn.id, now)) as RefreshableProviderContext;
    const ctx: ConnectorSyncContext = {
      pipeline,
      http,
      connection: connectionView(conn, settings),
      runId: run.id,
      now,
      cursor,
      initial: cursor === null,
      async saveCursor(next) {
        await db.sourceConnection.update({ where: { id: conn.id }, data: { cursor: next as Prisma.InputJsonValue } });
      },
      async saveSettings(patch) {
        settings = { ...settings, ...patch };
        ctx.connection.settings = settings;
        await db.sourceConnection.update({ where: { id: conn.id }, data: { settings: settings as Prisma.InputJsonValue } });
      },
      count(counter, by = 1) {
        counters[counter] += by;
      },
      note(message) {
        if (notes.length < 50) notes.push(message.slice(0, 300));
      },
    };
    await connector.sync(ctx);

    await finish(counters.failed > 0 ? "PARTIAL" : "SUCCEEDED", { notes });
    await db.sourceConnection.update({
      where: { id: conn.id },
      data: {
        status: "CONNECTED",
        lastSyncAt: now,
        lastSuccessAt: now,
        lastError: null,
        consecutiveFailures: 0,
        nextSyncAt: nextSyncTime({ syncFrequency: conn.syncFrequency, consecutiveFailures: 0 }, now),
        itemsIngested: { increment: counters.created },
      },
    });
    if (conn.brainSourceId) {
      await db.brainSource
        .update({ where: { id: conn.brainSourceId }, data: { lastSyncAt: now, itemsIndexed: { increment: counters.created }, status: "CONNECTED", error: null } })
        .catch(() => {});
    }
    // New numbers move the goals they measure right away, not only at the next refresh.
    if (conn.kind === "FINANCE" || conn.kind === "CRM") await syncGoalProgressFromMetrics(db, pipeline.ceo.today).catch(() => 0);
    return { ...base, ...counters };
  } catch (error) {
    const message = errorText(error);
    await finish("FAILED", { error: message, notes }).catch(() => {});
    if (error instanceof ProviderAuthError) {
      await db.sourceConnection.update({ where: { id: conn.id }, data: { status: "NEEDS_REAUTH", lastError: message, lastErrorAt: now } });
      throw error;
    }
    const failures = conn.consecutiveFailures + 1;
    await db.sourceConnection.update({
      where: { id: conn.id },
      data: {
        status: "ERROR",
        lastSyncAt: now,
        lastError: message,
        lastErrorAt: now,
        consecutiveFailures: failures,
        nextSyncAt: nextSyncTime({ syncFrequency: conn.syncFrequency, consecutiveFailures: failures }, now),
      },
    });
    throw error;
  }
}

function connectionView(conn: SourceConnection, settings: Record<string, unknown>): ConnectorSyncContext["connection"] {
  return {
    id: conn.id,
    provider: conn.provider,
    label: conn.label,
    accountEmail: conn.accountEmail,
    externalAccountId: conn.externalAccountId,
    settings,
    defaultSensitivity: conn.defaultSensitivity,
    syncFrequency: conn.syncFrequency,
    sourceKey: BRAIN_SOURCE_KEY[conn.provider],
  };
}
