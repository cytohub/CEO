import { db } from "@/lib/db";
import { addDays, dayStartInstant } from "@/lib/dates";
import { OPEN_TASK_STATUSES } from "@/lib/domain";
import { computeAttention } from "@/server/brain/attention";
import type { BriefSections } from "@/server/brain/types";
import type { ScoreBreakdown } from "@/server/brain/scoring";
import { getCeoContext } from "@/server/context";
import { getThresholds } from "@/server/settings";
import { taskRowInclude } from "./tasks";

export type UpcomingKind = "meeting" | "milestone" | "decision" | "task" | "delegation" | "deal";

export interface UpcomingEvent {
  id: string;
  kind: UpcomingKind;
  title: string;
  subtitle?: string;
  /** Instant for meetings; calendar day for the rest. */
  at: Date;
  allDay: boolean;
  importance: number;
  href: string;
  prepareable: boolean;
  prepared?: boolean;
  meetingId?: string;
}

export async function getUpcomingEvents(opts: { from: Date; to: Date; today: Date; timezone: string; ceoPersonId: string }): Promise<UpcomingEvent[]> {
  const fromInstant = opts.from;
  const toInstant = dayStartInstant(addDays(opts.to, 1), opts.timezone);
  const fromDay = opts.today;
  const toDay = opts.to;
  const [meetings, milestones, decisions, tasks, delegations, deals] = await Promise.all([
    db.meeting.findMany({
      where: { startsAt: { gte: fromInstant, lt: toInstant } },
      orderBy: { startsAt: "asc" },
      include: { company: { select: { name: true } }, _count: { select: { attendees: true } } },
    }),
    db.milestone.findMany({
      where: { status: { notIn: ["COMPLETED", "MISSED"] }, dueDate: { gte: fromDay, lte: toDay } },
      include: { owner: { select: { name: true } } },
    }),
    db.decision.findMany({ where: { status: { in: ["NEEDED", "WAITING_INFO"] }, deadline: { gte: fromDay, lte: toDay } } }),
    db.task.findMany({
      where: { ownerId: opts.ceoPersonId, status: { in: OPEN_TASK_STATUSES }, dueDate: { gte: fromDay, lte: toDay }, OR: [{ hardDeadline: true }, { priority: { in: ["P0", "P1"] } }] },
      select: { id: true, title: true, dueDate: true, priorityScore: true, hardDeadline: true },
    }),
    db.delegation.findMany({
      where: { status: { in: ["ACTIVE", "NEEDS_FOLLOW_UP"] }, dueDate: { gte: fromDay, lte: toDay } },
      include: { task: { select: { id: true, title: true } }, delegate: { select: { name: true } } },
    }),
    db.deal.findMany({ where: { status: "OPEN", expectedClose: { gte: fromDay, lte: toDay } }, include: { company: { select: { name: true } } } }),
  ]);

  const events: UpcomingEvent[] = [
    ...meetings.map<UpcomingEvent>((m) => ({
      id: m.id,
      kind: "meeting",
      title: m.title,
      subtitle: [m.company?.name, m.objective].filter(Boolean).join(" · ") || undefined,
      at: m.startsAt,
      allDay: false,
      importance: m.importance,
      href: `/upcoming?meeting=${m.id}`,
      prepareable: m.importance >= 4 && ["INVESTOR", "CUSTOMER", "BOARD", "PARTNER", "EXTERNAL", "CANDIDATE"].includes(m.type),
      prepared: Boolean(m.preparedAt),
      meetingId: m.id,
    })),
    ...milestones.map<UpcomingEvent>((m) => ({
      id: m.id,
      kind: "milestone",
      title: m.title,
      subtitle: `${m.progress}% · ${m.owner?.name ?? "Unassigned"}`,
      at: m.dueDate,
      allDay: true,
      importance: m.status === "AT_RISK" || m.status === "BLOCKED" ? 5 : 4,
      href: `/milestones?milestone=${m.id}`,
      prepareable: false,
    })),
    ...decisions.map<UpcomingEvent>((d) => ({
      id: d.id,
      kind: "decision",
      title: d.title,
      subtitle: "Decision deadline",
      at: d.deadline!,
      allDay: true,
      importance: d.strategicImpact,
      href: `/decisions/${d.id}`,
      prepareable: false,
    })),
    ...tasks.map<UpcomingEvent>((t) => ({
      id: t.id,
      kind: "task",
      title: t.title,
      subtitle: t.hardDeadline ? "Hard deadline" : "Priority task due",
      at: t.dueDate!,
      allDay: true,
      importance: t.priorityScore >= 70 ? 5 : t.priorityScore >= 50 ? 4 : 3,
      href: `?task=${t.id}`,
      prepareable: false,
    })),
    ...delegations.map<UpcomingEvent>((d) => ({
      id: d.id,
      kind: "delegation",
      title: d.task.title,
      subtitle: `Delegated to ${d.delegate.name}`,
      at: d.dueDate!,
      allDay: true,
      importance: 2,
      href: `?task=${d.task.id}`,
      prepareable: false,
    })),
    ...deals.map<UpcomingEvent>((d) => ({
      id: d.id,
      kind: "deal",
      title: d.name,
      subtitle: `Expected close · ${d.stage}`,
      at: d.expectedClose!,
      allDay: true,
      importance: d.type === "FUNDRAISING" ? 4 : 3,
      href: d.companyId ? `/resources/companies/${d.companyId}` : "/scoreboard",
      prepareable: false,
    })),
  ];
  // Sort by calendar position: all-day items sit at the start of their local day.
  const key = (e: UpcomingEvent) => (e.allDay ? dayStartInstant(e.at, opts.timezone).getTime() : e.at.getTime());
  return events.sort((a, b) => key(a) - key(b) || Number(b.allDay) - Number(a.allDay) || b.importance - a.importance);
}

