/**
 * Weekly and monthly CEO reviews.
 *
 * Every section is generated from the execution graph for the requested
 * period (tasks, Top 5 history, goals, milestones, decisions, delegation,
 * time allocation, metrics and Brain insights). The CEO adds a reflection and
 * completes the review, which freezes a snapshot of the generated sections.
 *
 * Helpers here (impact scoring, Top 5 outcomes, goal progress history) are
 * shared with the CEO Performance dashboard.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { GoalStatus, GoalType, ReviewType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, dayFromKey, dayKey, dayStartInstant, daysBetween, endOfMonth, formatDay, parseDayInput, startOfMonth, startOfWeek, toDay } from "@/lib/dates";
import { FOCUS_AREAS, OPEN_TASK_STATUSES } from "@/lib/domain";
import { computeAttention, type AttentionSummary } from "@/server/brain/attention";
import { getMetricViews, type MetricView } from "@/server/brain/metrics";
import { scoreTask, type PriorityWeights } from "@/server/brain/scoring";
import { getCeoContext, type CeoContext } from "@/server/context";
import { getPriorityWeights, getThresholds } from "@/server/settings";

// ─── Periods ─────────────────────────────────────────────────────────────────

export interface Period {
  start: Date;
  end: Date;
  /** First instant of the period in the CEO's timezone. */
  fromI: Date;
  /** First instant after the period. */
  toI: Date;
  /** Last calendar day of the period that has happened (≤ today). */
  through: Date;
  isCurrent: boolean;
  isPast: boolean;
}

export function periodOf(start: Date, end: Date, ceo: Pick<CeoContext, "today" | "timezone">): Period {
  return {
    start,
    end,
    fromI: dayStartInstant(start, ceo.timezone),
    toI: dayStartInstant(addDays(end, 1), ceo.timezone),
    through: end < ceo.today ? end : ceo.today,
    isCurrent: start <= ceo.today && ceo.today <= end,
    isPast: end < ceo.today,
  };
}

/** Monday of the requested week (YYYY-MM-DD, any day of the week), clamped to the current week. */
export function resolveWeek(param: string | undefined, today: Date): Date {
  const current = startOfWeek(today);
  const parsed = parseDayInput(param);
  const start = parsed ? startOfWeek(parsed) : current;
  return start > current ? current : start;
}

/** First day of the requested month (YYYY-MM), clamped to the current month. */
export function resolveMonth(param: string | undefined, today: Date): Date {
  const current = startOfMonth(today);
  if (!param || !/^\d{4}-(0[1-9]|1[0-2])$/.test(param)) return current;
  const start = dayFromKey(`${param}-01`);
  return start > current ? current : start;
}

export function monthKey(day: Date): string {
  return dayKey(day).slice(0, 7);
}

export function weekLabel(start: Date, today: Date): string {
  const end = addDays(start, 6);
  const withYear = start.getUTCFullYear() !== today.getUTCFullYear();
  return `Week of ${formatDay(start)} – ${formatDay(end, withYear)}`;
}

// ─── Shared scoring helpers ──────────────────────────────────────────────────

export const HIGH_IMPACT_SCORE = 60;
export const HIGH_IMPACT_STRATEGIC = 4;

export const impactTaskSelect = {
  id: true,
  title: true,
  status: true,
  priority: true,
  focusArea: true,
  dueDate: true,
  completedAt: true,
  hardDeadline: true,
  postponeCount: true,
  priorityScore: true,
  strategicImpact: true,
  revenueImpact: true,
  fundraisingImpact: true,
  customerImpact: true,
  scientificImpact: true,
  riskLevel: true,
  ceoUniqueness: true,
  opportunityCost: true,
  estimatedMinutes: true,
  actualMinutes: true,
  goal: { select: { id: true, title: true } },
} satisfies Prisma.TaskSelect;

type ImpactTask = Prisma.TaskGetPayload<{ select: typeof impactTaskSelect }>;

/**
 * CEO Priority Score of a (completed) task. Done tasks keep their last score;
 * history without one is scored as of the day it was completed.
 */
export function impactScoreOf(t: ImpactTask, weights: PriorityWeights, ceo: Pick<CeoContext, "today" | "timezone">): number {
  if (t.priorityScore > 0) return Math.round(t.priorityScore);
  const asOf = t.completedAt ? toDay(t.completedAt, ceo.timezone) : ceo.today;
  const b = scoreTask({ ...t, status: "TODO", blocksCount: 0, milestone: null, goal: null }, asOf, weights);
  return Math.round(b.score);
}

export function isHighImpact(strategicImpact: number, score: number): boolean {
  return strategicImpact >= HIGH_IMPACT_STRATEGIC || score >= HIGH_IMPACT_SCORE;
}

