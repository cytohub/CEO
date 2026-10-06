import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { CONNECTOR_DEFINITIONS, credentialEnvFor } from "@/server/brain/connectors";
import type { BriefSections } from "@/server/brain/types";
import { getCeoContext } from "@/server/context";

export async function getBrainOverview() {
  const ceo = await getCeoContext();
  const [refreshes, brief, sources, insightCounts, signalCounts] = await Promise.all([
    db.brainRefresh.findMany({ orderBy: { startedAt: "desc" }, take: 14 }),
    db.dailyBrief.findFirst({ orderBy: { date: "desc" } }),
    db.brainSource.findMany({ include: { _count: { select: { signals: true } } } }),
    db.brainInsight.groupBy({ by: ["status"], _count: true }),
    db.brainSignal.groupBy({ by: ["kind"], _count: true }),
  ]);
  const sourceRows = CONNECTOR_DEFINITIONS.map((def) => {
    const row = sources.find((s) => s.key === def.key);
    const sample = (row?.config as { mode?: string } | null)?.mode === "sample";
    return {
      ...def,
      status: row?.status ?? "NOT_CONNECTED",
      sample,
      lastSyncAt: row?.lastSyncAt ?? null,
      itemsIndexed: row?.itemsIndexed ?? 0,
      signals: row?._count.signals ?? 0,
      env: credentialEnvFor(def.key),
    };
  });
  return {
    ceo,
    refreshes,
    last: refreshes[0] ?? null,
    brief: brief ? { ...brief, payload: brief.sections as unknown as BriefSections } : null,
    sources: sourceRows,
    insightCounts: Object.fromEntries(insightCounts.map((c) => [c.status, c._count])) as Record<string, number>,
    signalCounts,
  };
}

export async function getInsightFeed() {
  const ceo = await getCeoContext();
  const insights = await db.brainInsight.findMany({
    where: { createdAt: { gte: addDays(ceo.today, -30) } },
    orderBy: [{ createdAt: "desc" }, { importance: "desc" }],
    take: 200,
    include: {
      person: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      goal: { select: { id: true, title: true } },
      milestone: { select: { id: true, title: true } },
      task: { select: { id: true, title: true } },
      decision: { select: { id: true, title: true } },
      signal: { select: { source: { select: { name: true } }, kind: true } },
    },
  });
  return { insights, timezone: ceo.timezone };
}

export type FeedInsight = Awaited<ReturnType<typeof getInsightFeed>>["insights"][number];

export async function getRecentSignals() {
  const ceo = await getCeoContext();
  const signals = await db.brainSignal.findMany({
    orderBy: { occurredAt: "desc" },
    take: 60,
    include: {
      source: { select: { name: true, key: true } },
      person: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      insights: { select: { id: true, type: true } },
    },
  });
  return { signals, timezone: ceo.timezone };
}
