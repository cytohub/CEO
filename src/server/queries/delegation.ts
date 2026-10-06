import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { getCeoContext } from "@/server/context";

export async function getDelegationCenter() {
  const ceo = await getCeoContext();
  const [recommendations, delegations, completed, team] = await Promise.all([
    db.task.findMany({
      where: { delegationRecommended: true, status: { in: OPEN_TASK_STATUSES } },
      orderBy: [{ dueDate: "asc" }],
      include: {
        suggestedDelegate: { select: { id: true, name: true, title: true } },
        goal: { select: { id: true, title: true } },
      },
    }),
    db.delegation.findMany({
      where: { status: { in: ["ACTIVE", "NEEDS_FOLLOW_UP"] } },
      orderBy: [{ status: "desc" }, { dueDate: "asc" }],
      include: {
        task: { select: { id: true, title: true, status: true, priority: true, goal: { select: { id: true, title: true } }, estimatedMinutes: true } },
        delegate: { select: { id: true, name: true, title: true } },
      },
    }),
    db.delegation.findMany({
      where: { status: "COMPLETED", completedAt: { gte: addDays(ceo.today, -30) } },
      orderBy: { completedAt: "desc" },
      include: { task: { select: { id: true, title: true, dueDate: true } }, delegate: { select: { name: true } } },
    }),
    db.person.findMany({
      where: { type: "TEAM", isCeo: false },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        title: true,
        _count: { select: { delegationsIn: { where: { status: { in: ["ACTIVE", "NEEDS_FOLLOW_UP"] } } }, ownedTasks: { where: { status: { in: OPEN_TASK_STATUSES } } } } },
      },
    }),
  ]);
  return { recommendations, delegations, completed, team, today: ceo.today, now: ceo.now, timezone: ceo.timezone };
}

export type DelegationCenter = Awaited<ReturnType<typeof getDelegationCenter>>;
