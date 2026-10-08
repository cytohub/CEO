/**
 * Scoreboard metrics. Values come from MetricValue (manual entry or a
 * connector) or are derived live from the workspace (pipeline, fundraising,
 * runway). Nothing here hardcodes financial assumptions — derived values are
 * computed only from recorded data.
 */
import type { Metric, MetricValue } from "@/generated/prisma/client";
import type { Db, Tx } from "@/lib/db";

type Client = Db | Tx;

export interface MetricPoint {
  date: Date;
  value: number;
}

export interface MetricView {
  id: string;
  key: string;
  name: string;
  category: Metric["category"];
  unit: Metric["unit"];
  direction: Metric["direction"];
  description: string | null;
  target: number | null;
  targetDate: Date | null;
  sourceKey: string;
  derived: boolean;
  current: number | null;
  previous: number | null;
  /** Change vs previous point, as a fraction (0.12 = +12%). */
  change: number | null;
  /** Progress toward target (0–100) when a target exists. */
  targetProgress: number | null;
  series: MetricPoint[];
  updatedAt: Date | null;
  pillarId: string | null;
  goalId: string | null;
}

export const DERIVED_METRICS: Record<string, { label: string; description: string }> = {
  "derived:pipeline.weighted": { label: "Weighted sales pipeline", description: "Σ open sales deal value × probability" },
  "derived:pipeline.total": { label: "Open sales pipeline", description: "Σ open sales deal value" },
  "derived:pipeline.count": { label: "Open pharma opportunities", description: "Count of open sales deals" },
  "derived:fundraising.committed": { label: "Round committed", description: "Σ fundraising deals won or ≥90% probability" },
  "derived:fundraising.weighted": { label: "Weighted investor pipeline", description: "Σ open fundraising value × probability" },
  "derived:fundraising.active": { label: "Active investor conversations", description: "Count of open fundraising deals" },
  "derived:cash.runway": { label: "Runway", description: "Latest cash on hand ÷ average monthly net burn over the last 3 recorded months" },
};

async function deriveValue(client: Client, sourceKey: string): Promise<number | null> {
  switch (sourceKey) {
    case "derived:pipeline.weighted":
    case "derived:pipeline.total":
    case "derived:pipeline.count": {
      const deals = await client.deal.findMany({ where: { type: "SALES", status: "OPEN" }, select: { value: true, probability: true } });
      if (sourceKey.endsWith("count")) return deals.length;
      if (sourceKey.endsWith("total")) return deals.reduce((s, d) => s + (d.value ?? 0), 0);
      return deals.reduce((s, d) => s + ((d.value ?? 0) * d.probability) / 100, 0);
    }
    case "derived:fundraising.committed": {
      const deals = await client.deal.findMany({
        where: { type: "FUNDRAISING", OR: [{ status: "WON" }, { status: "OPEN", probability: { gte: 90 } }] },
        select: { value: true },
      });
      return deals.reduce((s, d) => s + (d.value ?? 0), 0);
    }
    case "derived:fundraising.weighted": {
      const deals = await client.deal.findMany({ where: { type: "FUNDRAISING", status: "OPEN" }, select: { value: true, probability: true } });
      return deals.reduce((s, d) => s + ((d.value ?? 0) * d.probability) / 100, 0);
    }
    case "derived:fundraising.active":
      return client.deal.count({ where: { type: "FUNDRAISING", status: "OPEN" } });
    case "derived:cash.runway": {
      const cash = await client.metricValue.findFirst({ where: { metric: { key: "cash_on_hand" } }, orderBy: { recordedAt: "desc" } });
      // Averaging three months keeps one unusual month (a large customer payment, a round
      // closing) from making burn zero and runway blank.
      const burns = await client.metricValue.findMany({ where: { metric: { key: "net_burn" } }, orderBy: { recordedAt: "desc" }, take: 3, select: { value: true } });
      const burn = burns.length ? burns.reduce((s, b) => s + b.value, 0) / burns.length : 0;
      if (!cash || burn <= 0) return null;
      return Math.round((cash.value / burn) * 10) / 10;
    }
    default:
      return null;
  }
}

export function isDerived(sourceKey: string) {
  return sourceKey.startsWith("derived:");
}

function buildView(metric: Metric & { values: MetricValue[] }, live: number | null, today: Date): MetricView {
  const stored = [...metric.values]
    .sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    .map((v) => ({ date: v.recordedAt, value: v.value }));
  const derived = isDerived(metric.sourceKey);
  // Derived metrics: history is the daily snapshots before today, plus the live value.
  const series = derived && live !== null ? [...stored.filter((p) => p.date < today), { date: today, value: live }] : stored;
  const current = series.at(-1)?.value ?? null;
  const previous = series.at(-2)?.value ?? null;
  const change = current !== null && previous !== null && previous !== 0 ? (current - previous) / Math.abs(previous) : null;
  let targetProgress: number | null = null;
  if (metric.target !== null && current !== null && metric.target !== 0) {
    targetProgress =
      metric.direction === "HIGHER_IS_BETTER"
        ? Math.min(100, Math.max(0, (current / metric.target) * 100))
        : Math.min(100, Math.max(0, (metric.target / Math.max(current, 1e-9)) * 100));
  }
  return {
    id: metric.id,
    key: metric.key,
    name: metric.name,
    category: metric.category,
    unit: metric.unit,
    direction: metric.direction,
    description: metric.description,
    target: metric.target,
    targetDate: metric.targetDate,
    sourceKey: metric.sourceKey,
    derived,
    current,
    previous,
    change,
    targetProgress: targetProgress === null ? null : Math.round(targetProgress),
    series,
    updatedAt: metric.values.length ? metric.values.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).createdAt : null,
    pillarId: metric.pillarId,
    goalId: metric.goalId,
  };
}

export async function getMetricViews(client: Client, opts: { today: Date; keys?: string[] }): Promise<MetricView[]> {
  const metrics = await client.metric.findMany({
    where: opts.keys ? { key: { in: opts.keys } } : undefined,
    include: { values: { orderBy: { recordedAt: "desc" }, take: 24 } },
    orderBy: [{ category: "asc" }, { order: "asc" }],
  });
  const views: MetricView[] = [];
  for (const m of metrics) {
    const live = isDerived(m.sourceKey) ? await deriveValue(client, m.sourceKey) : null;
    views.push(buildView(m, live, opts.today));
  }
  return views;
}

/** Persist today's value for derived metrics so they accumulate history. */
export async function snapshotDerivedMetrics(client: Client, day: Date): Promise<number> {
  const metrics = await client.metric.findMany({ where: { sourceKey: { startsWith: "derived:" } } });
  let n = 0;
  for (const m of metrics) {
    const value = await deriveValue(client, m.sourceKey);
    if (value === null) continue;
    await client.metricValue.upsert({
      where: { metricId_recordedAt: { metricId: m.id, recordedAt: day } },
      create: { metricId: m.id, recordedAt: day, value, source: m.sourceKey },
      update: { value },
    });
    n++;
  }
  return n;
}
