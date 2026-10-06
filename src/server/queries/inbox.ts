import type { InboxStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getCeoContext } from "@/server/context";
import { getAccessScope, sourceItemWhere } from "@/server/security/access";
import { getViewer } from "@/server/security/session";

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
        commitment: { select: { id: true, title: true, direction: true, status: true } },
        risk: { select: { id: true, title: true } },
        opportunity: { select: { id: true, title: true } },
        sourceItem: {
          select: {
            id: true,
            kind: true,
            occurredAt: true,
            connection: { select: { provider: true } },
            emailMessage: { select: { fromName: true, fromEmail: true } },
            calendarEvent: { select: { organizerName: true } },
            document: { select: { author: true } },
          },
        },
      },
    }),
    db.inboxItem.groupBy({ by: ["status"], _count: true }),
  ]);
  // Source lines only for sources the viewer may read (ingestion provenance).
  const viewer = await getViewer();
  const sourceIds = items.map((i) => i.sourceItemId).filter((x): x is string => Boolean(x));
  const readable = new Set<string>();
  if (viewer && sourceIds.length) {
    const scope = await getAccessScope(viewer);
    for (const s of await db.sourceItem.findMany({ where: { AND: [{ id: { in: sourceIds } }, sourceItemWhere(scope)] }, select: { id: true } })) readable.add(s.id);
  }
  return {
    items: items.map((i) => {
      const src = i.sourceItem && readable.has(i.sourceItem.id) ? i.sourceItem : null;
      return {
        ...i,
        sourceItem: src,
        source: src
          ? {
              id: src.id,
              kind: src.kind,
              provider: src.connection.provider,
              author: src.emailMessage?.fromName ?? src.emailMessage?.fromEmail ?? src.calendarEvent?.organizerName ?? src.document?.author ?? null,
              occurredAt: src.occurredAt,
            }
          : null,
        sourceHidden: Boolean(i.sourceItemId && !src),
      };
    }),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Partial<Record<InboxStatus, number>>,
    today: ceo.today,
    timezone: ceo.timezone,
  };
}

export type InboxEntry = Awaited<ReturnType<typeof getInbox>>["items"][number];
