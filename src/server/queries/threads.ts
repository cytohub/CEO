/**
 * Email threads with their evolving summary. Lists and details are filtered
 * by the viewer's access scope; individual messages are filtered again (a
 * message can be more sensitive than its thread).
 */
import type { Prisma } from "@/generated/prisma/client";
import type { CeoCategory, Relevance, ThreadStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { RELEVANCE } from "@/lib/intelligence";
import { getCeoContext } from "@/server/context";
import { documentWhere, emailThreadWhere, getAccessScope, sourceItemWhere } from "@/server/security/access";
import { getDerivedIntelligence, type ProvenanceViewer } from "./provenance";

export interface ThreadFilters {
  status?: ThreadStatus | null;
  category?: CeoCategory | null;
  /** Minimum relevance; null hides only noise. "NOISE" shows everything. */
  minRelevance?: Relevance | null;
  companyId?: string | null;
  q?: string | null;
}

export async function getThreads(viewer: ProvenanceViewer, f: ThreadFilters) {
  const ceo = await getCeoContext();
  const scope = await getAccessScope(viewer);
  const and: Prisma.EmailThreadWhereInput[] = [emailThreadWhere(scope)];
  if (f.status) and.push({ status: f.status });
  if (f.category) and.push({ category: f.category });
  if (f.companyId) and.push({ companyId: f.companyId });
  if (f.minRelevance && f.minRelevance !== "NOISE") {
    const min = RELEVANCE[f.minRelevance].rank;
    and.push({ relevance: { in: (Object.keys(RELEVANCE) as Relevance[]).filter((r) => RELEVANCE[r].rank >= min) } });
  } else if (!f.minRelevance) {
    and.push({ OR: [{ relevance: null }, { relevance: { not: "NOISE" } }] });
  }
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    and.push({
      OR: [
        { subject: { contains: q, mode: "insensitive" } },
        { summary: { contains: q, mode: "insensitive" } },
        { company: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const [threads, companies, statusCounts, ceoUser] = await Promise.all([
    db.emailThread.findMany({
      where: { AND: and },
      orderBy: { lastMessageAt: "desc" },
      take: 200,
      select: {
        id: true,
        subject: true,
        status: true,
        relevance: true,
        category: true,
        sensitivity: true,
        participants: true,
        lastMessageAt: true,
        messageCount: true,
        summary: true,
        awaitingSince: true,
        company: { select: { id: true, name: true } },
        _count: { select: { commitments: true } },
      },
    }),
    db.company.findMany({ where: { threads: { some: emailThreadWhere(scope) } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.emailThread.groupBy({ by: ["status"], where: { AND: [emailThreadWhere(scope), { OR: [{ relevance: null }, { relevance: { not: "NOISE" } }] }] }, _count: { _all: true } }),
    db.user.findUnique({ where: { id: ceo.userId }, select: { email: true } }),
  ]);
  return {
    threads,
    ceoEmail: ceoUser?.email.toLowerCase() ?? null,
    companies,
    awaitingYou: statusCounts.find((s) => s.status === "AWAITING_CEO")?._count._all ?? 0,
    timezone: ceo.timezone,
  };
}

export type ThreadRow = Awaited<ReturnType<typeof getThreads>>["threads"][number];

export async function getThreadDetail(viewer: ProvenanceViewer, id: string) {
  const ceo = await getCeoContext();
  const scope = await getAccessScope(viewer);
  const thread = await db.emailThread.findFirst({
    where: { AND: [{ id }, emailThreadWhere(scope)] },
    include: {
      connection: { select: { provider: true, label: true } },
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, name: true, stage: true, companyId: true } },
      commitments: {
        orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
        include: { owner: { select: { id: true, name: true, isCeo: true } }, counterparty: { select: { id: true, name: true, isCeo: true } } },
      },
    },
  });
  if (!thread) return null;
  const [messages, totalMessages, ceoUser] = await Promise.all([
    db.emailMessage.findMany({
      where: { threadId: id, sourceItem: sourceItemWhere(scope) },
      orderBy: { sentAt: "asc" },
      include: {
        sourceItem: { select: { id: true, text: true, snippet: true, contentPurgedAt: true, externalUrl: true, attention: true, relevance: true } },
        attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true, documentId: true } },
      },
    }),
    db.emailMessage.count({ where: { threadId: id } }),
    db.user.findUnique({ where: { id: ceo.userId }, select: { email: true } }),
  ]);
  const docIds = messages.flatMap((m) => m.attachments.map((a) => a.documentId)).filter((x): x is string => Boolean(x));
  const [readableDocs, derived] = await Promise.all([
    docIds.length ? db.document.findMany({ where: { AND: [{ id: { in: docIds } }, documentWhere(scope)] }, select: { id: true } }) : Promise.resolve([]),
    getDerivedIntelligence(
      viewer,
      messages.map((m) => m.sourceItem.id),
    ),
  ]);
  const docOk = new Set(readableDocs.map((d) => d.id));
  return {
    thread,
    messages: messages.map((m) => ({ ...m, attachments: m.attachments.map((a) => ({ ...a, documentId: a.documentId && docOk.has(a.documentId) ? a.documentId : null })) })),
    hiddenMessages: Math.max(0, totalMessages - messages.length),
    derived: { ...derived, records: derived.records.filter((r) => !(r.type === "EMAIL_THREAD" && r.id === id)) },
    ceoEmail: ceoUser?.email.toLowerCase() ?? null,
    timezone: ceo.timezone,
    today: ceo.today,
  };
}

export type ThreadDetail = NonNullable<Awaited<ReturnType<typeof getThreadDetail>>>;
