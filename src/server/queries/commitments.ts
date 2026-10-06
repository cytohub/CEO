/**
 * Commitments: what CytoHub owes (outbound), what is owed to it (inbound),
 * and what slipped. "Overdue" is derived (OPEN and due before today).
 * The commitment as written is source content: it is shown only when the
 * viewer can read at least one of its sources (or it has none).
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { sortByUrgency } from "@/components/intelligence/model";
import { getCeoContext } from "@/server/context";
import { emailThreadWhere, getAccessScope } from "@/server/security/access";
import { getFirstExcerpts, getProvenanceCounts, type ProvenanceViewer } from "./provenance";

export const COMMITMENT_TABS = ["owe", "owed", "internal", "overdue", "fulfilled"] as const;
export type CommitmentTab = (typeof COMMITMENT_TABS)[number];

const personSelect = { id: true, name: true, isCeo: true, company: { select: { id: true, name: true } } } as const;

const commitmentInclude = {
  owner: { select: personSelect },
  counterparty: { select: personSelect },
  company: { select: { id: true, name: true } },
  task: { select: { id: true, title: true, status: true } },
  thread: { select: { id: true, subject: true } },
  meeting: { select: { id: true, title: true } },
  goal: { select: { id: true, title: true } },
} satisfies Prisma.CommitmentInclude;

function tabWhere(tab: CommitmentTab, today: Date): Prisma.CommitmentWhereInput {
  switch (tab) {
    case "owe":
      return { direction: "OUTBOUND", status: "OPEN" };
    case "owed":
      return { direction: "INBOUND", status: "OPEN" };
    case "internal":
      return { direction: "INTERNAL", status: "OPEN" };
    case "overdue":
      return { status: "OPEN", dueDate: { lt: today } };
    case "fulfilled":
      return { status: { in: ["FULFILLED", "CANCELLED", "SUPERSEDED"] } };
  }
}

/** The tab a commitment lives in (for ?highlight= deep links). */
export async function tabForCommitment(id: string): Promise<CommitmentTab | null> {
  const ceo = await getCeoContext();
  const c = await db.commitment.findUnique({ where: { id }, select: { status: true, direction: true, dueDate: true } });
  if (!c) return null;
  if (c.status !== "OPEN") return "fulfilled";
  return c.direction === "OUTBOUND" ? "owe" : c.direction === "INBOUND" ? "owed" : "internal";
}