export interface ScoredTask {
  id: string;
  title: string;
  score: number;
  strategicImpact: number;
  ceoUniqueness: number;
  focusArea: ImpactTask["focusArea"];
  actualMinutes: number | null;
  estimatedMinutes: number | null;
  completedAt: Date | null;
  dueDate: Date | null;
  goal: { id: string; title: string } | null;
  highImpact: boolean;
}

export function toScored(t: ImpactTask, weights: PriorityWeights, ceo: Pick<CeoContext, "today" | "timezone">): ScoredTask {
  const score = impactScoreOf(t, weights, ceo);
  return {
    id: t.id,
    title: t.title,
    score,
    strategicImpact: t.strategicImpact,
    ceoUniqueness: t.ceoUniqueness,
    focusArea: t.focusArea,
    actualMinutes: t.actualMinutes,
    estimatedMinutes: t.estimatedMinutes,
    completedAt: t.completedAt,
    dueDate: t.dueDate,
    goal: t.goal,
    highImpact: isHighImpact(t.strategicImpact, score),
  };
}

/** Share of recommended attention that sits in strategic focus areas (0–100). */
export function recommendedStrategicPct(attention: AttentionSummary): number {
  const total = attention.areas.reduce((s, a) => s + a.recommendedPct, 0);
  if (!total) return 0;
  const strategic = attention.areas.filter((a) => FOCUS_AREAS[a.area].strategic).reduce((s, a) => s + a.recommendedPct, 0);
  return Math.round((strategic / total) * 100);
}

// ─── Top 5 history ───────────────────────────────────────────────────────────

export type Top5State = "done" | "missed" | "pending";

export interface Top5Day {
  date: Date;
  confirmed: boolean;
  total: number;
  done: number;
  missed: number;
  pending: number;
  entries: { taskId: string; title: string; rank: number; score: number; state: Top5State; goalTitle: string | null }[];
}

export interface Top5Outcomes {
  days: Top5Day[];
  total: number;
  done: number;
  missed: number;
  pending: number;
  /** done ÷ (done + missed) — pending priorities are not judged yet. */
  rate: number | null;
}

/**
 * Daily Top 5 outcomes. A priority counts as completed when its task was
 * completed by the end of the following day.
 */
export async function getTop5Outcomes(from: Date, to: Date, ceo: Pick<CeoContext, "timezone" | "now">): Promise<Top5Outcomes> {
  const plans = await db.dayPlan.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
    include: {
      priorities: {
        orderBy: { rank: "asc" },
        include: { task: { select: { id: true, title: true, completedAt: true, goal: { select: { title: true } } } } },
      },
    },
  });
  const days: Top5Day[] = plans
    .filter((p) => p.priorities.length > 0)
    .map((p) => {
      const deadline = dayStartInstant(addDays(p.date, 2), ceo.timezone);
      const entries = p.priorities.map((dp) => {
        const c = dp.task.completedAt;
        const state: Top5State = c && c <= deadline ? "done" : deadline <= ceo.now ? "missed" : "pending";
        return { taskId: dp.taskId, title: dp.task.title, rank: dp.rank, score: Math.round(dp.score), state, goalTitle: dp.task.goal?.title ?? null };
      });
      return {
        date: p.date,
        confirmed: Boolean(p.top5ConfirmedAt),
        total: entries.length,
        done: entries.filter((e) => e.state === "done").length,
        missed: entries.filter((e) => e.state === "missed").length,
        pending: entries.filter((e) => e.state === "pending").length,
        entries,
      };
    });
  const done = days.reduce((s, d) => s + d.done, 0);
  const missed = days.reduce((s, d) => s + d.missed, 0);
  const pending = days.reduce((s, d) => s + d.pending, 0);
  return { days, total: done + missed + pending, done, missed, pending, rate: done + missed ? Math.round((done / (done + missed)) * 100) : null };
}

// ─── Goal progress history ───────────────────────────────────────────────────

interface GoalAct {
  goalId: string | null;
  metadata: Prisma.JsonValue;
  createdAt: Date;
}

function metaOf(a: GoalAct): { field?: string; from?: unknown; to?: unknown } {
  return a.metadata && typeof a.metadata === "object" && !Array.isArray(a.metadata) ? (a.metadata as { field?: string; from?: unknown; to?: unknown }) : {};
}

/** Goal progress at an instant, reconstructed from GOAL_UPDATED history (acts sorted ascending). */
export function progressAt(goal: { id: string; progress: number }, acts: GoalAct[], instant: Date): number {
  const next = acts.find((a) => a.goalId === goal.id && a.createdAt >= instant && metaOf(a).field === "progress");
  const from = next ? Number(metaOf(next).from) : NaN;
  return Number.isFinite(from) ? from : goal.progress;
}

