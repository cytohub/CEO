import { db } from "@/lib/db";
import { getCeoContext } from "@/server/context";

export async function getDecisionCenter() {
  const ceo = await getCeoContext();
  const decisions = await db.decision.findMany({
    orderBy: [{ deadline: { sort: "asc", nulls: "last" } }, { raisedAt: "desc" }],
    include: {
      goal: { select: { id: true, title: true } },
      pillar: { select: { id: true, name: true, color: true } },
      options: { orderBy: { order: "asc" }, select: { id: true, title: true, recommended: true } },
      _count: { select: { tasks: true, inboxItems: { where: { status: "OPEN" } } } },
    },
  });
  return { decisions, today: ceo.today, timezone: ceo.timezone, now: ceo.now };
}

export type DecisionListItem = Awaited<ReturnType<typeof getDecisionCenter>>["decisions"][number];

export async function getDecisionDetail(id: string) {
  const ceo = await getCeoContext();
  const decision = await db.decision.findUnique({
    where: { id },
    include: {
      goal: { select: { id: true, title: true, status: true, progress: true } },
      pillar: { select: { id: true, name: true, color: true } },
      owner: { select: { id: true, name: true, isCeo: true } },
      options: { orderBy: { order: "asc" } },
      tasks: { orderBy: { priorityScore: "desc" }, select: { id: true, title: true, status: true, dueDate: true, owner: { select: { name: true, isCeo: true } } } },
      companies: { select: { id: true, name: true } },
      resources: { select: { id: true, title: true, type: true, url: true, summary: true } },
      inboxItems: { orderBy: { createdAt: "desc" }, select: { id: true, title: true, status: true, type: true } },
      insights: { orderBy: { createdAt: "desc" }, take: 6, select: { id: true, title: true, summary: true, type: true, createdAt: true } },
      notes: { orderBy: { createdAt: "desc" }, select: { id: true, body: true, createdAt: true, author: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, summary: true, createdAt: true, actor: true } },
    },
  });
  if (!decision) return null;
  return { decision, today: ceo.today, timezone: ceo.timezone, now: ceo.now };
}

export type DecisionDetail = NonNullable<Awaited<ReturnType<typeof getDecisionDetail>>>["decision"];
