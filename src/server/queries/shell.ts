import type { UserRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { getCeoContext } from "@/server/context";
import { getAccessScope, reviewItemWhere } from "@/server/security/access";
import type { Capability } from "@/server/security/rbac";
import { can, type Viewer } from "@/server/security/session";

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

export interface ShellViewer {
  name: string;
  email: string;
  role: UserRole;
  isCeo: boolean;
  capabilities: Capability[];
}

export interface ShellData {
  viewer: ShellViewer;
  ceo: { name: string; firstName: string; title: string; timezone: string };
  brain: {
    lastRefreshAt: Date | null;
    status: string | null;
    newInsights: number;
    requiresCeo: number;
    briefReviewed: boolean;
    refreshedToday: boolean;
  };
  counts: { inbox: number; decisions: number; overdue: number; followUps: number; review: number; commitments: number };
  lookups: Lookups;
}

/** Shell data scoped to what the viewer may see: counts and lookups never leak CEO-only data. */
export async function getShellData(viewer: Viewer): Promise<ShellData> {
  const ceo = await getCeoContext();
  const cockpit = can(viewer, "cockpit.view");
  const workspace = can(viewer, "workspace.view");
  const none = <T,>(v: T) => Promise.resolve(v);
  const scope = await getAccessScope(viewer);
  const [lastRefresh, inbox, decisions, overdue, followUps, brief, pillars, goals, milestones, people, companies, openDecisions, review, commitments] = await Promise.all([
    can(viewer, "brain.view") || cockpit ? db.brainRefresh.findFirst({ orderBy: { startedAt: "desc" } }) : none(null),
    cockpit ? db.inboxItem.count({ where: { status: "OPEN" } }) : none(0),
    workspace ? db.decision.count({ where: { status: "NEEDED" } }) : none(0),
    workspace ? db.task.count({ where: { ownerId: ceo.personId, status: { in: OPEN_TASK_STATUSES }, dueDate: { lt: ceo.today } } }) : none(0),
    workspace ? db.delegation.count({ where: { status: "NEEDS_FOLLOW_UP" } }) : none(0),
    cockpit ? db.dailyBrief.findUnique({ where: { date: ceo.today }, select: { reviewedAt: true, sections: true } }) : none(null),
    workspace ? db.strategicPillar.findMany({ where: { active: true }, orderBy: { order: "asc" }, select: { id: true, name: true, color: true } }) : none([]),
    workspace ? db.goal.findMany({ where: { status: { not: "COMPLETED" } }, orderBy: [{ type: "asc" }, { title: "asc" }], select: { id: true, title: true, pillarId: true, type: true, status: true } }) : none([]),
    workspace ? db.milestone.findMany({ where: { status: { notIn: ["COMPLETED", "MISSED"] } }, orderBy: { dueDate: "asc" }, select: { id: true, title: true, goalId: true, status: true } }) : none([]),
    workspace ? db.person.findMany({ orderBy: [{ isCeo: "desc" }, { type: "asc" }, { name: "asc" }], select: { id: true, name: true, title: true, type: true, isCeo: true, companyId: true, expertise: true } }) : none([]),
    workspace ? db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }) : none([]),
    workspace ? db.decision.findMany({ where: { status: { in: ["NEEDED", "WAITING_INFO"] } }, orderBy: { deadline: "asc" }, select: { id: true, title: true, status: true } }) : none([]),
    can(viewer, "review.resolve") ? db.reviewQueueItem.count({ where: { AND: [{ status: "PENDING" }, reviewItemWhere(scope)] } }) : none(0),
    workspace ? db.commitment.count({ where: { status: "OPEN", direction: "OUTBOUND", dueDate: { lt: ceo.today } } }) : none(0),
  ]);

  const stats = (brief?.sections as { stats?: { newInsights?: number; requiresCeo?: number } } | null)?.stats;
  const refreshedToday = Boolean(lastRefresh && lastRefresh.startedAt >= new Date(ceo.today.getTime() - 14 * 3_600_000) && brief);

  return {
    viewer: { name: viewer.name, email: viewer.email, role: viewer.role, isCeo: viewer.role === "CEO", capabilities: [...viewer.capabilities] },
    ceo: { name: ceo.name, firstName: ceo.firstName, title: ceo.title, timezone: ceo.timezone },
    brain: {
      lastRefreshAt: lastRefresh?.completedAt ?? lastRefresh?.startedAt ?? null,
      status: lastRefresh?.status ?? null,
      newInsights: stats?.newInsights ?? 0,
      requiresCeo: inbox,
      briefReviewed: Boolean(brief?.reviewedAt),
      refreshedToday,
    },
    counts: { inbox, decisions, overdue, followUps, review, commitments },
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
