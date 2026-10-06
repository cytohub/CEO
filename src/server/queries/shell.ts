import { db } from "@/lib/db";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { getCeoContext } from "@/server/context";

export interface Lookups {
  ceoPersonId: string;
  timezone: string;
  pillars: { id: string; name: string; color: string }[];
  goals: { id: string; title: string; pillarId: string | null; type: string; status: string }[];
  milestones: { id: string; title: string; goalId: string | null; status: string }[];
  people: { id: string; name: string; title: string | null; type: string; isCeo: boolean; companyId: string | null; expertise: string[] }[];
  companies: { id: string; name: string; type: string }[];
  decisions: { id: string; title: string; status: string }[];
}

export interface ShellData {
  ceo: { name: string; firstName: string; title: string; timezone: string };
  brain: {
    lastRefreshAt: Date | null;
    status: string | null;
    newInsights: number;
    requiresCeo: number;
    briefReviewed: boolean;
    refreshedToday: boolean;
  };
  counts: { inbox: number; decisions: number; overdue: number; followUps: number };
  lookups: Lookups;
}

export async function getShellData(): Promise<ShellData> {
  const ceo = await getCeoContext();
  const [lastRefresh, inbox, decisions, overdue, followUps, brief, pillars, goals, milestones, people, companies, openDecisions] = await Promise.all([
    db.brainRefresh.findFirst({ orderBy: { startedAt: "desc" } }),
    db.inboxItem.count({ where: { status: "OPEN" } }),
    db.decision.count({ where: { status: "NEEDED" } }),
    db.task.count({ where: { ownerId: ceo.personId, status: { in: OPEN_TASK_STATUSES }, dueDate: { lt: ceo.today } } }),
    db.delegation.count({ where: { status: "NEEDS_FOLLOW_UP" } }),
    db.dailyBrief.findUnique({ where: { date: ceo.today }, select: { reviewedAt: true, sections: true } }),
    db.strategicPillar.findMany({ where: { active: true }, orderBy: { order: "asc" }, select: { id: true, name: true, color: true } }),
    db.goal.findMany({ where: { status: { not: "COMPLETED" } }, orderBy: [{ type: "asc" }, { title: "asc" }], select: { id: true, title: true, pillarId: true, type: true, status: true } }),
    db.milestone.findMany({ where: { status: { notIn: ["COMPLETED", "MISSED"] } }, orderBy: { dueDate: "asc" }, select: { id: true, title: true, goalId: true, status: true } }),
    db.person.findMany({ orderBy: [{ isCeo: "desc" }, { type: "asc" }, { name: "asc" }], select: { id: true, name: true, title: true, type: true, isCeo: true, companyId: true, expertise: true } }),
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    db.decision.findMany({ where: { status: { in: ["NEEDED", "WAITING_INFO"] } }, orderBy: { deadline: "asc" }, select: { id: true, title: true, status: true } }),
  ]);

  const stats = (brief?.sections as { stats?: { newInsights?: number; requiresCeo?: number } } | null)?.stats;
  const refreshedToday = Boolean(lastRefresh && lastRefresh.startedAt >= new Date(ceo.today.getTime() - 14 * 3_600_000) && brief);

  return {
    ceo: { name: ceo.name, firstName: ceo.firstName, title: ceo.title, timezone: ceo.timezone },
    brain: {
      lastRefreshAt: lastRefresh?.completedAt ?? lastRefresh?.startedAt ?? null,
      status: lastRefresh?.status ?? null,
      newInsights: stats?.newInsights ?? 0,
      requiresCeo: inbox,
      briefReviewed: Boolean(brief?.reviewedAt),
      refreshedToday,
    },
    counts: { inbox, decisions, overdue, followUps },
    lookups: {
      ceoPersonId: ceo.personId,
      timezone: ceo.timezone,
      pillars,
      goals,
      milestones,
      people,
      companies,
      decisions: openDecisions,
    },
  };
}
