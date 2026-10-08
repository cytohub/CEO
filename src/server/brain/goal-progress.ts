/**
 * Goals measured by a scoreboard metric. When a metric with a target is
 * linked to a goal (Scoreboard → Edit target → "Measures goal"), the goal's
 * progress follows the metric's progress toward that target, so a goal like
 * "Reach $6M ARR" moves with QuickBooks, Brex or HubSpot instead of a slider.
 */
import type { Db, Tx } from "@/lib/db";
import { getMetricViews } from "./metrics";

type Client = Db | Tx;

export interface GoalMeasure {
  metricId: string;
  metricName: string;
  /** 0–100, or null while the metric has no value yet. */
  progress: number | null;
}

/** The metric that measures each goal: the first linked metric (scoreboard order) that has a target. */
export async function goalMeasures(client: Client, today: Date, goalIds?: string[]): Promise<Map<string, GoalMeasure>> {
  const linked = await client.metric.findMany({
    where: { goalId: goalIds ? { in: goalIds } : { not: null }, target: { not: null } },
    orderBy: [{ category: "asc" }, { order: "asc" }],
    select: { key: true, goalId: true },
  });
  const out = new Map<string, GoalMeasure>();
  if (!linked.length) return out;
  const views = await getMetricViews(client, { today, keys: linked.map((m) => m.key) });
  for (const m of linked) {
    if (!m.goalId || out.has(m.goalId)) continue;
    const view = views.find((v) => v.key === m.key);
    if (view) out.set(m.goalId, { metricId: view.id, metricName: view.name, progress: view.targetProgress });
  }
  return out;
}

/** Bring measured goals' progress in line with their metrics. Returns how many goals moved. */
export async function syncGoalProgressFromMetrics(client: Client, today: Date): Promise<number> {
  const measures = await goalMeasures(client, today);
  if (!measures.size) return 0;
  const goals = await client.goal.findMany({
    where: { id: { in: [...measures.keys()] }, status: { notIn: ["COMPLETED", "PAUSED"] } },
    select: { id: true, title: true, progress: true },
  });
  let moved = 0;
  for (const g of goals) {
    const m = measures.get(g.id);
    if (!m || m.progress === null) continue;
    const progress = Math.round(Math.max(0, Math.min(100, m.progress)));
    if (progress === g.progress) continue;
    await client.goal.update({ where: { id: g.id }, data: { progress } });
    // Written directly (not via the server-action helpers) so the worker can run this too.
    await client.activity.create({
      data: {
        type: "GOAL_UPDATED",
        summary: `${g.title}: progress ${g.progress}% → ${progress}% (from ${m.metricName})`,
        goalId: g.id,
        actor: "CytoHub Brain",
        metadata: { field: "progress", from: g.progress, to: progress, metricId: m.metricId },
      },
    });
    moved++;
  }
  return moved;
}