export async function goalActsSince(since: Date): Promise<GoalAct[]> {
  return db.activity.findMany({
    where: { type: "GOAL_UPDATED", createdAt: { gte: since }, goalId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { goalId: true, metadata: true, createdAt: true },
  });
}

export interface GoalMove {
  id: string;
  title: string;
  type: GoalType;
  status: GoalStatus;
  confidence: number;
  pillar: { name: string; color: string } | null;
  from: number;
  to: number;
  delta: number;
  statusChanges: { from: GoalStatus; to: GoalStatus; at: Date }[];
  updates: number;
}

const goalMoveSelect = {
  id: true,
  title: true,
  type: true,
  status: true,
  progress: true,
  confidence: true,
  pillar: { select: { name: true, color: true } },
} satisfies Prisma.GoalSelect;

function buildGoalMove(goal: Prisma.GoalGetPayload<{ select: typeof goalMoveSelect }>, acts: GoalAct[], p: Period): GoalMove {
  const inWindow = acts.filter((a) => a.goalId === goal.id && a.createdAt >= p.fromI && a.createdAt < p.toI);
  const from = progressAt(goal, acts, p.fromI);
  const to = progressAt(goal, acts, p.toI);
  return {
    id: goal.id,
    title: goal.title,
    type: goal.type,
    status: goal.status,
    confidence: goal.confidence,
    pillar: goal.pillar,
    from,
    to,
    delta: to - from,
    statusChanges: inWindow
      .filter((a) => metaOf(a).field === "status")
      .map((a) => ({ from: metaOf(a).from as GoalStatus, to: metaOf(a).to as GoalStatus, at: a.createdAt })),
    updates: inWindow.length,
  };
}

const GOAL_TYPE_ORDER: Record<GoalType, number> = { COMPANY: 0, ANNUAL: 1, QUARTERLY: 2, CEO: 3, DEPARTMENT: 4 };

// ─── Weekly review ───────────────────────────────────────────────────────────

const PROMPT_FIELDS = ["whatWorked", "whatDidnt", "learned", "changeNext"] as const;
export type ReflectionField = (typeof PROMPT_FIELDS)[number];
export const REFLECTION_FIELDS = PROMPT_FIELDS;

export interface ReviewRecord {
  id: string | null;
  type: ReviewType;
  periodStart: Date;
  periodEnd: Date;
  reflection: Record<ReflectionField, string | null>;
  completedAt: Date | null;
  snapshot: ReviewSnapshot | null;
  updatedAt: Date | null;
}

async function loadReview(type: ReviewType, start: Date, end: Date): Promise<ReviewRecord> {
  const r = await db.review.findUnique({ where: { type_periodStart: { type, periodStart: start } } });
  return {
    id: r?.id ?? null,
    type,
    periodStart: start,
    periodEnd: r?.periodEnd ?? end,
    reflection: { whatWorked: r?.whatWorked ?? null, whatDidnt: r?.whatDidnt ?? null, learned: r?.learned ?? null, changeNext: r?.changeNext ?? null },
    completedAt: r?.completedAt ?? null,
    snapshot: (r?.snapshot as unknown as ReviewSnapshot | null) ?? null,
    updatedAt: r?.updatedAt ?? null,
  };
}

const ownerSelect = { select: { id: true, name: true, isCeo: true } } as const;

export async function getWeeklyReview(weekStart: Date) {
  const ceo = await getCeoContext();
  const [weights, thresholds] = await Promise.all([getPriorityWeights(db), getThresholds(db)]);
  const p = periodOf(weekStart, addDays(weekStart, 6), ceo);
  const nextWeekStart = addDays(weekStart, 7);
  const nextWeekEnd = addDays(weekStart, 13);
  const overdueTo = addDays(p.through < ceo.today ? addDays(p.through, 1) : ceo.today, -1);

  const [
    review,
    completedRaw,
    milestonesDone,
    goals,
    goalActs,
    dealsWon,
    rescheduledActs,
    dueInWeek,
    postponed,
    blockedTasks,
    blockedMilestones,
    followUps,
    waitingDecisions,
    decided,
    pendingDecisions,
    delegateRecs,
    candidates,
    attention,
    top5,
  ] = await Promise.all([
    loadReview("WEEKLY", p.start, p.end),
    db.task.findMany({
      where: { ownerId: ceo.personId, status: "DONE", completedAt: { gte: p.fromI, lt: p.toI } },
      select: impactTaskSelect,
    }),
    db.milestone.findMany({
      where: { completedAt: { gte: p.fromI, lt: p.toI } },
      orderBy: { completedAt: "asc" },
      select: { id: true, title: true, dueDate: true, completedAt: true, goal: { select: { title: true } } },
    }),
    db.goal.findMany({ select: goalMoveSelect }),
    goalActsSince(p.fromI),
    db.deal.findMany({
      where: { status: "WON", OR: [{ stageChangedAt: { gte: p.fromI, lt: p.toI } }, { stageChangedAt: null, updatedAt: { gte: p.fromI, lt: p.toI } }] },
      select: { id: true, name: true, value: true, type: true, companyId: true },
    }),
    db.activity.findMany({
      where: { type: "TASK_RESCHEDULED", createdAt: { gte: p.fromI, lt: p.toI }, taskId: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { metadata: true, createdAt: true, task: { select: { id: true, title: true, status: true, postponeCount: true, dueDate: true, owner: ownerSelect } } },
    }),
    overdueTo >= p.start
      ? db.task.findMany({
          where: { ownerId: ceo.personId, dueDate: { gte: p.start, lte: overdueTo }, status: { notIn: ["CANCELLED", "SOMEDAY"] } },
          select: { id: true, title: true, status: true, dueDate: true, completedAt: true, postponeCount: true, priorityScore: true },
        })
      : Promise.resolve([]),
    db.task.findMany({
      where: { status: { in: OPEN_TASK_STATUSES }, postponeCount: { gte: 2 } },
      orderBy: [{ postponeCount: "desc" }, { priorityScore: "desc" }],
      take: 6,
      select: { id: true, title: true, postponeCount: true, dueDate: true, owner: ownerSelect },
    }),
    db.task.findMany({
      where: { status: "BLOCKED" },
      orderBy: { priorityScore: "desc" },
      take: 6,
      select: { id: true, title: true, blocker: true, owner: ownerSelect },
    }),
    db.milestone.findMany({
      where: { blocker: { not: null }, status: { notIn: ["COMPLETED", "MISSED"] } },
      orderBy: { dueDate: "asc" },
      take: 6,
      select: { id: true, title: true, blocker: true, dueDate: true, status: true },
    }),
    db.delegation.findMany({
      where: { OR: [{ status: "NEEDS_FOLLOW_UP" }, { status: "ACTIVE", dueDate: { lt: ceo.today } }] },
      orderBy: { dueDate: "asc" },
      take: 6,
      select: { id: true, status: true, dueDate: true, lastUpdateAt: true, delegatedAt: true, task: { select: { id: true, title: true } }, delegate: { select: { name: true } } },
    }),
    db.decision.findMany({
      where: { status: "WAITING_INFO" },
      orderBy: { raisedAt: "asc" },
      take: 6,
      select: { id: true, title: true, waitingOn: true, raisedAt: true },
    }),
    db.decision.findMany({
      where: { decidedAt: { gte: p.fromI, lt: p.toI } },
      orderBy: [{ strategicImpact: "desc" }, { decidedAt: "asc" }],
      select: { id: true, title: true, finalDecision: true, decidedAt: true, raisedAt: true, strategicImpact: true },
    }),
    db.decision.findMany({
      where: { status: { in: ["NEEDED", "WAITING_INFO"] } },
      orderBy: [{ raisedAt: "asc" }],
      select: { id: true, title: true, status: true, raisedAt: true, deadline: true, strategicImpact: true },
    }),
    db.task.findMany({
      where: { ownerId: ceo.personId, status: { in: OPEN_TASK_STATUSES }, delegationRecommended: true, delegation: { is: null } },
      orderBy: { priorityScore: "desc" },
      take: 6,
      select: { id: true, title: true, priorityScore: true, ceoUniqueness: true, estimatedMinutes: true, dueDate: true, suggestedDelegate: { select: { id: true, name: true } } },
    }),
    db.task.findMany({
      where: { ownerId: ceo.personId, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] }, delegation: { is: null }, delegationRecommended: false },
      orderBy: [{ priorityScore: "desc" }, { dueDate: "asc" }],
      take: 40,
      select: {
        id: true,
        title: true,
        status: true,
        priorityScore: true,
        dueDate: true,
        hardDeadline: true,
        aiRecommendation: true,
        goalId: true,
        goal: { select: { id: true, title: true } },
      },
    }),
    computeAttention(db, {
      today: ceo.today,
      windowDays: daysBetween(p.start, p.through) + 1,
      tolerance: thresholds.attentionTolerance,
      from: p.start,
      to: p.through,
    }),
    getTop5Outcomes(p.start, p.end, ceo),
  ]);

  // Wins
  const completed = completedRaw
    .map((t) => toScored(t, weights, ceo))
    .sort((a, b) => Number(b.highImpact) - Number(a.highImpact) || b.score - a.score || b.strategicImpact - a.strategicImpact);
  const goalMoves = goals
    .map((g) => buildGoalMove(g, goalActs, p))
    .filter((m) => m.updates > 0)
    .sort((a, b) => b.delta - a.delta || GOAL_TYPE_ORDER[a.type] - GOAL_TYPE_ORDER[b.type]);
  const goalsUp = goalMoves.filter((m) => m.delta > 0);

  // Misses
  const missedByTask = new Map<string, { taskId: string; title: string; days: number; score: number }>();
  for (const d of top5.days) {
    for (const e of d.entries) {
      if (e.state !== "missed") continue;
      const prev = missedByTask.get(e.taskId);
      missedByTask.set(e.taskId, { taskId: e.taskId, title: e.title, days: (prev?.days ?? 0) + 1, score: Math.max(prev?.score ?? 0, e.score) });
    }
  }
  const missedTop5 = [...missedByTask.values()].sort((a, b) => b.days - a.days || b.score - a.score);
  const becameOverdue = dueInWeek
    .filter((t) => {
      if (!t.dueDate) return false;
      const dueEnd = dayStartInstant(addDays(t.dueDate, 1), ceo.timezone);
      return t.completedAt ? t.completedAt >= dueEnd : t.status !== "DONE";
    })
    .map((t) => ({ ...t, lateDays: t.completedAt ? daysBetween(t.dueDate!, toDay(t.completedAt, ceo.timezone)) : daysBetween(t.dueDate!, ceo.today) }))
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const rescheduledBy = new Map<string, { taskId: string; title: string; owner: { name: string; isCeo: boolean } | null; times: number; from: string | null; to: string | null; postponeCount: number; done: boolean }>();
  for (const a of rescheduledActs) {
    if (!a.task) continue;
    const m = (a.metadata ?? {}) as { from?: string | null; to?: string | null };
    const prev = rescheduledBy.get(a.task.id);
    rescheduledBy.set(a.task.id, {
      taskId: a.task.id,
      title: a.task.title,
      owner: a.task.owner,
      times: (prev?.times ?? 0) + 1,
      from: prev ? prev.from : (m.from ?? null),
      to: m.to ?? prev?.to ?? null,
      postponeCount: a.task.postponeCount,
      done: a.task.status === "DONE",
    });
  }
  const rescheduled = [...rescheduledBy.values()].sort((a, b) => b.times - a.times || b.postponeCount - a.postponeCount);

  // Delegation: time sinks are low-leverage work that still took real CEO time.
  const timeSinks = completed
    .filter((t) => (t.ceoUniqueness <= 2 || t.strategicImpact <= 2) && (t.actualMinutes ?? 0) >= 60)
    .sort((a, b) => (b.actualMinutes ?? 0) - (a.actualMinutes ?? 0));

  // Next week: five highest-impact CEO priorities, due-soon first, ≤2 per goal.
  const ranked = [...candidates].sort((a, b) => {
    const as = a.dueDate && a.dueDate <= nextWeekEnd ? 0 : 1;
    const bs = b.dueDate && b.dueDate <= nextWeekEnd ? 0 : 1;
    return as - bs || b.priorityScore - a.priorityScore;
  });
  const perGoal = new Map<string, number>();
  const nextWeek: typeof candidates = [];
  for (const t of ranked) {
    if (nextWeek.length >= 5) break;
    if (t.goalId && (perGoal.get(t.goalId) ?? 0) >= 2) continue;
    nextWeek.push(t);
    if (t.goalId) perGoal.set(t.goalId, (perGoal.get(t.goalId) ?? 0) + 1);
  }

  const highImpactDone = completed.filter((t) => t.highImpact).length;
  const targetStrategic = recommendedStrategicPct(attention);

  return {
    ceo,
    period: p,
    nextWeekStart,
    nextWeekEnd,
    review,
    stats: {
      top5,
      highImpactDone,
      completedCount: completed.length,
      decisionsMade: decided.length,
      milestonesAchieved: milestonesDone.length,
      strategicPct: attention.totalMinutes ? attention.strategicPct : null,
      targetStrategicPct: targetStrategic,
    },
    wins: { completed, milestones: milestonesDone, goalsUp, dealsWon },
    misses: { missedTop5, becameOverdue, rescheduled },
    progress: goalMoves,
    bottlenecks: { postponed, blockedTasks, blockedMilestones, followUps, waitingDecisions },
    decisions: {
      made: decided,
      pending: pendingDecisions.map((d) => ({ ...d, daysOpen: daysBetween(toDay(d.raisedAt, ceo.timezone), ceo.today) })).sort((a, b) => b.daysOpen - a.daysOpen),
    },
    delegation: { recommendations: delegateRecs, timeSinks, attention },
    nextWeek,
  };
}

