import type { Prisma } from "@/generated/prisma/client";
import type { GoalType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { getMetricViews } from "@/server/brain/metrics";
import { getCeoContext } from "@/server/context";

export const goalListInclude = {
  owner: { select: { id: true, name: true, isCeo: true } },
  pillar: { select: { id: true, name: true, color: true, order: true } },
  parent: { select: { id: true, title: true } },
  milestones: { select: { id: true, status: true } },
  _count: { select: { tasks: { where: { status: { in: OPEN_TASK_STATUSES } } }, children: true, decisions: true } },
} satisfies Prisma.GoalInclude;

export type GoalListItem = Prisma.GoalGetPayload<{ include: typeof goalListInclude }>;

export async function getGoals(type?: GoalType) {
  const ceo = await getCeoContext();
  const [goals, pillars] = await Promise.all([
    db.goal.findMany({ where: type ? { type } : undefined, include: goalListInclude, orderBy: [{ type: "asc" }, { targetDate: "asc" }] }),
    db.strategicPillar.findMany({ orderBy: { order: "asc" } }),
  ]);
  return { goals, pillars, today: ceo.today };
}

export async function getGoalDetail(id: string) {
  const ceo = await getCeoContext();
  const goal = await db.goal.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true, isCeo: true, title: true } },
      pillar: true,
      parent: { select: { id: true, title: true, type: true } },
      children: { include: { owner: { select: { name: true, isCeo: true } } }, orderBy: { targetDate: "asc" } },
      milestones: { include: { owner: { select: { id: true, name: true, isCeo: true } } }, orderBy: { dueDate: "asc" } },
      tasks: {
        orderBy: [{ status: "asc" }, { priorityScore: "desc" }],
        include: { owner: { select: { id: true, name: true, isCeo: true } } },
      },
      decisions: { orderBy: { raisedAt: "desc" }, select: { id: true, title: true, status: true, deadline: true, finalDecision: true } },
      resources: { select: { id: true, title: true, type: true, url: true, summary: true } },
      notes: { orderBy: { createdAt: "desc" }, select: { id: true, body: true, author: true, createdAt: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 30, select: { id: true, type: true, summary: true, actor: true, createdAt: true, metadata: true } },
      insights: { orderBy: { createdAt: "desc" }, take: 6, select: { id: true, title: true, type: true, summary: true, createdAt: true } },
      meetings: { where: { startsAt: { gte: ceo.now } }, orderBy: { startsAt: "asc" }, take: 4, select: { id: true, title: true, startsAt: true } },
    },
  });
  if (!goal) return null;
  const metrics = (await getMetricViews(db, { today: ceo.today })).filter((m) => m.goalId === id);
  // Progress history from activity (oldest first) for the trend line.
  const progressHistory = goal.activities
    .filter((a) => (a.metadata as { field?: string } | null)?.field === "progress")
    .map((a) => ({ at: a.createdAt, to: Number((a.metadata as { to?: number }).to) }))
    .reverse();
  return { goal, metrics, progressHistory, today: ceo.today, timezone: ceo.timezone };
}

export type GoalDetail = NonNullable<Awaited<ReturnType<typeof getGoalDetail>>>;
