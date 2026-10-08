/**
 * Daily Brain Refresh — the morning pipeline.
 *
 *   0. Ingest    incremental sync of every connected email, calendar and
 *                document source; the ingestion pipeline extracts, resolves,
 *                writes intelligence (with provenance) and files review items
 *   1. Sync      legacy connectors write new BrainSignals
 *   2. Understand signals → insights (+ commitments → tasks)
 *   3. Analyze   the workspace graph → insights
 *   4. Persist   insights deduplicated by fingerprint; inbox items filed
 *   5. Reconcile resolve inbox items whose cause is gone
 *   6. Prioritize rescore all open work; refresh delegation advice; Top 5
 *   7. Brief     compose the CEO Daily Intelligence Brief
 *   8. Record    refresh stats + activity log (history feeds tomorrow's run)
 */
import type { BrainInsight, Prisma } from "@/generated/prisma/client";
import type { RefreshTrigger } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { loadCeoContext } from "@/server/context";
import { getPriorityWeights, getThresholds } from "@/server/settings";
import { analyzeSignals } from "./analyzers/signals";
import {
  analyzeAttention,
  analyzeDeals,
  analyzeDecisions,
  analyzeDelegations,
  analyzeExecution,
  analyzeGoals,
  analyzeInvestors,
  analyzeMeetings,
  analyzeMetrics,
  analyzeMilestones,
} from "./analyzers/workspace";
import { composeBrief, enhanceBriefWithClaude } from "./brief";
import { findOpenItemForRecord } from "@/server/inbox-dedupe";
import { runIngestStage, type IngestStageResult } from "@/server/ingestion/refresh-stage";
import { CONNECTORS, PIPELINE_SOURCE_KEYS } from "./connectors";
import { syncGoalProgressFromMetrics } from "./goal-progress";
import { snapshotDerivedMetrics } from "./metrics";
import { recommendTopFive, rescoreTasks } from "./priorities";
import type { BrainContext, InsightDraft, SyncResult } from "./types";

export interface RefreshOutcome {
  refreshId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  insightsCreated: number;
  inboxCreated: number;
  tasksCreated: number;
  durationMs: number;
  error?: string;
}