export type WeeklyReview = Awaited<ReturnType<typeof getWeeklyReview>>;

// ─── Monthly review ──────────────────────────────────────────────────────────

export interface MetricProgress {
  key: string;
  name: string;
  unit: MetricView["unit"];
  start: number | null;
  end: number | null;
  change: number | null;
  target: number | null;
  series: number[];
}

function metricProgress(view: MetricView | undefined, p: Period, today: Date): MetricProgress | null {
  if (!view) return null;
  const pts = view.series;
  const at = (day: Date) => {
    let v: number | null = null;
    for (const pt of pts) if (pt.date <= day) v = pt.value;
    return v;
  };
  const inMonth = pts.filter((pt) => pt.date >= p.start && pt.date <= p.end);
  const start = at(p.start) ?? inMonth[0]?.value ?? null;
  // Quarter-to-date metrics reset at quarter boundaries: read the last value inside the month.
  const endDay = addDays(p.end, 1) < today ? addDays(p.end, 1) : today;
  const end = view.key.endsWith("_qtd") ? (inMonth.at(-1)?.value ?? start) : at(endDay);
  return {
    key: view.key,
    name: view.name,
    unit: view.unit,
    start,
    end,
    change: start !== null && end !== null ? end - start : null,
    target: view.target,
    series: pts.filter((pt) => pt.date <= endDay).slice(-8).map((pt) => pt.value),
  };
}

