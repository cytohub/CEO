/**
 * Applies the CEO Priority Score to the task graph and selects the daily Top 5.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Db, Tx } from "@/lib/db";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { scoreTask, type PriorityWeights, type ScoreBreakdown } from "./scoring";

type Client = Db | Tx;

const scoringInclude = {
  goal: { select: { title: true, status: true } },
  milestone: { select: { title: true, dueDate: true, status: true } },
  blocks: { where: { status: { in: OPEN_TASK_STATUSES } }, select: { id: true } },
  delegation: { select: { status: true } },
} satisfies Prisma.TaskInclude;

/** Recompute and persist scores. Pass ids to limit the scope (e.g. after one edit). */
export async function rescoreTasks(
  client: Client,
  opts: { today: Date; weights: PriorityWeights; ceoPersonId: string; now: Date; taskIds?: string[] },
): Promise<number> {
  const tasks = await client.task.findMany({
    where: {
      // Open work is rescored every time; closed work is scored once so history keeps its score.
      OR: [{ status: { in: [...OPEN_TASK_STATUSES, "SOMEDAY"] } }, { scoredAt: null }],
      ...(opts.taskIds ? { id: { in: opts.taskIds } } : {}),
    },
    include: scoringInclude,
  });

  const team = await client.person.findMany({
    where: { type: "TEAM", isCeo: false },
    select: { id: true, expertise: true, _count: { select: { ownedTasks: { where: { status: { in: OPEN_TASK_STATUSES } } } } } },
  });

  for (const t of tasks) {
    const breakdown = scoreTask(
      {
        status: t.status,
        priority: t.priority,
        strategicImpact: t.strategicImpact,
        revenueImpact: t.revenueImpact,
        fundraisingImpact: t.fundraisingImpact,
        customerImpact: t.customerImpact,
        scientificImpact: t.scientificImpact,
        riskLevel: t.riskLevel,
        ceoUniqueness: t.ceoUniqueness,
        opportunityCost: t.opportunityCost,
        dueDate: t.dueDate,
        hardDeadline: t.hardDeadline,
        postponeCount: t.postponeCount,
        blocksCount: t.blocks.length,
        milestone: t.milestone,
        goal: t.goal,
      },
      opts.today,
      opts.weights,
    );

    const ownedByCeo = t.ownerId === opts.ceoPersonId;
    const closed = t.status === "DONE" || t.status === "CANCELLED";
    const shouldDelegate = ownedByCeo && breakdown.delegable && !t.delegation && t.status !== "SOMEDAY" && !closed;
    let suggestedDelegateId: string | null = null;
    if (shouldDelegate) {
      const candidates = team
        .filter((p) => p.expertise.includes(t.focusArea))
        .sort((a, b) => a._count.ownedTasks - b._count.ownedTasks);
      suggestedDelegateId = candidates[0]?.id ?? null;
    }

    await client.task.update({
      where: { id: t.id },
      data: {
        priorityScore: breakdown.score,
        scoreBreakdown: breakdown as unknown as Prisma.InputJsonValue,
        scoredAt: opts.now,
        aiRecommendation: recommendationFor(breakdown, t.status, shouldDelegate),
        delegationRecommended: shouldDelegate,
        suggestedDelegateId,
      },
    });
  }
  return tasks.length;
}

function recommendationFor(b: ScoreBreakdown, status: string, delegate: boolean): string {
  if (delegate) return `Delegate. ${b.rationale}`;
  if (status === "BLOCKED") return `Unblock first. ${b.rationale}`;
  if (b.score >= 70) return `Do personally, today. ${b.rationale}`;
  if (b.score >= 50) return `Schedule this week. ${b.rationale}`;
  return b.rationale;
}

/** Candidates for the CEO's Top 5: open, CEO-owned (or unowned), not delegated. */
export async function rankCeoCandidates(client: Client, ceoPersonId: string, limit = 30) {
  return client.task.findMany({
    where: {
      status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] },
      OR: [{ ownerId: ceoPersonId }, { ownerId: null }],
      delegation: { is: null },
    },
    orderBy: [{ priorityScore: "desc" }, { dueDate: "asc" }],
    take: limit,
    select: { id: true, goalId: true, priorityScore: true, aiRecommendation: true, delegationRecommended: true, scoreBreakdown: true },
  });
}

/**
 * Select five priorities: highest score first, at most two per goal so one
 * initiative can't crowd out the rest of the company, and never a task the
 * Brain recommends delegating.
 */
export function selectTopFive<T extends { id: string; goalId: string | null; delegationRecommended: boolean }>(
  ranked: T[],
  pinned: string[] = [],
): T[] {
  const picked: T[] = [];
  const perGoal = new Map<string, number>();
  const byId = new Map(ranked.map((r) => [r.id, r]));
  for (const id of pinned) {
    const r = byId.get(id);
    if (r && picked.length < 5) {
      picked.push(r);
      if (r.goalId) perGoal.set(r.goalId, (perGoal.get(r.goalId) ?? 0) + 1);
    }
  }
  for (const r of ranked) {
    if (picked.length >= 5) break;
    if (picked.some((p) => p.id === r.id) || r.delegationRecommended) continue;
    if (r.goalId && (perGoal.get(r.goalId) ?? 0) >= 2) continue;
    picked.push(r);
    if (r.goalId) perGoal.set(r.goalId, (perGoal.get(r.goalId) ?? 0) + 1);
  }
  // Backfill if the diversity rule left gaps.
  for (const r of ranked) {
    if (picked.length >= 5) break;
    if (!picked.some((p) => p.id === r.id) && !r.delegationRecommended) picked.push(r);
  }
  return picked;
}

export async function ensureDayPlan(client: Client, day: Date) {
  return client.dayPlan.upsert({ where: { date: day }, create: { date: day }, update: {} });
}

/**
 * Refresh today's Top 5. Once the CEO has confirmed the list, the Brain no
 * longer rewrites it — CEO choices win. CEO-sourced picks are always kept.
 */
export async function recommendTopFive(client: Client, opts: { today: Date; ceoPersonId: string }) {
  const plan = await ensureDayPlan(client, opts.today);
  const existing = await client.dailyPriority.findMany({ where: { dayPlanId: plan.id }, orderBy: { rank: "asc" } });
  if (plan.top5ConfirmedAt) return existing.map((p) => p.taskId);

  const ranked = await rankCeoCandidates(client, opts.ceoPersonId);
  const pinned = existing.filter((p) => p.source === "CEO" || p.pinned).map((p) => p.taskId);
  const top = selectTopFive(ranked, pinned);

  await client.dailyPriority.deleteMany({ where: { dayPlanId: plan.id } });
  await client.dailyPriority.createMany({
    data: top.map((t, i) => {
      const prev = existing.find((e) => e.taskId === t.id);
      return {
        dayPlanId: plan.id,
        taskId: t.id,
        rank: i + 1,
        score: t.priorityScore,
        rationale: t.aiRecommendation,
        source: prev?.source ?? "BRAIN",
        pinned: prev?.pinned ?? false,
      };
    }),
  });
  return top.map((t) => t.id);
}
