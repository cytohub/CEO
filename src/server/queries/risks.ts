/** Risks and opportunities the Brain identified (or the team recorded), with provenance counts. */
import type { Prisma } from "@/generated/prisma/client";
import type { OpportunityStatus, RiskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getCeoContext } from "@/server/context";
import { getFirstExcerpts, getProvenanceCounts, type ProvenanceViewer } from "./provenance";

export type RiskView = "active" | "closed" | "all";

const ACTIVE_RISK: RiskStatus[] = ["OPEN", "MONITORING"];
const ACTIVE_OPP: OpportunityStatus[] = ["OPEN", "PURSUING"];

export async function getRisks(viewer: ProvenanceViewer, opts: { view: RiskView; companyId?: string | null }) {
  const ceo = await getCeoContext();
  const where: Prisma.RiskWhereInput = {
    ...(opts.view === "active" ? { status: { in: ACTIVE_RISK } } : opts.view === "closed" ? { status: { notIn: ACTIVE_RISK } } : {}),
    ...(opts.companyId ? { companyId: opts.companyId } : {}),
  };
  const [rows, counts, highSeverity] = await Promise.all([
    db.risk.findMany({
      where,
      orderBy: [{ severity: "desc" }, { identifiedAt: "desc" }],
      take: 200,
      include: {
        owner: { select: { id: true, name: true, isCeo: true } },
        company: { select: { id: true, name: true } },
        goal: { select: { id: true, title: true } },
        milestone: { select: { id: true, title: true } },
        deal: { select: { id: true, name: true, companyId: true } },
      },
    }),
    db.risk.groupBy({ by: ["status"], _count: { _all: true } }),
    db.risk.count({ where: { status: { in: ACTIVE_RISK }, severity: { gte: 4 } } }),
  ]);
  const ids = rows.map((r) => r.id);
  const [refs, excerpts] = await Promise.all([getProvenanceCounts(viewer, "RISK", ids), getFirstExcerpts(viewer, "RISK", ids)]);
  return {
    items: rows.map((r) => ({ ...r, sources: refs[r.id] ?? { count: 0, hidden: 0 }, excerpt: excerpts[r.id] ?? null })),
    active: counts.filter((c) => ACTIVE_RISK.includes(c.status)).reduce((n, c) => n + c._count._all, 0),
    closed: counts.filter((c) => !ACTIVE_RISK.includes(c.status)).reduce((n, c) => n + c._count._all, 0),
    highSeverity,
    timezone: ceo.timezone,
  };
}

export async function getOpportunities(viewer: ProvenanceViewer, opts: { view: RiskView; companyId?: string | null }) {
  const ceo = await getCeoContext();
  const where: Prisma.OpportunityWhereInput = {
    ...(opts.view === "active" ? { status: { in: ACTIVE_OPP } } : opts.view === "closed" ? { status: { notIn: ACTIVE_OPP } } : {}),
    ...(opts.companyId ? { companyId: opts.companyId } : {}),
  };
  const [rows, counts, pipeline] = await Promise.all([
    db.opportunity.findMany({
      where,
      orderBy: [{ estimatedValue: { sort: "desc", nulls: "last" } }, { identifiedAt: "desc" }],
      take: 200,
      include: {
        company: { select: { id: true, name: true } },
        person: { select: { id: true, name: true } },
        deal: { select: { id: true, name: true, stage: true } },
        goal: { select: { id: true, title: true } },
      },
    }),
    db.opportunity.groupBy({ by: ["status"], _count: { _all: true } }),
    db.opportunity.aggregate({ where: { status: { in: ACTIVE_OPP } }, _sum: { estimatedValue: true } }),
  ]);
  const ids = rows.map((r) => r.id);
  const [refs, excerpts, tasks] = await Promise.all([
    getProvenanceCounts(viewer, "OPPORTUNITY", ids),
    getFirstExcerpts(viewer, "OPPORTUNITY", ids),
    ids.length ? db.task.findMany({ where: { sourceRef: { in: ids.map((i) => `opportunity:${i}`) } }, select: { id: true, sourceRef: true, status: true } }) : Promise.resolve([]),
  ]);
  const taskFor = new Map(tasks.map((t) => [t.sourceRef!.slice("opportunity:".length), t]));
  return {
    items: rows.map((o) => ({ ...o, sources: refs[o.id] ?? { count: 0, hidden: 0 }, excerpt: excerpts[o.id] ?? null, pursuitTask: taskFor.get(o.id) ?? null })),
    active: counts.filter((c) => ACTIVE_OPP.includes(c.status)).reduce((n, c) => n + c._count._all, 0),
    closed: counts.filter((c) => !ACTIVE_OPP.includes(c.status)).reduce((n, c) => n + c._count._all, 0),
    activeValue: pipeline._sum.estimatedValue ?? 0,
    timezone: ceo.timezone,
  };
}

export async function getRiskCompanies() {
  return db.company.findMany({ where: { OR: [{ risks: { some: {} } }, { opportunities: { some: {} } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } });
}

export type RiskRow = Awaited<ReturnType<typeof getRisks>>["items"][number];
export type OpportunityRow = Awaited<ReturnType<typeof getOpportunities>>["items"][number];
