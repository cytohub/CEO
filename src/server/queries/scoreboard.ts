import type { DealType, SourceStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { daysBetween, toDay } from "@/lib/dates";
import { CONNECTOR_DEFINITIONS } from "@/server/brain/connectors";
import { DERIVED_METRICS, getMetricViews, type MetricView } from "@/server/brain/metrics";
import { getCeoContext } from "@/server/context";

export type MetricSourceKind = "manual" | "derived" | "sample" | "connected" | "not_connected" | "unknown";

export interface MetricSource {
  kind: MetricSourceKind;
  /** Short label shown on the tile, e.g. "HubSpot CRM (sample)". */
  label: string;
  /** One-line explanation for tooltips and dialogs. */
  detail: string;
  connectorKey: string | null;
}

export interface ScoreboardMetric extends MetricView {
  source: MetricSource;
  /** Where the most recent stored point came from ("manual" when the CEO overrode a connector). */
  latestPointSource: string | null;
  latestNote: string | null;
  goal: { id: string; title: string } | null;
}

export interface PipelineDeal {
  id: string;
  name: string;
  type: DealType;
  stage: string;
  stageOrder: number;
  value: number | null;
  probability: number;
  weighted: number;
  expectedClose: Date | null;
  lastActivityAt: Date | null;
  daysSinceActivity: number | null;
  nextStep: string | null;
  company: { id: string; name: string } | null;
  owner: { id: string; name: string; isCeo: boolean } | null;
}

export interface ScoreboardSource {
  key: string;
  name: string;
  status: SourceStatus;
  sample: boolean;
}

export interface ScoreboardData {
  today: Date;
  now: Date;
  timezone: string;
  metrics: ScoreboardMetric[];
  deals: PipelineDeal[];
  /** Connectors that feed at least one metric. */
  sources: ScoreboardSource[];
}

function describeSource(sourceKey: string, rows: Map<string, { status: SourceStatus; sample: boolean; name: string }>): MetricSource {
  if (sourceKey.startsWith("derived:")) {
    const meta = DERIVED_METRICS[sourceKey];
    return {
      kind: "derived",
      label: meta ? `Derived: ${meta.description}` : "Derived",
      detail: "Computed live from workspace data each time the page loads; snapshots are kept daily for the trend.",
      connectorKey: null,
    };
  }
  if (sourceKey === "manual") {
    return { kind: "manual", label: "Manual", detail: "Recorded by hand in the command center.", connectorKey: null };
  }
  const def = CONNECTOR_DEFINITIONS.find((c) => c.key === sourceKey);
  const row = rows.get(sourceKey);
  const name = def?.name ?? row?.name ?? sourceKey;
  if (row?.sample) {
    return { kind: "sample", label: `${name} (sample)`, detail: `${name} is connected in sample mode — values are illustrative until live credentials are added.`, connectorKey: sourceKey };
  }
  if (row?.status === "CONNECTED" || row?.status === "SYNCING") {
    return { kind: "connected", label: name, detail: `Synced from ${name}.`, connectorKey: sourceKey };
  }
  if (def || row) {
    return {
      kind: "not_connected",
      label: `${name} (not connected)`,
      detail: `Built to sync from ${name}. Until it's connected, values are recorded by hand.`,
      connectorKey: sourceKey,
    };
  }
  return { kind: "unknown", label: sourceKey, detail: `Source “${sourceKey}”.`, connectorKey: null };
}

export async function getScoreboardData(): Promise<ScoreboardData> {
  const ceo = await getCeoContext();
  const [views, sourceRows, latestPoints, deals] = await Promise.all([
    getMetricViews(db, { today: ceo.today }),
    db.brainSource.findMany({ select: { key: true, name: true, status: true, config: true } }),
    db.metricValue.findMany({
      distinct: ["metricId"],
      orderBy: [{ metricId: "asc" }, { recordedAt: "desc" }],
      select: { metricId: true, source: true, note: true },
    }),
    db.deal.findMany({
      where: { status: "OPEN", type: { in: ["SALES", "FUNDRAISING"] } },
      orderBy: [{ type: "asc" }, { stageOrder: "desc" }, { value: "desc" }],
      include: { company: { select: { id: true, name: true } }, owner: { select: { id: true, name: true, isCeo: true } } },
    }),
  ]);

  const rows = new Map(
    sourceRows.map((s) => [
      s.key,
      { name: s.name, status: s.status, sample: (s.config as { mode?: string } | null)?.mode === "sample" },
    ]),
  );
  const latestByMetric = new Map(latestPoints.map((p) => [p.metricId, p]));
  const goalIds = [...new Set(views.map((v) => v.goalId).filter((x): x is string => Boolean(x)))];
  const goals = goalIds.length ? await db.goal.findMany({ where: { id: { in: goalIds } }, select: { id: true, title: true } }) : [];
  const goalById = new Map(goals.map((g) => [g.id, g]));

  const metrics: ScoreboardMetric[] = views.map((v) => {
    const latest = latestByMetric.get(v.id);
    return {
      ...v,
      source: describeSource(v.sourceKey, rows),
      latestPointSource: v.derived ? null : (latest?.source ?? null),
      latestNote: v.derived ? null : (latest?.note ?? null),
      goal: v.goalId ? (goalById.get(v.goalId) ?? null) : null,
    };
  });

  const usedConnectors = new Set(metrics.map((m) => m.source.connectorKey).filter((k): k is string => Boolean(k)));
  const sources: ScoreboardSource[] = CONNECTOR_DEFINITIONS.filter((c) => usedConnectors.has(c.key)).map((c) => {
    const row = rows.get(c.key);
    return { key: c.key, name: c.name, status: row?.status ?? "NOT_CONNECTED", sample: row?.sample ?? false };
  });

  return {
    today: ceo.today,
    now: ceo.now,
    timezone: ceo.timezone,
    metrics,
    sources,
    deals: deals.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      stage: d.stage,
      stageOrder: d.stageOrder,
      value: d.value,
      probability: d.probability,
      weighted: ((d.value ?? 0) * d.probability) / 100,
      expectedClose: d.expectedClose,
      lastActivityAt: d.lastActivityAt,
      daysSinceActivity: d.lastActivityAt ? Math.max(0, daysBetween(toDay(d.lastActivityAt, ceo.timezone), ceo.today)) : null,
      nextStep: d.nextStep,
      company: d.company,
      owner: d.owner,
    })),
  };
}