export async function getTodayData() {
  const ceo = await getCeoContext();
  const thresholds = await getThresholds(db);
  const plan = await db.dayPlan.findUnique({
    where: { date: ceo.today },
    include: {
      priorities: {
        orderBy: { rank: "asc" },
        include: {
          task: {
            include: {
              ...taskRowInclude,
              dependsOn: { select: { id: true, title: true, status: true } },
              decision: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  });

  const brief = (await db.dailyBrief.findUnique({ where: { date: ceo.today } })) ?? (await db.dailyBrief.findFirst({ orderBy: { date: "desc" } }));
  const lastRefresh = await db.brainRefresh.findFirst({ orderBy: { startedAt: "desc" } });

  const [decisions, overdueTasks, blockedTasks, riskyMilestones, riskyGoals, goals, attention, upcoming, inboxCount, inboxTop, delegationRecs, followUps, sources] = await Promise.all([
    db.decision.findMany({
      where: { status: "NEEDED" },
      orderBy: [{ deadline: "asc" }, { strategicImpact: "desc" }],
      take: 5,
      include: { _count: { select: { options: true } }, goal: { select: { title: true } } },
    }),
    db.task.findMany({
      where: { ownerId: ceo.personId, status: { in: OPEN_TASK_STATUSES }, dueDate: { lt: ceo.today } },
      orderBy: [{ priorityScore: "desc" }],
      take: 6,
      select: { id: true, title: true, dueDate: true, priorityScore: true, postponeCount: true },
    }),
    db.task.findMany({
      where: { status: "BLOCKED", OR: [{ ownerId: ceo.personId }, { priority: { in: ["P0", "P1"] } }] },
      orderBy: { priorityScore: "desc" },
      take: 4,
      select: { id: true, title: true, blocker: true, owner: { select: { name: true, isCeo: true } } },
    }),
    db.milestone.findMany({
      where: { status: { notIn: ["COMPLETED", "MISSED"] }, OR: [{ status: { in: ["AT_RISK", "BLOCKED"] } }, { dueDate: { lt: ceo.today } }] },
      orderBy: { dueDate: "asc" },
      take: 6,
      select: { id: true, title: true, dueDate: true, status: true, progress: true, blocker: true, owner: { select: { name: true } } },
    }),
    db.goal.findMany({
      where: { status: { in: ["AT_RISK", "OFF_TRACK"] }, type: { in: ["COMPANY", "ANNUAL", "QUARTERLY", "CEO"] } },
      orderBy: [{ status: "desc" }, { confidence: "asc" }],
      take: 4,
      select: { id: true, title: true, status: true, confidence: true, progress: true },
    }),
    db.goal.findMany({
      where: { type: { in: ["COMPANY", "ANNUAL"] }, status: { notIn: ["COMPLETED", "PAUSED"] } },
      orderBy: [{ pillar: { order: "asc" } }],
      select: {
        id: true,
        title: true,
        status: true,
        progress: true,
        confidence: true,
        targetDate: true,
        pillar: { select: { name: true, color: true } },
        owner: { select: { name: true, isCeo: true } },
      },
    }),
    computeAttention(db, { today: ceo.today, windowDays: thresholds.attentionWindowDays, tolerance: thresholds.attentionTolerance }),
    getUpcomingEvents({ from: new Date(), to: addDays(ceo.today, 7), today: ceo.today, timezone: ceo.timezone, ceoPersonId: ceo.personId }),
    db.inboxItem.count({ where: { status: "OPEN" } }),
    db.inboxItem.findMany({ where: { status: "OPEN" }, orderBy: [{ urgency: "desc" }, { createdAt: "desc" }], take: 4, select: { id: true, title: true, type: true, urgency: true } }),
    db.task.count({ where: { delegationRecommended: true, status: { in: OPEN_TASK_STATUSES } } }),
    db.delegation.count({ where: { status: "NEEDS_FOLLOW_UP" } }),
    db.brainSource.groupBy({ by: ["status"], _count: true }),
  ]);

  return {
    ceo,
    plan: plan
      ? {
          id: plan.id,
          top5ConfirmedAt: plan.top5ConfirmedAt,
          briefReviewedAt: plan.briefReviewedAt,
          endOfDayAt: plan.endOfDayAt,
          endOfDayNotes: plan.endOfDayNotes,
          intention: plan.intention,
          priorities: plan.priorities.map((p) => ({
            ...p,
            breakdown: (p.task.scoreBreakdown as unknown as ScoreBreakdown | null) ?? null,
          })),
        }
      : null,
    brief: brief
      ? { ...brief, payload: brief.sections as unknown as BriefSections, isToday: brief.date.getTime() === ceo.today.getTime() }
      : null,
    lastRefresh,
    decisions,
    atRisk: { overdueTasks, blockedTasks, riskyMilestones, riskyGoals },
    goals,
    attention,
    upcoming,
    inbox: { count: inboxCount, top: inboxTop },
    delegation: { recommendations: delegationRecs, followUps },
    sources: {
      connected: sources.find((s) => s.status === "CONNECTED")?._count ?? 0,
      total: sources.reduce((a, s) => a + s._count, 0),
    },
  };
}

export type TodayData = Awaited<ReturnType<typeof getTodayData>>;
