"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Sensitivity, SourceProvider, SyncFrequency } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { SOURCE_PROVIDERS, SYNC_FREQUENCY } from "@/lib/intelligence";
import { getCeoContext } from "@/server/context";
import { createDemoConnection, disconnectConnection } from "@/server/ingestion/connections";
import { drainQueue } from "@/server/ingestion/jobs/worker";
import { providerAvailability } from "@/server/ingestion/providers/availability";
import { nextSyncTime, requestSync, SYNC_JOB } from "@/server/ingestion/scheduler";
import { audit } from "@/server/security/audit";
import { LIMITS, rateLimit } from "@/server/security/rate-limit";
import { requireViewer } from "@/server/security/session";
import { attemptAs, fail, id, ok, type ActionResult } from "./result";

function revalidateIntegrations() {
  revalidatePath("/settings/integrations");
  revalidatePath("/brain/ingestion");
}


// ─── Settings ────────────────────────────────────────────────────────────────

const settingsSchema = z
  .object({
    syncFrequency: z.enum(SyncFrequency).optional(),
    includeNoise: z.boolean().optional(),
    defaultSensitivity: z.enum(Sensitivity).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

export async function updateConnectionSettings(connectionId: string, input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  return attemptAs("integrations.manage", async () => {
    id.parse(connectionId);
    const data = settingsSchema.parse(input);
    const viewer = await requireViewer();
    const conn = await db.sourceConnection.findUnique({ where: { id: connectionId } });
    if (!conn || conn.status === "DISCONNECTED") return fail("Connection not found");
    if (data.syncFrequency === "REALTIME" && !providerAvailability()[conn.provider].webhooks) {
      return fail(`${SOURCE_PROVIDERS[conn.provider].label} doesn’t support near real-time sync`);
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
      if (data[key] !== undefined && data[key] !== conn[key]) changes[key] = { from: conn[key], to: data[key] };
    }
    if (!Object.keys(changes).length) return ok(undefined, "No changes");

    // A new frequency reschedules the next sync from the last one (or now).
    const frequency = data.syncFrequency ?? conn.syncFrequency;
    const nextSyncAt = data.syncFrequency ? nextSyncTime({ syncFrequency: frequency, consecutiveFailures: conn.consecutiveFailures }, conn.lastSyncAt ?? new Date()) : undefined;
    await db.sourceConnection.update({
      where: { id: connectionId },
      data: { ...data, ...(nextSyncAt !== undefined ? { nextSyncAt: nextSyncAt && nextSyncAt < new Date() ? new Date() : nextSyncAt } : {}) },
    });
    await audit({ action: "connection.update", viewer, targetType: "SourceConnection", targetId: connectionId, metadata: { provider: conn.provider, changes } });
    revalidateIntegrations();

    const message =
      data.syncFrequency !== undefined
        ? `Sync frequency: ${SYNC_FREQUENCY[frequency].label}`
        : data.includeNoise !== undefined
          ? data.includeNoise
            ? "Newsletters & notifications will be processed"
            : "Newsletters & notifications will be skipped"
          : "Default sensitivity saved";
    return ok(undefined, message);
  });
}

// ─── Run sync now ────────────────────────────────────────────────────────────

export interface SyncNowSummary {
  runId: string;
  status: "completed" | "running" | "queued";
  fetched: number;
  created: number;
  updated: number;
  noise: number;
  duplicatesPrevented: number;
  reviewItems: number;
  jobsProcessed: number;
}

const SYNC_BUDGET_MS = 20_000;

export async function runSyncNow(connectionId: string): Promise<ActionResult<SyncNowSummary>> {
  return attemptAs("integrations.manage", async () => {
    id.parse(connectionId);
    const viewer = await requireViewer();
    const limit = await rateLimit("sync-now", viewer.userId, LIMITS.syncNow);
    if (!limit.ok) return fail(`Too many manual syncs. Try again in ${Math.ceil(limit.retryAfterSec / 60)} min.`);

    const conn = await db.sourceConnection.findUnique({ where: { id: connectionId }, select: { id: true, kind: true, provider: true, status: true, label: true } });
    if (!conn || conn.status === "DISCONNECTED") return fail("Connection not found");
    if (conn.status === "NEEDS_REAUTH") return fail(`Reconnect ${SOURCE_PROVIDERS[conn.provider].label} before syncing — access was revoked or expired.`);
    if (conn.provider === "LOCAL_UPLOAD") return fail("Uploads don’t sync; add documents from the Documents page.");

    const { run, queued } = await requestSync(conn.id, "MANUAL");
    const drained = await drainQueue({ budgetMs: SYNC_BUDGET_MS });
    const [after, job] = await Promise.all([
      db.ingestionRun.findUnique({ where: { id: run.id } }),
      db.ingestionJob.findFirst({ where: { runId: run.id, type: SYNC_JOB[conn.kind] }, orderBy: { createdAt: "desc" }, select: { status: true, lastError: true } }),
    ]);
    const failedJob = job && (job.status === "FAILED" || job.status === "DEAD");
    const error = failedJob ? job.lastError || "Sync failed" : after?.status === "FAILED" ? after.error || "Sync failed" : null;

    await audit({
      action: "connection.sync",
      viewer,
      outcome: error ? "FAILURE" : "SUCCESS",
      targetType: "SourceConnection",
      targetId: conn.id,
      metadata: { provider: conn.provider, runId: run.id, queued, drained: { ...drained }, ...(error ? { error: error.slice(0, 300) } : {}) },
    });
    revalidateIntegrations();
    if (error) return fail(`Sync failed: ${error.slice(0, 300)}${job?.status === "FAILED" ? " (will retry automatically)" : ""}`);

    const r = after ?? run;
    const status: SyncNowSummary["status"] = r.status === "RUNNING" ? (job?.status === "QUEUED" ? "queued" : "running") : "completed";
    const summary: SyncNowSummary = {
      runId: run.id,
      status,
      fetched: r.fetched,
      created: r.created,
      updated: r.updated,
      noise: r.noise,
      duplicatesPrevented: r.duplicatesPrevented,
      reviewItems: r.reviewItems,
      jobsProcessed: drained.processed,
    };
    const counts = `${r.fetched} fetched · ${r.created} new · ${r.updated} updated · ${r.noise} noise · ${r.duplicatesPrevented} duplicates prevented · ${r.reviewItems} for review`;
    const message =
      status === "completed"
        ? `Sync complete — ${counts}`
        : status === "running"
          ? `Sync still running in the background — so far ${counts}`
          : "Sync queued — it will run with the next worker pass";
    return ok(summary, message);
  });
}

// ─── Connect / disconnect ────────────────────────────────────────────────────

const providerSchema = z.enum(SourceProvider).refine((p) => SOURCE_PROVIDERS[p].oauth != null, "This provider can’t be connected here");

export async function connectDemoAccount(provider: SourceProvider): Promise<ActionResult<{ id: string }>> {
  return attemptAs("integrations.manage", async () => {
    const p = providerSchema.parse(provider);
    const viewer = await requireViewer();
    // The demo mailbox/calendar/drive is the CEO's sample workspace, so the CEO owns it
    // (connection ownership grants read access — an admin setting it up must not gain that).
    const ceo = await getCeoContext();
    try {
      const conn = await createDemoConnection(SOURCE_PROVIDERS[p].kind, p, { userId: ceo.userId });
      await audit({ action: "connection.connect", viewer, targetType: "SourceConnection", targetId: conn.id, metadata: { provider: p, mode: "DEMO" } });
      revalidateIntegrations();
      return ok({ id: conn.id }, `${SOURCE_PROVIDERS[p].label} demo account connected — run a sync to ingest sample data`);
    } catch (error) {
      await audit({ action: "connection.connect", viewer, outcome: "FAILURE", metadata: { provider: p, mode: "DEMO", error: error instanceof Error ? error.message.slice(0, 300) : "unknown" } });
      return fail(`Couldn’t connect the demo account: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  });
}

const disconnectSchema = z.object({ deleteData: z.boolean() }).strict();

export async function disconnectAccount(connectionId: string, input: z.input<typeof disconnectSchema>): Promise<ActionResult> {
  return attemptAs("integrations.manage", async () => {
    id.parse(connectionId);
    const { deleteData } = disconnectSchema.parse(input);
    const viewer = await requireViewer();
    const conn = await db.sourceConnection.findUnique({ where: { id: connectionId }, select: { id: true, provider: true, status: true, accountEmail: true, itemsIngested: true } });
    if (!conn || conn.status === "DISCONNECTED") return fail("Connection not found");
    const metadata = { provider: conn.provider, accountEmail: conn.accountEmail, deleteData, itemsIngested: conn.itemsIngested };
    try {
      await disconnectConnection(connectionId, { deleteData, actor: { userId: viewer.userId, email: viewer.email } });
    } catch (error) {
      await audit({ action: "connection.disconnect", viewer, outcome: "FAILURE", targetType: "SourceConnection", targetId: connectionId, metadata: { ...metadata, error: error instanceof Error ? error.message.slice(0, 300) : "unknown" } });
      return fail(`Couldn’t disconnect: ${error instanceof Error ? error.message : "unknown error"}`);
    }
    // Success is audited by disconnectConnection itself (with the actor and deleted-item count).
    revalidateIntegrations();
    return ok(undefined, deleteData ? `${SOURCE_PROVIDERS[conn.provider].label} disconnected — ingested items deleted` : `${SOURCE_PROVIDERS[conn.provider].label} disconnected — history kept`);
  });
}
