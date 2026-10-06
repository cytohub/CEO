import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import type { ScoreBreakdown } from "@/server/brain/scoring";
import { getCeoContext } from "@/server/context";

export const taskRowInclude = {
  owner: { select: { id: true, name: true, isCeo: true } },
  goal: { select: { id: true, title: true } },
  milestone: { select: { id: true, title: true, dueDate: true } },
  pillar: { select: { id: true, name: true, color: true } },
  company: { select: { id: true, name: true } },
  suggestedDelegate: { select: { id: true, name: true } },
  delegation: { select: { id: true, status: true, dueDate: true, lastUpdateAt: true, delegate: { select: { id: true, name: true } } } },
  _count: { select: { notes: true, blocks: true, dependsOn: true } },
} satisfies Prisma.TaskInclude;

export type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskRowInclude }>;

export const TASK_VIEWS = ["today", "upcoming", "overdue", "waiting", "delegated", "someday", "completed", "all"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export async function getTaskView(view: TaskView, scope: "mine" | "everyone" = "mine") {
  const ceo = await getCeoContext();
  const mine: Prisma.TaskWhereInput = scope === "mine" ? { OR: [{ ownerId: ceo.personId }, { ownerId: null }] } : {};
  const open = { status: { in: OPEN_TASK_STATUSES } } satisfies Prisma.TaskWhereInput;

  const plan = await db.dayPlan.findUnique({ where: { date: ceo.today }, include: { priorities: { select: { taskId: true } } } });
  const top5 = plan?.priorities.map((p) => p.taskId) ?? [];

  let where: Prisma.TaskWhereInput;
  let orderBy: Prisma.TaskOrderByWithRelationInput[] = [{ priorityScore: "desc" }, { dueDate: "asc" }];
  switch (view) {
    case "today":
      where = { ...open, ...mine, OR: [{ dueDate: ceo.today }, { id: { in: top5 } }], delegation: { is: null } };
      break;
    case "upcoming":
      where = { ...open, ...mine, dueDate: { gt: ceo.today, lte: addDays(ceo.today, 30) }, delegation: { is: null } };
      orderBy = [{ dueDate: "asc" }, { priorityScore: "desc" }];
      break;
    case "overdue":
      where = { ...open, ...mine, dueDate: { lt: ceo.today } };
      orderBy = [{ dueDate: "asc" }];
      break;
    case "waiting":
      where = { ...mine, status: { in: ["WAITING", "BLOCKED"] } };
      break;
    case "delegated":
      where = { delegation: { is: { status: { in: ["ACTIVE", "NEEDS_FOLLOW_UP"] } } } };
      orderBy = [{ dueDate: "asc" }];
      break;
    case "someday":
      where = { ...mine, status: "SOMEDAY" };
      break;
    case "completed":
      where = { ...mine, status: "DONE", completedAt: { gte: addDays(ceo.today, -30) } };
      orderBy = [{ completedAt: "desc" }];
      break;
    default:
      where = { ...open, ...mine };
  }
  const tasks = await db.task.findMany({ where, include: taskRowInclude, orderBy, take: 300 });
  return { tasks, top5, today: ceo.today, ceoPersonId: ceo.personId };
}

export async function getTaskViewCounts() {
  const ceo = await getCeoContext();
  const mine: Prisma.TaskWhereInput = { OR: [{ ownerId: ceo.personId }, { ownerId: null }] };
  const open = { status: { in: OPEN_TASK_STATUSES } } satisfies Prisma.TaskWhereInput;
  const plan = await db.dayPlan.findUnique({ where: { date: ceo.today }, include: { priorities: { select: { taskId: true } } } });
  const top5 = plan?.priorities.map((p) => p.taskId) ?? [];
  const [today, upcoming, overdue, waiting, delegated, someday, completed] = await Promise.all([
    db.task.count({ where: { ...open, ...mine, OR: [{ dueDate: ceo.today }, { id: { in: top5 } }], delegation: { is: null } } }),
    db.task.count({ where: { ...open, ...mine, dueDate: { gt: ceo.today, lte: addDays(ceo.today, 30) }, delegation: { is: null } } }),
    db.task.count({ where: { ...open, ...mine, dueDate: { lt: ceo.today } } }),
    db.task.count({ where: { ...mine, status: { in: ["WAITING", "BLOCKED"] } } }),
    db.task.count({ where: { delegation: { is: { status: { in: ["ACTIVE", "NEEDS_FOLLOW_UP"] } } } } }),
    db.task.count({ where: { ...mine, status: "SOMEDAY" } }),
    db.task.count({ where: { ...mine, status: "DONE", completedAt: { gte: addDays(ceo.today, -30) } } }),
  ]);
  return { today, upcoming, overdue, waiting, delegated, someday, completed } as Record<Exclude<TaskView, "all">, number>;
}

export const taskDetailInclude = {
  ...taskRowInclude,
  decision: { select: { id: true, title: true, status: true } },
  meeting: { select: { id: true, title: true, startsAt: true } },
  people: { select: { id: true, name: true, title: true, type: true } },
  resources: { select: { id: true, title: true, type: true, url: true } },
  delegation: {
    select: {
      id: true,
      status: true,
      dueDate: true,
      expectations: true,
      delegatedAt: true,
      lastUpdateAt: true,
      lastUpdateNote: true,
      followUpAt: true,
      delegate: { select: { id: true, name: true } },
    },
  },
  notes: { orderBy: { createdAt: "desc" }, select: { id: true, body: true, author: true, createdAt: true } },
  activities: { orderBy: { createdAt: "desc" }, take: 25, select: { id: true, type: true, summary: true, actor: true, createdAt: true } },
  dependsOn: { select: { id: true, title: true, status: true } },
  blocks: { select: { id: true, title: true, status: true } },
  insights: { orderBy: { createdAt: "desc" }, take: 5, select: { id: true, title: true, type: true, createdAt: true } },
} satisfies Prisma.TaskInclude;

export type TaskDetail = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }> & {
  breakdown: ScoreBreakdown | null;
  inTop5: boolean;
};

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const ceo = await getCeoContext();
  const task = await db.task.findUnique({ where: { id: taskId }, include: taskDetailInclude });
  if (!task) return null;
  const inTop5 = Boolean(
    await db.dailyPriority.findFirst({ where: { taskId, dayPlan: { date: ceo.today } }, select: { id: true } }),
  );
  return { ...task, breakdown: (task.scoreBreakdown as unknown as ScoreBreakdown | null) ?? null, inTop5 };
}