export async function runBrainRefresh(opts: { trigger?: RefreshTrigger; now?: Date; ingestBudgetMs?: number } = {}): Promise<RefreshOutcome> {
  const now = opts.now ?? new Date();
  const started = Date.now();
  const ceo = await loadCeoContext(db, now);
  const previous = await db.brainRefresh.findFirst({
    where: { status: { in: ["SUCCEEDED", "PARTIAL"] }, startedAt: { lt: now } },
    orderBy: { startedAt: "desc" },
  });
  const since = previous?.completedAt ?? previous?.startedAt ?? new Date(now.getTime() - 24 * 3_600_000);

  const refresh = await db.brainRefresh.create({
    data: { trigger: opts.trigger ?? "MANUAL", status: "RUNNING", startedAt: now },
  });
  const log: { at: string; stage: string; message: string }[] = [];

  try {
    // 0. Ingest — outside the analysis transaction: provider calls and AI
    // extraction must never hold database locks.
    let ingest: IngestStageResult | null = null;
    try {
      ingest = await runIngestStage({ trigger: opts.trigger === "SEED" ? "SEED" : "REFRESH", now, budgetMs: opts.ingestBudgetMs ?? 240_000 });
      log.push({
        at: new Date().toISOString(),
        stage: "ingest",
        message: `${ingest.connections} sources synced; ${ingest.jobsProcessed} pipeline jobs run (${ingest.jobsFailed} failed, ${ingest.jobsRemaining} still queued); ${ingest.meetingsCompleted} meetings completed; ${ingest.overdueCommitments} overdue commitments`,
      });
    } catch (error) {
      log.push({ at: new Date().toISOString(), stage: "ingest", message: `Ingestion failed: ${error instanceof Error ? error.message : String(error)}` });
    }

    const result = await db.$transaction(
      async (tx) => {
        const ctx: BrainContext = {
          tx,
          now,
          today: ceo.today,
          timezone: ceo.timezone,
          ceoPersonId: ceo.personId,
          refreshId: refresh.id,
          since,
          thresholds: await getThresholds(tx),
          weights: await getPriorityWeights(tx),
          log: (stage, message) => log.push({ at: new Date().toISOString(), stage, message }),
        };

        // 1. Sync
        const sourceResults: SyncResult[] = [];
        const sources = await tx.brainSource.findMany();
        for (const connector of CONNECTORS) {
          const source = sources.find((s) => s.key === connector.key);
          if (!source || source.status === "DISABLED") continue;
          // Email, calendar and document sources sync through the ingestion stage above.
          if (PIPELINE_SOURCE_KEYS.has(connector.key)) continue;
          const sample = (source.config as { mode?: string } | null)?.mode === "sample";
          const res = sample
            ? { key: connector.key, status: "ok" as const, items: 0, message: "Sample data source" }
            : await connector.sync(ctx, source.id);
          sourceResults.push(res);
          if (res.status !== "skipped") {
            const indexed = await tx.brainSignal.count({ where: { sourceId: source.id } });
            await tx.brainSource.update({
              where: { id: source.id },
              data: { lastSyncAt: now, itemsIndexed: connector.key === "workspace" ? undefined : indexed, error: null },
            });
          }
        }
        for (const run of ingest?.runs ?? []) {
          const conn = run.connectionId ? await tx.sourceConnection.findUnique({ where: { id: run.connectionId }, select: { label: true } }) : null;
          sourceResults.push({
            key: conn?.label ?? "connection",
            status: run.status === "FAILED" ? "error" : "ok",
            items: run.created + run.updated,
            message: run.error ?? undefined,
          });
        }
        ctx.log("sync", `${sourceResults.filter((r) => r.status === "ok").length}/${sourceResults.length} sources synced`);

        // 2. Understand signals
        const signalStage = await analyzeSignals(ctx);

        // 6a. Prioritize before analysis so delegation advice is current.
        const tasksUpdated = await rescoreTasks(tx, { today: ctx.today, weights: ctx.weights, ceoPersonId: ctx.ceoPersonId, now });
        ctx.log("prioritize", `${tasksUpdated} open tasks rescored`);

        // 3. Analyze workspace
        const ms = await analyzeMilestones(ctx);
        const drafts: InsightDraft[] = [
          ...signalStage.drafts,
          ...(await analyzeExecution(ctx)),
          ...ms.drafts,
          ...(await analyzeGoals(ctx)),
          ...(await analyzeDecisions(ctx)),
          ...(await analyzeDelegations(ctx)),
          ...(await analyzeDeals(ctx)),
          ...(await analyzeInvestors(ctx)),
          ...(await analyzeMeetings(ctx)),
          ...(await analyzeAttention(ctx)),
          ...(await analyzeMetrics(ctx)),
        ];

        // 4. Persist
        const { created, inboxCreated } = await persistInsights(ctx, drafts);
        // Insights written by the ingestion pipeline since the last refresh
        // (changes, commitments, risks…) belong to this brief too.
        const ingested = await tx.brainInsight.findMany({
          where: { refreshId: null, sourceItemId: { not: null }, createdAt: { gt: since, lte: new Date(now.getTime() + 60_000) }, status: { not: "DISMISSED" } },
        });
        if (ingested.length) {
          await tx.brainInsight.updateMany({ where: { id: { in: ingested.map((i) => i.id) } }, data: { refreshId: refresh.id } });
          created.push(...ingested);
        }
        ctx.log("persist", `${drafts.length} insights evaluated, ${created.length} new, ${inboxCreated} inbox items filed`);

        // 5. Reconcile
        const reconciled = await reconcileInbox(ctx);
        ctx.log("reconcile", `${reconciled} inbox items auto-resolved or woken from snooze`);

        // 6b. Top 5 + derived metric snapshots
        const top = await recommendTopFive(tx, { today: ctx.today, ceoPersonId: ctx.ceoPersonId });
        await snapshotDerivedMetrics(tx, ctx.today);
        const goalsMoved = await syncGoalProgressFromMetrics(tx, ctx.today);
        ctx.log("prioritize", `Top 5 recommended; ${goalsMoved} measured goal${goalsMoved === 1 ? "" : "s"} updated from the scoreboard`);

        // 7. Brief
        const stats = {
          newInsights: created.length,
          requiresCeo: created.filter((c) => c.requiresCeo).length,
          signalsProcessed: signalStage.processed,
          tasksCreated: signalStage.tasksCreated,
          tasksUpdated,
          milestonesChanged: ms.changed,
          inboxCreated,
        };
        const brief = await composeBrief(ctx, { newInsights: created, stats, topPriorityTaskIds: top });
        ctx.log("brief", "Daily Intelligence Brief composed");

        // 8. Record
        const failedSources = sourceResults.filter((r) => r.status === "error");
        await tx.brainRefresh.update({
          where: { id: refresh.id },
          data: {
            status: failedSources.length ? "PARTIAL" : "SUCCEEDED",
            completedAt: new Date(now.getTime() + (Date.now() - started)),
            durationMs: Date.now() - started,
            signalsScanned: signalStage.processed,
            insightsCreated: created.length,
            tasksCreated: signalStage.tasksCreated,
            tasksUpdated,
            milestonesChanged: ms.changed,
            inboxCreated,
            sourceResults: sourceResults as unknown as Prisma.InputJsonValue,
            log: log as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.activity.create({
          data: {
            type: "BRAIN_REFRESH",
            summary: `Daily Brain Refresh: ${created.length} new insights, ${inboxCreated} items for the CEO inbox`,
            actor: "CytoHub Brain",
            metadata: stats,
            createdAt: now,
          },
        });
        return {
          briefId: brief.id,
          created: created.length,
          inboxCreated,
          tasksCreated: signalStage.tasksCreated,
          partial: failedSources.length > 0,
        };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    // Best-effort narrative upgrade outside the transaction.
    await enhanceBriefWithClaude(db, result.briefId).catch((e) => console.error("[brain] brief narrative failed", e));

    return {
      refreshId: refresh.id,
      status: result.partial ? "PARTIAL" : "SUCCEEDED",
      insightsCreated: result.created,
      inboxCreated: result.inboxCreated,
      tasksCreated: result.tasksCreated,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.brainRefresh.update({
      where: { id: refresh.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        durationMs: Date.now() - started,
        error: message,
        log: log as unknown as Prisma.InputJsonValue,
      },
    });
    console.error("[brain] refresh failed", error);
    return { refreshId: refresh.id, status: "FAILED", insightsCreated: 0, inboxCreated: 0, tasksCreated: 0, durationMs: Date.now() - started, error: message };
  }
}

async function persistInsights(ctx: BrainContext, drafts: InsightDraft[]) {
  const created: BrainInsight[] = [];
  let inboxCreated = 0;
  const seen = new Set<string>();

  for (const d of drafts) {
    if (seen.has(d.fingerprint)) continue;
    seen.add(d.fingerprint);

    const data = {
      type: d.type,
      title: d.title,
      summary: d.summary ?? null,
      importance: Math.max(1, Math.min(5, Math.round(d.importance))),
      requiresCeo: d.requiresCeo ?? false,
      recommendation: d.recommendation ?? null,
      personId: d.personId ?? null,
      companyId: d.companyId ?? null,
      goalId: d.goalId ?? null,
      milestoneId: d.milestoneId ?? null,
      taskId: d.taskId ?? null,
      decisionId: d.decisionId ?? null,
      dealId: d.dealId ?? null,
    };
    const existing = await ctx.tx.brainInsight.findUnique({ where: { fingerprint: d.fingerprint } });
    let insight: BrainInsight;
    if (existing) {
      insight = await ctx.tx.brainInsight.update({ where: { id: existing.id }, data: { ...data, updatedAt: ctx.now } });
    } else {
      insight = await ctx.tx.brainInsight.create({
        data: {
          ...data,
          fingerprint: d.fingerprint,
          refreshId: ctx.refreshId,
          signalId: d.signalId ?? null,
          occurredAt: d.occurredAt ?? ctx.now,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        },
      });
      created.push(insight);
    }

    if (d.inbox && insight.status !== "DISMISSED") {
      const fingerprint = `inbox:${d.fingerprint}`;
      const exists =
        (await ctx.tx.inboxItem.findUnique({ where: { fingerprint }, select: { id: true } })) ??
        (await findOpenItemForRecord(ctx.tx, { decisionId: d.decisionId, taskId: d.taskId, dealId: d.dealId }));
      if (!exists) {
        await ctx.tx.inboxItem.create({
          data: {
            type: d.inbox.type,
            title: d.title,
            summary: d.summary ?? null,
            whyCeo: d.inbox.whyCeo,
            recommendedAction: d.inbox.recommendedAction,
            urgency: d.inbox.urgency,
            dueDate: d.inbox.dueDate ?? null,
            source: d.signalId ? "BRAIN" : "BRAIN",
            fingerprint,
            insightId: insight.id,
            personId: d.personId ?? null,
            companyId: d.companyId ?? null,
            taskId: d.taskId ?? null,
            decisionId: d.decisionId ?? null,
            goalId: d.goalId ?? null,
            dealId: d.dealId ?? null,
            createdAt: ctx.now,
          },
        });
        inboxCreated++;
      }
    }
  }
  return { created, inboxCreated };
}

async function reconcileInbox(ctx: BrainContext): Promise<number> {
  const woke = await ctx.tx.inboxItem.updateMany({
    where: { status: "SNOOZED", snoozedUntil: { lte: ctx.now } },
    data: { status: "OPEN", snoozedUntil: null },
  });
  const decided = await ctx.tx.inboxItem.updateMany({
    where: { status: { in: ["OPEN", "SNOOZED"] }, decision: { status: "DECIDED" } },
    data: { status: "DONE", resolvedAt: ctx.now, resolution: "Resolved automatically: decision recorded." },
  });
  const done = await ctx.tx.inboxItem.updateMany({
    where: { status: { in: ["OPEN", "SNOOZED"] }, type: "DEADLINE_RISK", task: { status: { in: ["DONE", "CANCELLED"] } } },
    data: { status: "DONE", resolvedAt: ctx.now, resolution: "Resolved automatically: task closed." },
  });
  // Insights older than two weeks that were never acted on fade out of view.
  await ctx.tx.brainInsight.updateMany({
    where: { status: "NEW", createdAt: { lt: addDays(ctx.today, -14) } },
    data: { status: "ACKNOWLEDGED" },
  });
  return woke.count + decided.count + done.count;
}
