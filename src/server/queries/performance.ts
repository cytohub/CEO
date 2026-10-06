/**
 * Private CEO performance dashboard. Measures impact, not busyness: whether
 * top priorities, commitments, decisions and delegation moved — and whether
 * CEO time went where the company needs it. Never task-count productivity.
 */
import type { GoalStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, dayStartInstant, daysBetween, toDay } from "@/lib/dates";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { computeAttention } from "@/server/brain/attention";
import { getCeoContext } from "@/server/context";
import { getPriorityWeights, getThresholds } from "@/server/settings";
import { getTop5Outcomes, goalActsSince, impactTaskSelect, periodOf, progressAt, recommendedStrategicPct, toScored, type Period } from "./reviews";

export const PERFORMANCE_RANGES = [30, 90] as const;
export type PerformanceRange = (typeof PERFORMANCE_RANGES)[number];

export function resolveRange(param: string | undefined): PerformanceRange {
  return param === "90" ? 90 : 30;
}

export interface Trend {
  value: number | null;
  prev: number | null;
  /** value − prev, or null when either side has no data. */
  delta: number | null;
}

function trend(value: number | null, prev: number | null): Trend {
  return { value, prev, delta: value !== null && prev !== null ? Math.round((value - prev) * 10) / 10 : null };
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

const inPeriod = (d: Date | null | undefined, p: Period) => Boolean(d && d >= p.fromI && d < p.toI);
const dayIn = (d: Date | null | undefined, p: Period) => Boolean(d && d >= p.start && d <= p.end);

export async function getPerformance(range: PerformanceRange) {
  const ceo = await getCeoContext();
  const [weights, thresholds] = await Promise.all([getPriorityWeights(db), getThresholds(db)]);
  const cur = periodOf(addDays(ceo.today, -(range - 1)), ceo.today, ceo);
  const prev = periodOf(addDays(cur.start, -range), addDays(cur.start, -1), ceo);
  const commitmentScope = {
    status: { notIn: ["CANCELLED" as const, "SOMEDAY" as const] },
    AND: [{ OR: [{ ownerId: ceo.personId }, { delegation: { isNot: null } }] }, { OR: [{ hardDeadline: true }, { source: { in: ["EMAIL" as const, "MEETING" as const] } }] }],
  };

  const [
    top5,
    top5Prev,
    completedRaw,
    commitments,
    upcomingCommitments,
    overdueNow,
    delegations,
    ceoCreatedCur,
    ceoCreatedPrev,
    decided,
    pending,
    attention,
    attentionPrev,
    goals,
    goalActs,
    milestones,
  ] = await Promise.all([
    getTop5Outcomes(cur.start, cur.end, ceo),
    getTop5Outcomes(prev.start, prev.end, ceo),
    db.task.findMany({
      where: { ownerId: ceo.personId, status: "DONE", completedAt: { gte: prev.fromI, lt: cur.toI } },
      select: impactTaskSelect,
    }),
    db.task.findMany({
      where: { ...commitmentScope, dueDate: { gte: prev.start, lte: cur.end } },
      select: { id: true, title: true, dueDate: true, completedAt: true, status: true, hardDeadline: true, source: true },
    }),
    db.task.count({ where: { ...commitmentScope, status: { in: OPEN_TASK_STATUSES }, dueDate: { gt: ceo.today, lte: addDays(ceo.today, 14) } } }),
    db.task.findMany({
      where: { ownerId: ceo.personId, status: { in: OPEN_TASK_STATUSES }, dueDate: { lt: ceo.today } },
      orderBy: [{ priorityScore: "desc" }, { dueDate: "asc" }],
      select: { id: true, title: true, dueDate: true, priorityScore: true, postponeCount: true, delegationRecommended: true, goal: { select: { title: true } } },
    }),
    db.delegation.findMany({
      where: { OR: [{ delegatedAt: { gte: prev.fromI, lt: cur.toI } }, { completedAt: { gte: prev.fromI, lt: cur.toI } }] },
      select: { id: true, delegatedAt: true, completedAt: true, dueDate: true, status: true },
    }),
    db.task.count({ where: { ownerId: ceo.personId, createdAt: { gte: cur.fromI, lt: cur.toI } } }),
    db.task.count({ where: { ownerId: ceo.personId, createdAt: { gte: prev.fromI, lt: prev.toI } } }),
    db.decision.findMany({
      where: { decidedAt: { gte: prev.fromI, lt: cur.toI } },
      select: { id: true, title: true, raisedAt: true, decidedAt: true, strategicImpact: true },
    }),
    db.decision.findMany({
      where: { status: { in: ["NEEDED", "WAITING_INFO"] } },
      orderBy: { raisedAt: "asc" },
      select: { id: true, title: true, status: true, raisedAt: true, deadline: true, strategicImpact: true },
    }),
    computeAttention(db, { today: ceo.today, windowDays: range, tolerance: thresholds.attentionTolerance, from: cur.start, to: cur.end }),
    computeAttention(db, { today: ceo.today, windowDays: range, tolerance: thresholds.attentionTolerance, from: prev.start, to: prev.end }),
    db.goal.findMany({ where: { type: { not: "DEPARTMENT" } }, select: { id: true, title: true, status: true, progress: true, confidence: true } }),
    goalActsSince(prev.fromI),
    db.milestone.findMany({
      where: { completedAt: { gte: prev.fromI, lt: cur.toI } },
      orderBy: { completedAt: "desc" },
      select: { id: true, title: true, completedAt: true, dueDate: true },
    }),
  ]);

  // Impact
  const scored = completedRaw.map((t) => toScored(t, weights, ceo));
  const doneCur = scored.filter((t) => inPeriod(t.completedAt, cur));
  const donePrev = scored.filter((t) => inPeriod(t.completedAt, prev));
  const highCur = doneCur.filter((t) => t.highImpact);
  const highPrev = donePrev.filter((t) => t.highImpact);
  const minutes = (ts: typeof scored) => ts.reduce((s, t) => s + (t.actualMinutes ?? 0), 0);
  const highShare = pct(minutes(highCur), minutes(doneCur));
  const highSharePrev = pct(minutes(highPrev), minutes(donePrev));
  const impactList = doneCur
    .map((t) => ({ ...t, impact: Math.round(t.score * t.strategicImpact) }))
    .sort((a, b) => b.impact - a.impact)
    .slice(0, 8);

  // Commitments kept
  const classify = (p: Period) => {
    const rows = commitments.filter((t) => dayIn(t.dueDate, p));
    let kept = 0;
    let late = 0;
    let overdue = 0;
    for (const t of rows) {
      const dueEnd = dayStartInstant(addDays(t.dueDate!, 1), ceo.timezone);
      if (t.completedAt) {
        if (t.completedAt < dueEnd) kept++;
        else late++;
      } else if (t.dueDate! < ceo.today) overdue++;
    }
    return { kept, late, overdue, judged: kept + late + overdue, rate: pct(kept, kept + late + overdue) };
  };
  const commitCur = classify(cur);
  const commitPrev = classify(prev);

  // Delegation
  const delegCur = delegations.filter((d) => inPeriod(d.delegatedAt, cur)).length;
  const delegPrev = delegations.filter((d) => inPeriod(d.delegatedAt, prev)).length;
  const onTime = (p: Period) => {
    const done = delegations.filter((d) => inPeriod(d.completedAt, p));
    const ok = done.filter((d) => !d.dueDate || d.completedAt! < dayStartInstant(addDays(d.dueDate, 1), ceo.timezone)).length;
    return { done: done.length, onTime: ok };
  };
  const delegOnTime = onTime(cur);
  const delegOnTimePrev = onTime(prev);
  const activeDelegations = await db.delegation.count({ where: { status: { in: ["ACTIVE", "NEEDS_FOLLOW_UP"] } } });

  // Decision speed
  const speed = (p: Period) => decided.filter((d) => inPeriod(d.decidedAt, p)).map((d) => (d.decidedAt!.getTime() - d.raisedAt.getTime()) / 86_400_000);
  const speedCur = speed(cur);
  const speedPrev = speed(prev);
  const pendingAged = pending.map((d) => ({ ...d, daysOpen: daysBetween(toDay(d.raisedAt, ceo.timezone), ceo.today) })).sort((a, b) => b.daysOpen - a.daysOpen);

  // Goals
  const active = goals.filter((g) => g.status !== "PAUSED");
  const avgNow = active.length ? Math.round(active.reduce((s, g) => s + g.progress, 0) / active.length) : null;
  const avgStart = active.length ? Math.round(active.reduce((s, g) => s + progressAt(g, goalActs, cur.fromI), 0) / active.length) : null;
  const byStatus = (["ON_TRACK", "AT_RISK", "OFF_TRACK", "COMPLETED", "PAUSED"] as GoalStatus[]).map((s) => ({ status: s, count: goals.filter((g) => g.status === s).length }));
  const msCur = milestones.filter((m) => inPeriod(m.completedAt, cur));
  const msPrev = milestones.filter((m) => inPeriod(m.completedAt, prev));

  return {
    ceo,
    range,
    window: cur,
    previous: prev,
    top5: { ...top5, trend: trend(top5.rate, top5Prev.rate), prevDays: top5Prev.days.length },
    highImpact: {
      count: highCur.length,
      trend: trend(highCur.length, highPrev.length),
      completed: doneCur.length,
      timeShare: highShare,
      timeShareTrend: trend(highShare, highSharePrev),
    },
    commitments: { ...commitCur, trend: trend(commitCur.rate, commitPrev.rate), upcoming: upcomingCommitments },
    overdue: {
      count: overdueNow.length,
      tasks: overdueNow.map((t) => ({ ...t, daysOverdue: daysBetween(t.dueDate!, ceo.today) })),
    },
    delegation: {
      delegated: delegCur,
      ownedNew: ceoCreatedCur,
      rate: pct(delegCur, delegCur + ceoCreatedCur),
      trend: trend(pct(delegCur, delegCur + ceoCreatedCur), pct(delegPrev, delegPrev + ceoCreatedPrev)),
      completed: delegOnTime.done,
      onTime: delegOnTime.onTime,
      onTimeRate: pct(delegOnTime.onTime, delegOnTime.done),
      onTimeTrend: trend(pct(delegOnTime.onTime, delegOnTime.done), pct(delegOnTimePrev.onTime, delegOnTimePrev.done)),
      active: activeDelegations,
    },
    decisions: {
      decided: speedCur.length,
      median: median(speedCur),
      trend: trend(median(speedCur), median(speedPrev)),
      pending: pendingAged,
    },
    attention,
    strategic: {
      pct: attention.totalMinutes ? attention.strategicPct : null,
      target: recommendedStrategicPct(attention),
      trend: trend(attention.totalMinutes ? attention.strategicPct : null, attentionPrev.totalMinutes ? attentionPrev.strategicPct : null),
    },
    goals: { avg: avgNow, avgStart, trend: trend(avgNow, avgStart), byStatus, total: goals.length },
    milestones: { count: msCur.length, trend: trend(msCur.length, msPrev.length), items: msCur },
    impactList,
  };
}

export type PerformanceData = Awaited<ReturnType<typeof getPerformance>>;