export async function getMonthlyReview(monthStart: Date) {
  const ceo = await getCeoContext();
  const [weights, thresholds] = await Promise.all([getPriorityWeights(db), getThresholds(db)]);
  const p = periodOf(monthStart, endOfMonth(monthStart), ceo);
  const nextStart = addDays(p.end, 1);
  const nextEnd = endOfMonth(nextStart);
  const heldUntil = p.toI < ceo.now ? p.toI : ceo.now;
  const missedTo = addDays(p.through < ceo.today ? addDays(p.through, 1) : ceo.today, -1);

  const [
    review,
    goals,
    goalActs,
    milestonesDone,
    milestonesMissed,
    milestonesNext,
    metrics,
    fundraisingDeals,
    investorMeetings,
    dealsWon,
    decided,
    riskInsights,
    opportunities,
    openRisks,
    riskyMilestones,
    completedRaw,
    topTasks,
    attention,
    top5,
  ] = await Promise.all([
    loadReview("MONTHLY", p.start, p.end),
    db.goal.findMany({ where: { type: { not: "DEPARTMENT" } }, select: { ...goalMoveSelect, owner: ownerSelect } }),
    goalActsSince(p.fromI),
    db.milestone.findMany({
      where: { completedAt: { gte: p.fromI, lt: p.toI } },
      orderBy: { completedAt: "asc" },
      select: { id: true, title: true, dueDate: true, completedAt: true, type: true, goal: { select: { title: true } } },
    }),
    missedTo >= p.start
      ? db.milestone.findMany({
          where: { dueDate: { gte: p.start, lte: missedTo }, status: { not: "COMPLETED" } },
          orderBy: { dueDate: "asc" },
          select: { id: true, title: true, dueDate: true, status: true, progress: true, blocker: true },
        })
      : Promise.resolve([]),
    db.milestone.findMany({
      where: { dueDate: { gte: nextStart, lte: nextEnd }, status: { not: "COMPLETED" } },
      orderBy: { dueDate: "asc" },
      select: { id: true, title: true, dueDate: true, status: true, progress: true, owner: ownerSelect },
    }),
    getMetricViews(db, { today: ceo.today, keys: ["arr", "bookings_qtd", "active_customers", "round_committed"] }),
    db.deal.findMany({
      where: { type: "FUNDRAISING" },
      orderBy: [{ stageOrder: "asc" }, { value: "desc" }],
      select: { id: true, name: true, stage: true, stageOrder: true, status: true, value: true, probability: true, companyId: true },
    }),
    db.meeting.findMany({
      where: { type: "INVESTOR", startsAt: { gte: p.fromI, lt: heldUntil } },
      orderBy: { startsAt: "asc" },
      select: { id: true, title: true, startsAt: true, company: { select: { name: true } } },
    }),
    db.deal.findMany({
      where: { status: "WON", OR: [{ stageChangedAt: { gte: p.fromI, lt: p.toI } }, { stageChangedAt: null, updatedAt: { gte: p.fromI, lt: p.toI } }] },
      select: { id: true, name: true, value: true, type: true, companyId: true },
    }),
    db.decision.findMany({
      where: { decidedAt: { gte: p.fromI, lt: p.toI } },
      orderBy: [{ strategicImpact: "desc" }, { decidedAt: "asc" }],
      select: { id: true, title: true, finalDecision: true, decidedAt: true, raisedAt: true, strategicImpact: true, outcome: true },
    }),
    db.brainInsight.findMany({
      where: { type: "RISK", importance: { gte: 4 }, status: { not: "DISMISSED" }, createdAt: { gte: p.fromI, lt: p.toI } },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: { id: true, title: true, summary: true, importance: true, recommendation: true, createdAt: true },
    }),
    db.brainInsight.findMany({
      where: { type: "OPPORTUNITY", status: { not: "DISMISSED" }, createdAt: { gte: p.fromI, lt: p.toI } },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: { id: true, title: true, summary: true, importance: true, recommendation: true, createdAt: true },
    }),
    db.brainInsight.findMany({
      where: { type: "RISK", importance: { lt: 4 }, status: { in: ["NEW", "ACKNOWLEDGED"] }, createdAt: { lt: p.toI } },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: 4,
      select: { id: true, title: true, summary: true, importance: true, recommendation: true, createdAt: true },
    }),
    db.milestone.findMany({
      where: { status: { in: ["AT_RISK", "BLOCKED"] }, dueDate: { gte: ceo.today } },
      orderBy: { dueDate: "asc" },
      take: 4,
      select: { id: true, title: true, dueDate: true, status: true, progress: true, blocker: true },
    }),
    db.task.findMany({
      where: { ownerId: ceo.personId, status: "DONE", completedAt: { gte: p.fromI, lt: p.toI } },
      select: impactTaskSelect,
    }),
    db.task.findMany({
      where: { ownerId: ceo.personId, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] }, delegation: { is: null }, delegationRecommended: false },
      orderBy: [{ priorityScore: "desc" }, { dueDate: "asc" }],
      take: 5,
      select: { id: true, title: true, priorityScore: true, dueDate: true, aiRecommendation: true, goal: { select: { title: true } } },
    }),
    computeAttention(db, {
      today: ceo.today,
      windowDays: daysBetween(p.start, p.through) + 1,
      tolerance: thresholds.attentionTolerance,
      from: p.start,
      to: p.through,
    }),
    getTop5Outcomes(p.start, p.end, ceo),
  ]);

  const goalMoves = goals
    .map((g) => ({ ...buildGoalMove(g, goalActs, p), owner: g.owner }))
    .sort((a, b) => GOAL_TYPE_ORDER[a.type] - GOAL_TYPE_ORDER[b.type] || b.delta - a.delta);
  const activeGoals = goalMoves.filter((g) => g.status !== "PAUSED");
  const offTrack = goalMoves.filter((g) => g.status === "OFF_TRACK" || g.statusChanges.some((c) => c.to === "OFF_TRACK"));
  const atRiskGoals = goalMoves
    .filter((g) => g.status === "AT_RISK" || g.status === "OFF_TRACK")
    .sort((a, b) => (a.status === "OFF_TRACK" ? 0 : 1) - (b.status === "OFF_TRACK" ? 0 : 1) || a.confidence - b.confidence)
    .slice(0, 3);

  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const revenue = (["arr", "bookings_qtd", "active_customers"] as const).map((k) => metricProgress(byKey.get(k), p, ceo.today)).filter((m): m is MetricProgress => m !== null);
  const committed = metricProgress(byKey.get("round_committed"), p, ceo.today);

  const openRaise = fundraisingDeals.filter((d) => d.status === "OPEN");
  const stages = new Map<string, { stage: string; order: number; count: number; value: number; deals: string[] }>();
  for (const d of openRaise) {
    const s = stages.get(d.stage) ?? { stage: d.stage, order: d.stageOrder, count: 0, value: 0, deals: [] };
    s.count += 1;
    s.value += d.value ?? 0;
    s.deals.push(d.name.replace(/\s+—\s+Series B.*$/, ""));
    stages.set(d.stage, s);
  }

  const completed = completedRaw.map((t) => toScored(t, weights, ceo)).sort((a, b) => b.score * b.strategicImpact - a.score * a.strategicImpact);
  const milestonesReached = milestonesDone.map((m) => ({ ...m, lateDays: m.completedAt ? Math.max(0, daysBetween(m.dueDate, toDay(m.completedAt, ceo.timezone))) : 0 }));

  return {
    ceo,
    period: p,
    nextStart,
    nextEnd,
    review,
    stats: {
      milestonesAchieved: milestonesDone.length,
      milestonesMissed: milestonesMissed.length,
      goalsImproved: activeGoals.filter((g) => g.delta > 0).length,
      avgGoalDelta: activeGoals.length ? Math.round((activeGoals.reduce((s, g) => s + g.delta, 0) / activeGoals.length) * 10) / 10 : 0,
      arr: revenue.find((r) => r.key === "arr") ?? null,
      committed,
      investorMeetings: investorMeetings.length,
      decisionsMade: decided.length,
      highImpactDone: completed.filter((t) => t.highImpact).length,
      top5,
      strategicPct: attention.totalMinutes ? attention.strategicPct : null,
      targetStrategicPct: recommendedStrategicPct(attention),
    },
    goals: goalMoves,
    milestones: { completed: milestonesReached, missed: milestonesMissed, next: milestonesNext },
    revenue,
    fundraising: {
      stages: [...stages.values()].sort((a, b) => a.order - b.order),
      committed,
      meetings: investorMeetings,
      won: fundraisingDeals.filter((d) => d.status === "WON"),
      openCount: openRaise.length,
      openValue: openRaise.reduce((s, d) => s + (d.value ?? 0), 0),
    },
    wins: { milestones: milestonesDone, deals: dealsWon, decisions: decided.length, completed: completed.filter((t) => t.highImpact).slice(0, 4) },
    problems: { risks: riskInsights, offTrack, missed: milestonesMissed },
    attention,
    decisions: decided,
    opportunities,
    risks: { insights: openRisks, milestones: riskyMilestones },
    nextMonth: { goals: atRiskGoals, tasks: topTasks, milestones: milestonesNext.slice(0, 5) },
  };
}

