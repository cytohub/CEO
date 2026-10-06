import type { Prisma } from "@/generated/prisma/client";
import type { FocusArea, Priority, TaskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, parseDayInput, startOfMonth, startOfWeek } from "@/lib/dates";
import { getCeoContext } from "@/server/context";
import { taskRowInclude } from "./tasks";

export interface HistoryFilters {
  q?: string;
  from?: string;
  to?: string;
  status?: TaskStatus | "ANY";
  priority?: Priority;
  goal?: string;
  milestone?: string;
  pillar?: string;
  focus?: FocusArea;
  person?: string;
  scope?: "mine" | "everyone";
}

/** Searchable historical task database. Dates filter on completion, falling back to creation. */
export async function searchTaskHistory(f: HistoryFilters) {
  const ceo = await getCeoContext();
  const from = parseDayInput(f.from);
  const to = parseDayInput(f.to);
  const and: Prisma.TaskWhereInput[] = [];
  if (f.scope !== "everyone") and.push({ ownerId: ceo.personId });
  if (f.q?.trim()) {
    const q = f.q.trim();
    and.push({ OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { notesText: { contains: q, mode: "insensitive" } }, { notes: { some: { body: { contains: q, mode: "insensitive" } } } }] });
  }
  if (from || to) {
    const range = { ...(from ? { gte: from } : {}), ...(to ? { lt: addDays(to, 1) } : {}) };
    and.push({ OR: [{ completedAt: range }, { completedAt: null, createdAt: range }] });
  }
  if (f.status && f.status !== "ANY") and.push({ status: f.status });
  if (f.priority) and.push({ priority: f.priority });
  if (f.goal) and.push({ goalId: f.goal });
  if (f.milestone) and.push({ milestoneId: f.milestone });
  if (f.pillar) and.push({ pillarId: f.pillar });
  if (f.focus) and.push({ focusArea: f.focus });
  if (f.person) and.push({ OR: [{ ownerId: f.person }, { people: { some: { id: f.person } } }] });

  const tasks = await db.task.findMany({
    where: { AND: and },
    include: taskRowInclude,
    orderBy: [{ completedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: 400,
  });
  return { tasks, today: ceo.today };
}

/** Answers to the CEO's standing questions about their own history. */
export async function getHistoryInsights() {
  const ceo = await getCeoContext();
  const weekStart = startOfWeek(ceo.today);
  const lastWeekStart = addDays(weekStart, -7);
  const monthStart = startOfMonth(ceo.today);
  const mine = { ownerId: ceo.personId };
  const select = { id: true, title: true, completedAt: true, priorityScore: true, strategicImpact: true, ceoUniqueness: true, actualMinutes: true, estimatedMinutes: true, focusArea: true, postponeCount: true, dueDate: true, status: true, source: true } as const;

  const [lastWeek, thisMonth, postponed, timeSinks, broken, overdueCommitments, priorityChanges, reschedules] = await Promise.all([
    db.task.findMany({ where: { ...mine, status: "DONE", completedAt: { gte: lastWeekStart, lt: weekStart } }, orderBy: { priorityScore: "desc" }, select }),
    db.task.findMany({ where: { ...mine, status: "DONE", completedAt: { gte: monthStart } }, orderBy: { priorityScore: "desc" }, select }),
    db.task.findMany({ where: { ...mine, postponeCount: { gte: 2 } }, orderBy: { postponeCount: "desc" }, take: 8, select }),
    db.task.findMany({ where: { ...mine, status: "DONE", actualMinutes: { gte: 60 }, completedAt: { gte: addDays(ceo.today, -60) } }, select }),
    db.task.findMany({ where: { ...mine, status: "CANCELLED" }, orderBy: { updatedAt: "desc" }, take: 6, select }),
    db.task.findMany({
      where: { ...mine, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED", "WAITING"] }, dueDate: { lt: ceo.today }, OR: [{ hardDeadline: true }, { source: { in: ["EMAIL", "MEETING"] } }, { postponeCount: { gte: 2 } }] },
      orderBy: { dueDate: "asc" },
      take: 6,
      select,
    }),
    db.activity.findMany({ where: { type: "TASK_PRIORITY_CHANGED", createdAt: { gte: addDays(ceo.today, -30) } }, orderBy: { createdAt: "desc" }, take: 8, include: { task: { select: { id: true, title: true } } } }),
    db.activity.groupBy({ by: ["taskId"], where: { type: "TASK_RESCHEDULED", taskId: { not: null } }, _count: true }),
  ]);

  const sinks = timeSinks
    .map((t) => ({ ...t, ratio: t.estimatedMinutes ? (t.actualMinutes ?? 0) / t.estimatedMinutes : 1, lowImpact: t.strategicImpact <= 2 || t.ceoUniqueness <= 2 }))
    .filter((t) => t.ratio >= 2 || t.lowImpact)
    .sort((a, b) => (b.actualMinutes ?? 0) - (a.actualMinutes ?? 0))
    .slice(0, 6);
  const highestImpact = [...thisMonth, ...lastWeek]
    .filter((t, i, arr) => arr.findIndex((x) => x.id === t.id) === i)
    .sort((a, b) => b.priorityScore * b.strategicImpact - a.priorityScore * a.strategicImpact)
    .slice(0, 6);
  const rescheduleCount = new Map(reschedules.map((r) => [r.taskId!, r._count]));

  return {
    weekStart,
    lastWeekStart,
    monthStart,
    lastWeek,
    thisMonth,
    postponed: postponed.map((t) => ({ ...t, reschedules: rescheduleCount.get(t.id) ?? t.postponeCount })),
    sinks,
    broken: [...overdueCommitments, ...broken],
    priorityChanges,
    highestImpact,
    minutesThisMonth: thisMonth.reduce((s, t) => s + (t.actualMinutes ?? 0), 0),
  };
}