export async function getCommitments(viewer: ProvenanceViewer, opts: { tab: CommitmentTab; companyId?: string | null; q?: string | null }) {
  const ceo = await getCeoContext();
  const scope = await getAccessScope(viewer);
  const filters: Prisma.CommitmentWhereInput[] = [tabWhere(opts.tab, ceo.today)];
  if (opts.companyId) filters.push({ companyId: opts.companyId });
  const q = opts.q?.trim().slice(0, 100);
  if (q) {
    filters.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { company: { name: { contains: q, mode: "insensitive" } } },
        { owner: { name: { contains: q, mode: "insensitive" } } },
        { counterparty: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }

  const [rows, open, overdue, fulfilled30, companies] = await Promise.all([
    db.commitment.findMany({
      where: { AND: filters },
      include: commitmentInclude,
      orderBy: opts.tab === "fulfilled" ? [{ fulfilledAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }] : [{ dueDate: { sort: "asc", nulls: "last" } }, { committedAt: "asc" }],
      take: 300,
    }),
    db.commitment.groupBy({ by: ["direction"], where: { status: "OPEN" }, _count: { _all: true } }),
    db.commitment.groupBy({ by: ["direction"], where: { status: "OPEN", dueDate: { lt: ceo.today } }, _count: { _all: true } }),
    db.commitment.count({ where: { status: "FULFILLED", fulfilledAt: { gte: addDays(ceo.today, -30) } } }),
    db.company.findMany({ where: { commitments: { some: {} } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const ids = rows.map((r) => r.id);
  const threadIds = [...new Set(rows.map((r) => r.threadId).filter((x): x is string => Boolean(x)))];
  const [refCounts, excerpts, readableThreads, closed] = await Promise.all([
    getProvenanceCounts(viewer, "COMMITMENT", ids),
    getFirstExcerpts(viewer, "COMMITMENT", ids),
    threadIds.length ? db.emailThread.findMany({ where: { AND: [{ id: { in: threadIds } }, emailThreadWhere(scope)] }, select: { id: true } }) : Promise.resolve([]),
    opts.tab === "fulfilled" ? Promise.resolve(rows.length) : db.commitment.count({ where: tabWhere("fulfilled", ceo.today) }),
  ]);
  const threadOk = new Set(readableThreads.map((t) => t.id));

  const items = rows.map((c) => {
    const refs = refCounts[c.id] ?? { count: 0, hidden: 0 };
    const textVisible = refs.count > 0 || refs.hidden === 0;
    const other = c.direction === "INBOUND" ? c.owner : c.counterparty;
    return {
      id: c.id,
      direction: c.direction,
      status: c.status,
      title: c.title,
      text: textVisible ? c.text : null,
      excerpt: excerpts[c.id] ?? null,
      dueDate: c.dueDate,
      dueText: textVisible ? c.dueText : null,
      followUpDate: c.followUpDate,
      committedAt: c.committedAt,
      fulfilledAt: c.fulfilledAt,
      resolutionNote: c.resolutionNote,
      confidence: c.confidence,
      confidenceScore: c.confidenceScore,
      owner: c.owner,
      counterparty: c.counterparty,
      other,
      company: c.company ?? other?.company ?? null,
      task: c.task,
      thread: c.thread && threadOk.has(c.thread.id) ? c.thread : null,
      meeting: c.meeting,
      goal: c.goal,
      sources: refs,
    };
  });

  const count = (arr: { direction: string; _count: { _all: number } }[], d?: string) => arr.filter((x) => !d || x.direction === d).reduce((n, x) => n + x._count._all, 0);
  return {
    items: opts.tab === "fulfilled" ? items : sortByUrgency(items),
    counts: {
      owe: count(open, "OUTBOUND"),
      owed: count(open, "INBOUND"),
      internal: count(open, "INTERNAL"),
      overdue: count(overdue),
      oweOverdue: count(overdue, "OUTBOUND"),
      owedOverdue: count(overdue, "INBOUND"),
      fulfilled: closed,
      fulfilled30,
    },
    companies,
    today: ceo.today,
    timezone: ceo.timezone,
  };
}

export type CommitmentRow = Awaited<ReturnType<typeof getCommitments>>["items"][number];

/** Today cockpit: what you owe (overdue first, then due soon) and what is overdue to you. */
export async function getCockpitCommitments() {
  const ceo = await getCeoContext();
  const include = { owner: { select: personSelect }, counterparty: { select: personSelect }, company: { select: { id: true, name: true } } } as const;
  const [owe, owedOverdue, oweTotal, owedOverdueTotal] = await Promise.all([
    db.commitment.findMany({ where: { direction: "OUTBOUND", status: "OPEN" }, include, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { committedAt: "asc" }], take: 20 }),
    db.commitment.findMany({ where: { direction: "INBOUND", status: "OPEN", dueDate: { lt: ceo.today } }, include, orderBy: [{ dueDate: "asc" }], take: 3 }),
    db.commitment.count({ where: { direction: "OUTBOUND", status: "OPEN" } }),
    db.commitment.count({ where: { direction: "INBOUND", status: "OPEN", dueDate: { lt: ceo.today } } }),
  ]);
  const shape = (c: (typeof owe)[number]) => {
    const other = c.direction === "INBOUND" ? c.owner : c.counterparty;
    return { id: c.id, title: c.title, dueDate: c.dueDate, committedAt: c.committedAt, direction: c.direction, other: other ? { name: other.name, isCeo: other.isCeo } : null, company: c.company ?? other?.company ?? null };
  };
  return {
    youOwe: sortByUrgency(owe).slice(0, 5).map(shape),
    youOweTotal: oweTotal,
    owedToYou: owedOverdue.map(shape),
    owedToYouOverdueTotal: owedOverdueTotal,
    today: ceo.today,
  };
}

export type CockpitCommitments = Awaited<ReturnType<typeof getCockpitCommitments>>;