export type MonthlyReview = Awaited<ReturnType<typeof getMonthlyReview>>;

// ─── Snapshots ───────────────────────────────────────────────────────────────

export interface SnapshotSection {
  count: number;
  titles: string[];
}

export interface ReviewSnapshot {
  version: 1;
  type: ReviewType;
  period: { start: string; end: string };
  generatedAt: string;
  stats: Record<string, number | string | null>;
  sections: Record<string, SnapshotSection>;
}

const section = (titles: string[], max = 8): SnapshotSection => ({ count: titles.length, titles: titles.slice(0, max) });

export function weeklySnapshot(r: WeeklyReview): ReviewSnapshot {
  return {
    version: 1,
    type: "WEEKLY",
    period: { start: dayKey(r.period.start), end: dayKey(r.period.end) },
    generatedAt: new Date().toISOString(),
    stats: {
      top5Done: r.stats.top5.done,
      top5Judged: r.stats.top5.done + r.stats.top5.missed,
      top5Rate: r.stats.top5.rate,
      highImpactDone: r.stats.highImpactDone,
      decisionsMade: r.stats.decisionsMade,
      milestonesAchieved: r.stats.milestonesAchieved,
      strategicPct: r.stats.strategicPct,
    },
    sections: {
      wins: section([
        ...r.wins.completed.map((t) => `${t.title} (${t.score})`),
        ...r.wins.milestones.map((m) => `Milestone: ${m.title}`),
        ...r.wins.dealsWon.map((d) => `Won: ${d.name}`),
        ...r.wins.goalsUp.map((g) => `${g.title}: ${g.from}% → ${g.to}%`),
      ]),
      misses: section([
        ...r.misses.missedTop5.map((m) => `Top 5 not done: ${m.title}`),
        ...r.misses.becameOverdue.map((t) => `Overdue: ${t.title}`),
        ...r.misses.rescheduled.map((t) => `Rescheduled: ${t.title}`),
      ]),
      strategicProgress: section(r.progress.map((g) => `${g.title}: ${g.from}% → ${g.to}%`)),
      bottlenecks: section([
        ...r.bottlenecks.postponed.map((t) => `Postponed ${t.postponeCount}×: ${t.title}`),
        ...r.bottlenecks.blockedTasks.map((t) => `Blocked: ${t.title}`),
        ...r.bottlenecks.blockedMilestones.map((m) => `Milestone blocked: ${m.title}`),
        ...r.bottlenecks.followUps.map((d) => `Follow up: ${d.task.title}`),
        ...r.bottlenecks.waitingDecisions.map((d) => `Waiting for info: ${d.title}`),
      ]),
      decisionsMade: section(r.decisions.made.map((d) => d.title)),
      decisionsPending: section(r.decisions.pending.map((d) => `${d.title} (${d.daysOpen}d open)`)),
      delegate: section([...r.delegation.recommendations.map((t) => `Delegate: ${t.title}`), ...r.delegation.timeSinks.map((t) => `Time sink: ${t.title}`)]),
      nextWeek: section(r.nextWeek.map((t) => t.title), 5),
    },
  };
}

