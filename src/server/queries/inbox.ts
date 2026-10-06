import type { InboxStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getCeoContext } from "@/server/context";

export async function getInbox(status: InboxStatus) {
  const ceo = await getCeoContext();
  const [items, counts] = await Promise.all([
    db.inboxItem.findMany({
      where: { status },
      orderBy: status === "OPEN" ? [{ urgency: "desc" }, { createdAt: "desc" }] : [{ resolvedAt: "desc" }, { updatedAt: "desc" }],
      take: 200,
      include: {
        decision: { select: { id: true, title: true } },
        task: { select: { id: true, title: true } },
        goal: { select: { id: true, title: true } },
        company: { select: { id: true, name: true } },
        person: { select: { id: true, name: true, title: true } },
        deal: { select: { id: true, name: true, stage: true } },
        insight: { select: { id: true, signal: { select: { title: true, occurredAt: true, source: { select: { name: true } } } } } },
      },
    }),
    db.inboxItem.groupBy({ by: ["status"], _count: true }),
  ]);
  return {
    items,
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<InboxStatus, number>>,
    today: ceo.today,
    timezone: ceo.timezone,
  };
}

export type InboxEntry = Awaited<ReturnType<typeof getInbox>>["items"][number];
