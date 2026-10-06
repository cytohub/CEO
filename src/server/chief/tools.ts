/**
 * Chief of Staff → CytoHub Brain query layer.
 *
 * Every function returns compact, model-friendly JSON plus citations (the
 * entities the answer drew on) so the UI can link back to the source. The
 * same functions back both the Claude tool runner and the rules engine.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addDays, dayKey, daysBetween, formatDateTime, formatDay } from "@/lib/dates";
import { FOCUS_AREAS, GOAL_STATUS, INSIGHT_TYPES, MILESTONE_STATUS, OPEN_TASK_STATUSES } from "@/lib/domain";
import { formatCurrency, formatMetric } from "@/lib/format";
import { computeAttention } from "@/server/brain/attention";
import { getMetricViews } from "@/server/brain/metrics";
import { buildPrepBrief } from "@/server/brain/prepare";
import { searchWorkspace } from "@/server/brain/search";
import type { CeoContext } from "@/server/context";
import { getThresholds } from "@/server/settings";
import { getUpcomingEvents } from "@/server/queries/today";

export interface Citation {
  type: string;
  id: string;
  label: string;
  href: string;
}

export interface ToolResult<T = unknown> {
  data: T;
  citations: Citation[];
}

const cite = {
  task: (t: { id: string; title: string }): Citation => ({ type: "task", id: t.id, label: t.title, href: `/tasks?task=${t.id}` }),
  goal: (g: { id: string; title: string }): Citation => ({ type: "goal", id: g.id, label: g.title, href: `/goals/${g.id}` }),
  milestone: (m: { id: string; title: string }): Citation => ({ type: "milestone", id: m.id, label: m.title, href: `/milestones?milestone=${m.id}` }),
  decision: (d: { id: string; title: string }): Citation => ({ type: "decision", id: d.id, label: d.title, href: `/decisions/${d.id}` }),
  company: (c: { id: string; name: string }): Citation => ({ type: "company", id: c.id, label: c.name, href: `/resources/companies/${c.id}` }),
  person: (p: { id: string; name: string }): Citation => ({ type: "person", id: p.id, label: p.name, href: `/resources/people/${p.id}` }),
  meeting: (m: { id: string; title: string }): Citation => ({ type: "meeting", id: m.id, label: m.title, href: `/upcoming?meeting=${m.id}` }),
};

const due = (d: Date | null, today: Date) => (d ? `${dayKey(d)} (${daysBetween(today, d) < 0 ? `${-daysBetween(today, d)}d overdue` : daysBetween(today, d) === 0 ? "today" : `in ${daysBetween(today, d)}d`})` : null);

export async function getTodayOverview(ceo: CeoContext): Promise<ToolResult> {
  const [plan, brief, inbox, meetings] = await Promise.all([
    db.dayPlan.findUnique({
      where: { date: ceo.today },
      include: { priorities: { orderBy: { rank: "asc" }, include: { task: { select: { id: true, title: true, dueDate: true, priorityScore: true, aiRecommendation: true, status: true } } } } },
    }),
    db.dailyBrief.findUnique({ where: { date: ceo.today }, select: { headline: true, summary: true } }),
    db.inboxItem.findMany({ where: { status: "OPEN" }, orderBy: [{ urgency: "desc" }], take: 8, select: { id: true, type: true, title: true, recommendedAction: true, urgency: true } }),
    db.meeting.findMany({ where: { startsAt: { gte: ceo.now, lt: addDays(ceo.now, 1) } }, orderBy: { startsAt: "asc" }, select: { id: true, title: true, startsAt: true, importance: true, objective: true } }),
  ]);
  const top = plan?.priorities.map((p) => p.task) ?? [];
  return {
    data: {
      date: dayKey(ceo.today),
      top5Confirmed: Boolean(plan?.top5ConfirmedAt),
      top5: top.map((t) => ({ title: t.title, score: Math.round(t.priorityScore), status: t.status, due: due(t.dueDate, ceo.today), why: t.aiRecommendation })),
      brief,
      inbox: inbox.map((i) => ({ type: i.type, title: i.title, urgency: i.urgency, recommendedAction: i.recommendedAction })),
      nextMeetings: meetings.map((m) => ({ title: m.title, at: formatDateTime(m.startsAt, ceo.timezone), importance: m.importance, objective: m.objective })),
    },
    citations: [...top.map(cite.task), ...meetings.filter((m) => m.importance >= 4).map(cite.meeting)],
  };
}

export type TaskFilter = "overdue" | "due_soon" | "delegable" | "waiting" | "postponed" | "blocked" | "top" | "completed_recent";

export async function listTasks(ceo: CeoContext, filter: TaskFilter, limit = 10): Promise<ToolResult> {
  const mine: Prisma.TaskWhereInput = { ownerId: ceo.personId };
  const open = { status: { in: OPEN_TASK_STATUSES } };
  const where: Record<TaskFilter, Prisma.TaskWhereInput> = {
    overdue: { ...mine, ...open, dueDate: { lt: ceo.today } },
    due_soon: { ...mine, ...open, dueDate: { gte: ceo.today, lte: addDays(ceo.today, 7) } },
    delegable: { ...mine, ...open, delegationRecommended: true },
    waiting: { ...mine, status: { in: ["WAITING"] } },
    postponed: { ...mine, ...open, postponeCount: { gte: 2 } },
    blocked: { status: "BLOCKED" },
    top: { ...mine, ...open, delegation: { is: null } },
    completed_recent: { ...mine, status: "DONE", completedAt: { gte: addDays(ceo.today, -14) } },
  };
  const tasks = await db.task.findMany({
    where: where[filter],
    orderBy: filter === "completed_recent" ? { completedAt: "desc" } : filter === "overdue" ? { dueDate: "asc" } : { priorityScore: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      status: true,
      dueDate: true,
      priorityScore: true,
      postponeCount: true,
      blocker: true,
      aiRecommendation: true,
      completedAt: true,
      estimatedMinutes: true,
      actualMinutes: true,
      owner: { select: { name: true, isCeo: true } },
      suggestedDelegate: { select: { name: true } },
      goal: { select: { title: true } },
    },
  });
  return {
    data: tasks.map((t) => ({
      title: t.title,
      status: t.status,
      due: due(t.dueDate, ceo.today),
      score: Math.round(t.priorityScore),
      owner: t.owner?.isCeo ? "CEO" : t.owner?.name,
      goal: t.goal?.title,
      postponed: t.postponeCount || undefined,
      blocker: t.blocker ?? undefined,
      suggestedDelegate: t.suggestedDelegate?.name,
      recommendation: t.aiRecommendation ?? undefined,
      completedAt: t.completedAt ? dayKey(t.completedAt) : undefined,
      effort: t.actualMinutes ? `${t.actualMinutes}m actual / ${t.estimatedMinutes ?? "?"}m est` : undefined,
    })),
    citations: tasks.map(cite.task),
  };
}

export async function getGoalsStatus(ceo: CeoContext, onlyAtRisk = false): Promise<ToolResult> {
  const goals = await db.goal.findMany({
    where: { status: onlyAtRisk ? { in: ["AT_RISK", "OFF_TRACK"] } : { notIn: ["COMPLETED"] }, type: { not: "DEPARTMENT" } },
    orderBy: [{ status: "desc" }, { confidence: "asc" }],
    include: {
      owner: { select: { name: true, isCeo: true } },
      pillar: { select: { name: true } },
      milestones: { where: { status: { notIn: ["COMPLETED", "MISSED"] } }, orderBy: { dueDate: "asc" }, take: 3, select: { id: true, title: true, status: true, dueDate: true, progress: true } },
    },
  });
  return {
    data: goals.map((g) => ({
      title: g.title,
      type: g.type,
      pillar: g.pillar?.name,
      status: GOAL_STATUS[g.status].label,
      progress: `${g.progress}%`,
      confidence: `${g.confidence}%`,
      target: g.targetDate ? dayKey(g.targetDate) : null,
      owner: g.owner?.isCeo ? "CEO" : g.owner?.name,
      risks: g.risks,
      nextMilestones: g.milestones.map((m) => `${m.title} — ${MILESTONE_STATUS[m.status].label}, ${m.progress}%, due ${due(m.dueDate, ceo.today)}`),
    })),
    citations: goals.filter((g) => g.status !== "ON_TRACK").map(cite.goal),
  };
}

export async function getMilestones(ceo: CeoContext, filter: "at_risk" | "overdue" | "due_soon" | "recent_completed"): Promise<ToolResult> {
  const where: Record<typeof filter, Prisma.MilestoneWhereInput> = {
    at_risk: { status: { in: ["AT_RISK", "BLOCKED"] } },
    overdue: { status: { notIn: ["COMPLETED", "MISSED"] }, dueDate: { lt: ceo.today } },
    due_soon: { status: { notIn: ["COMPLETED", "MISSED"] }, dueDate: { gte: ceo.today, lte: addDays(ceo.today, 30) } },
    recent_completed: { status: "COMPLETED", completedAt: { gte: addDays(ceo.today, -30) } },
  };
  const ms = await db.milestone.findMany({ where: where[filter], orderBy: { dueDate: "asc" }, take: 12, include: { owner: { select: { name: true, isCeo: true } }, goal: { select: { title: true } } } });
  return {
    data: ms.map((m) => ({ title: m.title, status: MILESTONE_STATUS[m.status].label, due: due(m.dueDate, ceo.today), progress: `${m.progress}%`, owner: m.owner?.isCeo ? "CEO" : m.owner?.name, goal: m.goal?.title, blocker: m.blocker })),
    citations: ms.map(cite.milestone),
  };
}

export async function getDecisions(ceo: CeoContext, status: "pending" | "waiting" | "decided"): Promise<ToolResult> {
  const where: Prisma.DecisionWhereInput =
    status === "pending" ? { status: "NEEDED" } : status === "waiting" ? { status: "WAITING_INFO" } : { status: "DECIDED", decidedAt: { gte: addDays(ceo.today, -60) } };
  const ds = await db.decision.findMany({ where, orderBy: status === "decided" ? { decidedAt: "desc" } : [{ deadline: "asc" }], take: 10, include: { options: { orderBy: { order: "asc" }, select: { title: true, recommended: true } } } });
  return {
    data: ds.map((d) => ({
      title: d.title,
      impact: `${d.strategicImpact}/5`,
      daysPending: status !== "decided" ? daysBetween(d.raisedAt, ceo.now) : undefined,
      deadline: due(d.deadline, ceo.today),
      recommendation: d.recommendation,
      waitingOn: d.waitingOn,
      options: d.options.map((o) => `${o.title}${o.recommended ? " (recommended)" : ""}`),
      finalDecision: d.finalDecision,
      outcome: d.outcome,
      lessons: d.lessonsLearned,
    })),
    citations: ds.map(cite.decision),
  };
}

export async function getUpcoming(ceo: CeoContext, days: number): Promise<ToolResult> {
  const events = await getUpcomingEvents({ from: ceo.now, to: addDays(ceo.today, days), today: ceo.today, timezone: ceo.timezone, ceoPersonId: ceo.personId });
  return {
    data: events.slice(0, 30).map((e) => ({ kind: e.kind, title: e.title, when: e.allDay ? formatDay(e.at, true) : formatDateTime(e.at, ceo.timezone), importance: e.importance, detail: e.subtitle })),
    citations: events.filter((e) => e.kind === "meeting" && e.importance >= 4).slice(0, 6).map((e) => cite.meeting({ id: e.id, title: e.title })),
  };
}

export async function getAttention(ceo: CeoContext): Promise<ToolResult> {
  const t = await getThresholds(db);
  const a = await computeAttention(db, { today: ceo.today, windowDays: t.attentionWindowDays, tolerance: t.attentionTolerance });
  return {
    data: {
      windowDays: a.windowDays,
      strategicShare: `${a.strategicPct}%`,
      areas: a.areas.filter((x) => x.actualPct > 0 || x.recommendedPct > 0).map((x) => ({ area: x.label, actual: `${x.actualPct.toFixed(0)}%`, recommended: `${x.recommendedPct}%`, flag: x.flag })),
    },
    citations: [{ type: "page", id: "attention", label: "CEO attention allocation", href: "/performance" }],
  };
}

export async function getPipeline(ceo: CeoContext, type: "SALES" | "FUNDRAISING" | "PARTNERSHIP"): Promise<ToolResult> {
  const deals = await db.deal.findMany({ where: { type, status: "OPEN" }, orderBy: [{ stageOrder: "desc" }, { value: "desc" }], include: { company: { select: { id: true, name: true, people: { select: { id: true, name: true, lastContactAt: true } } } } } });
  return {
    data: deals.map((d) => ({
      deal: d.name,
      stage: d.stage,
      value: d.value ? formatCurrency(d.value) : null,
      probability: `${d.probability}%`,
      daysSinceActivity: d.lastActivityAt ? daysBetween(d.lastActivityAt, ceo.now) : null,
      nextStep: d.nextStep,
      contacts: d.company?.people.map((p) => `${p.name} (last contact ${p.lastContactAt ? `${daysBetween(p.lastContactAt, ceo.now)}d ago` : "never"})`),
    })),
    citations: deals.filter((d) => d.company).map((d) => cite.company(d.company!)),
  };
}

export async function getDelegations(ceo: CeoContext): Promise<ToolResult> {
  const [active, recs] = await Promise.all([
    db.delegation.findMany({ where: { status: { in: ["ACTIVE", "NEEDS_FOLLOW_UP"] } }, include: { task: { select: { id: true, title: true } }, delegate: { select: { name: true } } }, orderBy: { status: "desc" } }),
    db.task.findMany({ where: { delegationRecommended: true, status: { in: OPEN_TASK_STATUSES } }, select: { id: true, title: true, suggestedDelegate: { select: { name: true } }, estimatedMinutes: true } }),
  ]);
  return {
    data: {
      shouldDelegate: recs.map((r) => ({ task: r.title, suggestedOwner: r.suggestedDelegate?.name, freesUp: r.estimatedMinutes ? `${r.estimatedMinutes}m` : undefined })),
      delegated: active.map((d) => ({
        task: d.task.title,
        owner: d.delegate.name,
        status: d.status,
        due: due(d.dueDate, ceo.today),
        lastUpdate: d.lastUpdateAt ? `${daysBetween(d.lastUpdateAt, ceo.now)}d ago` : "never",
        note: d.lastUpdateNote,
      })),
    },
    citations: [...recs.map(cite.task), ...active.filter((d) => d.status === "NEEDS_FOLLOW_UP").map((d) => cite.task(d.task))],
  };
}

export async function getRecentChanges(ceo: CeoContext, days: number): Promise<ToolResult> {
  const since = addDays(ceo.today, -days);
  const [insights, done, decided, ms] = await Promise.all([
    db.brainInsight.findMany({ where: { createdAt: { gte: since }, status: { not: "DISMISSED" } }, orderBy: [{ importance: "desc" }, { createdAt: "desc" }], take: 25 }),
    db.task.findMany({ where: { status: "DONE", completedAt: { gte: since }, ownerId: ceo.personId }, orderBy: { priorityScore: "desc" }, take: 10, select: { id: true, title: true, completedAt: true } }),
    db.decision.findMany({ where: { decidedAt: { gte: since } }, select: { id: true, title: true, finalDecision: true } }),
    db.milestone.findMany({ where: { completedAt: { gte: since } }, select: { id: true, title: true } }),
  ]);
  return {
    data: {
      sinceDays: days,
      insights: insights.map((i) => ({ type: INSIGHT_TYPES[i.type].label, title: i.title, summary: i.summary, importance: i.importance, date: dayKey(i.createdAt) })),
      completedByCeo: done.map((t) => t.title),
      decisionsMade: decided.map((d) => `${d.title} → ${d.finalDecision}`),
      milestonesReached: ms.map((m) => m.title),
    },
    citations: [...decided.map(cite.decision), ...ms.map(cite.milestone)],
  };
}

export async function getFollowUps(ceo: CeoContext): Promise<ToolResult> {
  const t = await getThresholds(db);
  const cutoff = addDays(ceo.today, -t.investorFollowUpDays);
  const people = await db.person.findMany({
    where: { type: { in: ["INVESTOR", "BOARD", "CUSTOMER", "PARTNER"] }, lastContactAt: { lt: cutoff } },
    orderBy: { lastContactAt: "asc" },
    take: 12,
    include: { company: { select: { id: true, name: true, deals: { where: { status: "OPEN" }, select: { name: true, stage: true, type: true } } } } },
  });
  const relevant = people.filter((p) => p.company?.deals.length);
  return {
    data: relevant.map((p) => ({ person: p.name, role: p.type, company: p.company?.name, lastContactDaysAgo: p.lastContactAt ? daysBetween(p.lastContactAt, ceo.now) : null, openDeals: p.company?.deals.map((d) => `${d.name} (${d.stage})`) })),
    citations: relevant.map(cite.person),
  };
}

export async function getMetrics(ceo: CeoContext): Promise<ToolResult> {
  const views = await getMetricViews(db, { today: ceo.today });
  return {
    data: views.map((v) => ({
      metric: v.name,
      value: v.current != null ? formatMetric(v.current, v.unit) : null,
      target: v.target != null ? formatMetric(v.target, v.unit) : null,
      change: v.change != null ? `${(v.change * 100).toFixed(0)}%` : null,
      direction: v.direction,
    })),
    citations: [{ type: "page", id: "scoreboard", label: "Company scoreboard", href: "/scoreboard" }],
  };
}

export async function getTimeSinks(ceo: CeoContext): Promise<ToolResult> {
  const tasks = await db.task.findMany({
    where: { ownerId: ceo.personId, status: "DONE", completedAt: { gte: addDays(ceo.today, -45) }, actualMinutes: { not: null } },
    select: { id: true, title: true, actualMinutes: true, estimatedMinutes: true, strategicImpact: true, ceoUniqueness: true, focusArea: true },
  });
  const sinks = tasks
    .filter((t) => (t.actualMinutes ?? 0) >= 90 && (t.strategicImpact <= 2 || t.ceoUniqueness <= 2 || (t.estimatedMinutes && t.actualMinutes! > t.estimatedMinutes * 2.5)))
    .sort((a, b) => (b.actualMinutes ?? 0) - (a.actualMinutes ?? 0))
    .slice(0, 8);
  return {
    data: sinks.map((t) => ({
      task: t.title,
      area: FOCUS_AREAS[t.focusArea].label,
      actual: `${t.actualMinutes}m`,
      estimate: t.estimatedMinutes ? `${t.estimatedMinutes}m` : null,
      strategicImpact: `${t.strategicImpact}/5`,
      ceoUniqueness: `${t.ceoUniqueness}/5`,
    })),
    citations: sinks.map(cite.task),
  };
}

export async function searchBrainTool(query: string): Promise<ToolResult> {
  const hits = await searchWorkspace(query, { limitPerType: 4 });
  return { data: hits.map((h) => ({ type: h.type, title: h.title, detail: h.subtitle })), citations: hits.slice(0, 8).map((h) => ({ type: h.type, id: h.id, label: h.title, href: h.href })) };
}

/** Everything related to a company, person, goal or project (by name or id). */
export async function getEntityContext(ceo: CeoContext, nameOrId: string): Promise<ToolResult> {
  const q = nameOrId.trim();
  const company = await db.company.findFirst({ where: { OR: [{ id: q }, { name: { contains: q, mode: "insensitive" } }] } });
  if (company) {
    const [people, deals, tasks, meetings, decisions, insights, resources, notes] = await Promise.all([
      db.person.findMany({ where: { companyId: company.id }, select: { id: true, name: true, title: true, lastContactAt: true } }),
      db.deal.findMany({ where: { companyId: company.id }, select: { name: true, stage: true, status: true, value: true, probability: true, nextStep: true, lastActivityAt: true } }),
      db.task.findMany({ where: { companyId: company.id }, orderBy: [{ status: "asc" }, { priorityScore: "desc" }], take: 10, select: { id: true, title: true, status: true, dueDate: true } }),
      db.meeting.findMany({ where: { companyId: company.id }, orderBy: { startsAt: "desc" }, take: 6, select: { id: true, title: true, startsAt: true, notes: { take: 1, select: { body: true } } } }),
      db.decision.findMany({ where: { companies: { some: { id: company.id } } }, select: { id: true, title: true, status: true } }),
      db.brainInsight.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" }, take: 8, select: { title: true, type: true, createdAt: true, summary: true } }),
      db.resource.findMany({ where: { companies: { some: { id: company.id } } }, select: { title: true, type: true } }),
      db.note.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" }, take: 5, select: { body: true, createdAt: true } }),
    ]);
    return {
      data: {
        company: { name: company.name, type: company.type, description: company.description, relationship: `${company.relationship}/5` },
        people: people.map((p) => ({ name: p.name, title: p.title, lastContact: p.lastContactAt ? dayKey(p.lastContactAt) : null })),
        deals: deals.map((d) => ({ ...d, value: d.value ? formatCurrency(d.value) : null, lastActivityAt: d.lastActivityAt ? dayKey(d.lastActivityAt) : null })),
        tasks: tasks.map((t) => ({ title: t.title, status: t.status, due: due(t.dueDate, ceo.today) })),
        meetings: meetings.map((m) => ({ title: m.title, at: formatDateTime(m.startsAt, ceo.timezone), note: m.notes[0]?.body })),
        decisions: decisions.map((d) => ({ title: d.title, status: d.status })),
        recentIntelligence: insights.map((i) => ({ title: i.title, type: i.type, date: dayKey(i.createdAt), summary: i.summary })),
        resources: resources.map((r) => `${r.title} (${r.type})`),
        notes: notes.map((n) => n.body),
      },
      citations: [cite.company(company), ...people.slice(0, 4).map(cite.person), ...tasks.slice(0, 3).map(cite.task), ...decisions.map(cite.decision)],
    };
  }
  const person = await db.person.findFirst({ where: { OR: [{ id: q }, { name: { contains: q, mode: "insensitive" } }] }, include: { company: true } });
  if (person) {
    const [tasks, meetings, insights] = await Promise.all([
      db.task.findMany({ where: { OR: [{ people: { some: { id: person.id } } }, { ownerId: person.id }] }, orderBy: [{ status: "asc" }, { priorityScore: "desc" }], take: 10, select: { id: true, title: true, status: true, dueDate: true } }),
      db.meeting.findMany({ where: { attendees: { some: { id: person.id } } }, orderBy: { startsAt: "desc" }, take: 6, select: { id: true, title: true, startsAt: true } }),
      db.brainInsight.findMany({ where: { personId: person.id }, orderBy: { createdAt: "desc" }, take: 6, select: { title: true, createdAt: true } }),
    ]);
    return {
      data: {
        person: { name: person.name, title: person.title, type: person.type, company: person.company?.name, lastContact: person.lastContactAt ? dayKey(person.lastContactAt) : null, notes: person.notesText },
        tasks: tasks.map((t) => ({ title: t.title, status: t.status, due: due(t.dueDate, ceo.today) })),
        meetings: meetings.map((m) => ({ title: m.title, at: formatDateTime(m.startsAt, ceo.timezone) })),
        recentIntelligence: insights.map((i) => `${dayKey(i.createdAt)} ${i.title}`),
      },
      citations: [cite.person(person), ...tasks.slice(0, 4).map(cite.task)],
    };
  }
  const goal = await db.goal.findFirst({
    where: { OR: [{ id: q }, { title: { contains: q, mode: "insensitive" } }] },
    include: {
      milestones: { select: { id: true, title: true, status: true, dueDate: true, progress: true } },
      tasks: { where: { status: { in: OPEN_TASK_STATUSES } }, orderBy: { priorityScore: "desc" }, take: 10, select: { id: true, title: true, status: true, dueDate: true, owner: { select: { name: true, isCeo: true } } } },
      decisions: { select: { id: true, title: true, status: true } },
      owner: { select: { name: true } },
    },
  });
  if (goal) {
    return {
      data: {
        goal: { title: goal.title, status: GOAL_STATUS[goal.status].label, progress: `${goal.progress}%`, confidence: `${goal.confidence}%`, owner: goal.owner?.name, risks: goal.risks },
        milestones: goal.milestones.map((m) => `${m.title} — ${MILESTONE_STATUS[m.status].label}, ${m.progress}%, due ${due(m.dueDate, ceo.today)}`),
        openTasks: goal.tasks.map((t) => `${t.title} (${t.owner?.isCeo ? "CEO" : t.owner?.name ?? "unassigned"}, ${t.status})`),
        decisions: goal.decisions.map((d) => `${d.title} (${d.status})`),
      },
      citations: [cite.goal(goal), ...goal.milestones.slice(0, 4).map(cite.milestone), ...goal.decisions.map(cite.decision)],
    };
  }
  return searchBrainTool(q);
}

export async function prepareNextMeeting(ceo: CeoContext): Promise<ToolResult> {
  const next = await db.meeting.findFirst({ where: { startsAt: { gte: ceo.now }, importance: { gte: 4 } }, orderBy: { startsAt: "asc" } });
  if (!next) return { data: { message: "No important meetings coming up." }, citations: [] };
  const brief = await buildPrepBrief(next.id);
  return { data: { meeting: next.title, at: formatDateTime(next.startsAt, ceo.timezone), brief }, citations: [cite.meeting(next)] };
}