export function monthlySnapshot(r: MonthlyReview): ReviewSnapshot {
  return {
    version: 1,
    type: "MONTHLY",
    period: { start: dayKey(r.period.start), end: dayKey(r.period.end) },
    generatedAt: new Date().toISOString(),
    stats: {
      milestonesAchieved: r.stats.milestonesAchieved,
      milestonesMissed: r.stats.milestonesMissed,
      goalsImproved: r.stats.goalsImproved,
      avgGoalDelta: r.stats.avgGoalDelta,
      arrStart: r.stats.arr?.start ?? null,
      arrEnd: r.stats.arr?.end ?? null,
      roundCommitted: r.stats.committed?.end ?? null,
      investorMeetings: r.stats.investorMeetings,
      decisionsMade: r.stats.decisionsMade,
      strategicPct: r.stats.strategicPct,
    },
    sections: {
      goals: section(r.goals.filter((g) => g.delta !== 0).map((g) => `${g.title}: ${g.from}% → ${g.to}%`)),
      milestonesCompleted: section(r.milestones.completed.map((m) => m.title)),
      milestonesMissed: section(r.milestones.missed.map((m) => m.title)),
      wins: section([...r.wins.milestones.map((m) => m.title), ...r.wins.deals.map((d) => `Won: ${d.name}`)]),
      problems: section([...r.problems.risks.map((i) => i.title), ...r.problems.offTrack.map((g) => `Off track: ${g.title}`)]),
      decisions: section(r.decisions.map((d) => d.title)),
      opportunities: section(r.opportunities.map((i) => i.title)),
      risks: section([...r.risks.insights.map((i) => i.title), ...r.risks.milestones.map((m) => `At risk: ${m.title}`)]),
      nextMonth: section([...r.nextMonth.goals.map((g) => g.title), ...r.nextMonth.tasks.map((t) => t.title), ...r.nextMonth.milestones.map((m) => m.title)], 12),
    },
  };
}
