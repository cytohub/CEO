/**
 * Structured-record fetchers (tasks, goals, milestones, decisions, people,
 * companies, meetings, commitments, risks, opportunities, deals, projects,
 * resources, notes, insights). The caller only runs these for viewers with
 * workspace.view (insights: brain.view). Records derived from sources are
 * additionally dropped when their provenance is not readable (visibility.ts).
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { daysBetween, formatDateTime, formatDay, relativeDay, timeAgo } from "@/lib/dates";
import { COMPANY_TYPES, DECISION_STATUS, GOAL_STATUS, INSIGHT_TYPES, MEETING_TYPES, MILESTONE_STATUS, OPEN_TASK_STATUSES, RESOURCE_TYPES, TASK_STATUS } from "@/lib/domain";
import { formatCurrency } from "@/lib/format";
import { OPPORTUNITY_KIND, OPPORTUNITY_STATUS, RISK_STATUS } from "@/lib/intelligence";
import { documentWhere } from "@/server/security/access";
import { type Exec, dealTypesFor, meetingTypesFor, personTypesFor } from "./exec";
import { termScore, termsWhere } from "./fetch-source";
import { links } from "./links";
import { excerpt } from "./snippets";
import type { SearchResult } from "./types";
import { commitmentAccessWhere, filterByProvenance, insightAccessWhere } from "./visibility";

const NONE = "__none__";

function mode(x: Exec): "and" | "or" | "none" {
  if (!x.plan.text) return "none";
  if (x.plan.intent === "status" || x.plan.intent === "related") return "or";
  if (x.plan.intent === "keyword" || x.plan.intent === "list" || x.plan.intent === "discussed") return "and";
  return "none";
}

/** Compose entity / text constraints the same way for every model. */
function compose<W>(x: Exec, entity: W[], text: W[]): W[] {
  const m = mode(x);
  const out: W[] = [];
  if (x.hasEntities && m === "or") out.push({ OR: [...entity, ...text] } as W);
  else {
    if (x.hasEntities) out.push((entity.length ? { OR: entity } : { id: NONE }) as W);
    if (m === "and") out.push((text.length ? { OR: text } : { id: NONE }) as W);
  }
  return out;
}

/** Nothing to filter on and not explicitly asked for → skip (keeps "everything" out of focused answers). */
function unconstrained(x: Exec): boolean {
  return !x.hasEntities && mode(x) === "none" && !x.range && !x.plan.companyTypes.length && !x.plan.direction && x.plan.intent !== "list" && x.plan.intent !== "commitments";
}

const take = (x: Exec) => Math.max(x.limit * 3, 30);
const dueRange = (x: Exec) => (x.range && x.plan.timeField === "due" ? { ...(x.range.fromDay ? { gte: x.range.fromDay } : {}), ...(x.range.toDay ? { lte: x.range.toDay } : {}) } : null);
const occurredRange = (x: Exec) => (x.range && x.plan.timeField === "occurred" ? { ...(x.range.from ? { gte: x.range.from } : {}), ...(x.range.toExclusive ? { lt: x.range.toExclusive } : {}) } : null);
const recency = (x: Exec, at: Date | null | undefined, days = 90) => (at ? Math.max(0, 1 - Math.abs(x.now.getTime() - at.getTime()) / (days * 86_400_000)) : 0);

// ─── Commitments ─────────────────────────────────────────────────────────────

export async function fetchCommitments(x: Exec): Promise<SearchResult[]> {
  const { plan } = x;
  const entity: Prisma.CommitmentWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  if (x.personIds.length) {
    if (plan.direction !== "INBOUND") entity.push({ counterpartyPersonId: { in: x.personIds } });
    if (plan.direction !== "OUTBOUND") entity.push({ ownerPersonId: { in: x.personIds } });
  }
  if (x.dealIds.length) entity.push({ dealId: { in: x.dealIds } });
  if (x.goalIds.length) entity.push({ goalId: { in: x.goalIds } });
  if (x.projectIds.length) entity.push({ projectId: { in: x.projectIds } });
  if (x.meetingIds.length && plan.intent !== "commitments") entity.push({ meetingId: { in: x.meetingIds } });
  const text = termsWhere<Prisma.CommitmentWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ text: f })]);
  const and: Prisma.CommitmentWhereInput[] = [commitmentAccessWhere(x.scope), ...compose(x, entity, text)];
  if (plan.direction) and.push({ direction: plan.direction });
  and.push(plan.openOnly ? { status: "OPEN" } : { status: { in: ["OPEN", "FULFILLED"] } });
  if (plan.companyTypes.length) {
    const personTypes = personTypesFor(plan.companyTypes);
    const party = plan.direction === "INBOUND" ? "owner" : "counterparty";
    and.push({
      OR: [
        { company: { type: { in: plan.companyTypes } } },
        { [party]: { company: { type: { in: plan.companyTypes } } } },
        ...(personTypes.length ? [{ [party]: { type: { in: personTypes } } }] : []),
      ],
    });
  }
  const due = dueRange(x);
  if (due) and.push({ dueDate: due });
  const occ = occurredRange(x);
  if (occ) and.push({ committedAt: occ });

  const rows = await db.commitment.findMany({
    where: { AND: and },
    orderBy: [{ status: "asc" }, { dueDate: { sort: "asc", nulls: "last" } }],
    take: take(x),
    select: {
      id: true,
      direction: true,
      status: true,
      title: true,
      text: true,
      dueDate: true,
      dueText: true,
      fulfilledAt: true,
      committedAt: true,
      companyId: true,
      company: { select: { name: true } },
      owner: { select: { name: true, isCeo: true } },
      counterparty: { select: { name: true, isCeo: true } },
    },
  });
  const visible = await filterByProvenance(x.scope, "COMMITMENT", rows);
  return visible.map((c) => {
    const overdue = c.status === "OPEN" && c.dueDate && c.dueDate < x.today;
    const other = c.direction === "INBOUND" ? c.owner : c.counterparty;
    const party = other && !other.isCeo ? other.name : null;
    const who = c.direction === "OUTBOUND" ? `You owe ${[party, c.company?.name].filter(Boolean).join(", ") || "them"}` : c.direction === "INBOUND" ? `${[party, c.company?.name].filter(Boolean).join(", ") || "They"} owe${party || c.company ? "s" : ""} you` : "Internal";
    const due = c.status === "FULFILLED" ? `fulfilled ${c.fulfilledAt ? formatDay(c.fulfilledAt) : ""}`.trim() : c.dueDate ? `due ${formatDay(c.dueDate)}` : c.dueText ? `“${c.dueText}”` : "no date";
    const rank = (c.status === "OPEN" ? 0.6 : 0.2) + (overdue ? 0.3 : 0) + (c.dueDate ? Math.max(0, 0.1 - Math.abs(daysBetween(x.today, c.dueDate)) / 300) : 0) + termScore(x.terms, c.title, c.text) * 0.3;
    return {
      type: "commitment" as const,
      id: c.id,
      title: c.title,
      subtitle: [who, due].join(" · "),
      snippet: excerpt(c.text, x.plan.terms, 180),
      href: links.commitment(c.id),
      timestamp: (c.fulfilledAt ?? c.committedAt).toISOString(),
      rank,
      badges: overdue ? [relativeDay(c.dueDate, x.today)] : c.status === "FULFILLED" ? ["Fulfilled"] : c.dueDate && daysBetween(x.today, c.dueDate) === 0 ? ["Due today"] : undefined,
      companyId: c.companyId,
      companyName: c.company?.name ?? null,
      meta: { status: c.status, direction: c.direction, overdue: Boolean(overdue), due: c.dueDate ? c.dueDate.toISOString().slice(0, 10) : null, party, dueText: c.dueText ?? null },
    };
  });
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function fetchTasks(x: Exec): Promise<SearchResult[]> {
  if (unconstrained(x)) return [];
  const entity: Prisma.TaskWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  if (x.personIds.length) entity.push({ ownerId: { in: x.personIds } }, { people: { some: { id: { in: x.personIds } } } });
  if (x.goalIds.length) entity.push({ goalId: { in: x.goalIds } }, { milestone: { is: { goalId: { in: x.goalIds } } } });
  if (x.meetingIds.length) entity.push({ meetingId: { in: x.meetingIds } });
  if (x.dealIds.length) entity.push({ commitment: { is: { dealId: { in: x.dealIds } } } });
  const text = termsWhere<Prisma.TaskWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ description: f }), (_f, t) => ({ tags: { has: t.toLowerCase() } })]);
  const and: Prisma.TaskWhereInput[] = compose(x, entity, text);
  // Commitments are listed as commitments; their mirrored task would duplicate them.
  if (x.plan.intent === "deadlines") and.push({ commitment: { is: null } });
  if (x.plan.openOnly || x.plan.intent === "deadlines" || x.plan.intent === "status") and.push({ status: { in: OPEN_TASK_STATUSES } });
  const due = dueRange(x);
  if (due) and.push({ dueDate: due });
  const rows = await db.task.findMany({
    where: { AND: and },
    orderBy: x.plan.sort === "due" ? [{ dueDate: { sort: "asc", nulls: "last" } }, { priorityScore: "desc" }] : [{ status: "asc" }, { priorityScore: "desc" }],
    take: take(x),
    select: { id: true, title: true, description: true, status: true, dueDate: true, priorityScore: true, updatedAt: true, companyId: true, company: { select: { name: true } }, owner: { select: { name: true, isCeo: true } } },
  });
  const visible = await filterByProvenance(x.scope, "TASK", rows);
  return visible.map((t) => {
    const open = OPEN_TASK_STATUSES.includes(t.status);
    const overdue = open && t.dueDate && t.dueDate < x.today;
    return {
      type: "task" as const,
      id: t.id,
      title: t.title,
      subtitle: [TASK_STATUS[t.status].label, t.dueDate ? `due ${formatDay(t.dueDate)}` : null, t.owner ? (t.owner.isCeo ? "You" : t.owner.name) : "Unassigned", t.company?.name].filter(Boolean).join(" · "),
      snippet: x.terms.length ? excerpt(t.description, x.plan.terms, 160) : undefined,
      href: links.task(t.id),
      timestamp: t.updatedAt.toISOString(),
      rank: termScore(x.terms, t.title, t.description ?? "") * 0.6 + (open ? 0.25 : 0) + Math.min(0.15, t.priorityScore / 700),
      badges: overdue ? [relativeDay(t.dueDate, x.today)] : undefined,
      companyId: t.companyId,
      companyName: t.company?.name ?? null,
      meta: { status: t.status, due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null, owner: t.owner ? (t.owner.isCeo ? "You" : t.owner.name) : null, overdue: Boolean(overdue) },
    };
  });
}

// ─── Meetings ────────────────────────────────────────────────────────────────

export async function fetchMeetings(x: Exec): Promise<SearchResult[]> {
  const { plan } = x;
  const entity: Prisma.MeetingWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  if (x.personIds.length) entity.push({ attendees: { some: { id: { in: x.personIds } } } });
  if (x.goalIds.length) entity.push({ goalId: { in: x.goalIds } });
  const text = termsWhere<Prisma.MeetingWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ objective: f }), (f) => ({ description: f })]);
  const and: Prisma.MeetingWhereInput[] = compose(x, entity, text);
  if (plan.companyTypes.length || plan.categories.length) {
    const types = meetingTypesFor(plan.companyTypes);
    and.push({
      OR: [
        ...(plan.companyTypes.length ? [{ company: { type: { in: plan.companyTypes } } }] : []),
        ...(types.length ? [{ type: { in: types } }] : []),
        ...(plan.categories.includes("BOARD") ? [{ type: "BOARD" as const }] : []),
      ],
    });
  }
  if (unconstrained(x) && !plan.categories.length) return [];
  if (x.range) {
    if (x.range.from) and.push({ startsAt: { gte: x.range.from } });
    if (x.range.toExclusive) and.push({ startsAt: { lt: x.range.toExclusive } });
  }
  // "What have we discussed" is about meetings that happened.
  if ((plan.intent === "discussed" || plan.intent === "conversations") && !(x.range && plan.timeField === "due")) and.push({ startsAt: { lt: x.now } });
  and.push({ status: { not: "CANCELLED" } });
  const rows = await db.meeting.findMany({
    where: { AND: and },
    orderBy: { startsAt: "desc" },
    take: take(x),
    select: {
      id: true,
      title: true,
      type: true,
      startsAt: true,
      objective: true,
      companyId: true,
      company: { select: { name: true } },
      notes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } },
      _count: { select: { sourceItems: true } },
    },
  });
  return rows.map((m) => {
    const upcoming = m.startsAt >= x.now;
    return {
      type: "meeting" as const,
      id: m.id,
      title: m.title,
      subtitle: [formatDateTime(m.startsAt, x.timezone), MEETING_TYPES[m.type].label, m.company?.name].filter(Boolean).join(" · "),
      snippet: excerpt(m.notes[0]?.body ?? m.objective, x.plan.terms, 200),
      href: links.meeting(m.id),
      timestamp: m.startsAt.toISOString(),
      rank: termScore(x.terms, m.title, m.objective ?? "") * 0.6 + recency(x, m.startsAt, 60) * 0.4,
      badges: [...(upcoming ? ["Upcoming"] : []), ...(m.notes.length || m._count.sourceItems ? ["Notes"] : [])],
      companyId: m.companyId,
      companyName: m.company?.name ?? null,
      meta: { upcoming, objective: m.objective ?? null },
    };
  });
}

// ─── Decisions, milestones, goals ────────────────────────────────────────────

export async function fetchDecisions(x: Exec): Promise<SearchResult[]> {
  if (unconstrained(x)) return [];
  const entity: Prisma.DecisionWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companies: { some: { id: { in: x.companyIds } } } });
  if (x.goalIds.length) entity.push({ goalId: { in: x.goalIds } });
  if (x.personIds.length) entity.push({ ownerId: { in: x.personIds } });
  const text = termsWhere<Prisma.DecisionWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ context: f })]);
  const and: Prisma.DecisionWhereInput[] = compose(x, entity, text);
  if (x.plan.openOnly || x.plan.intent === "deadlines") and.push({ status: { in: ["NEEDED", "WAITING_INFO"] } });
  const due = dueRange(x);
  if (due) and.push({ deadline: due });
  const occ = occurredRange(x);
  if (occ) and.push({ OR: [{ raisedAt: occ }, { decidedAt: occ }] });
  const rows = await db.decision.findMany({
    where: { AND: and },
    orderBy: x.plan.sort === "due" ? [{ deadline: { sort: "asc", nulls: "last" } }] : [{ status: "asc" }, { raisedAt: "desc" }],
    take: take(x),
    select: { id: true, title: true, status: true, deadline: true, context: true, finalDecision: true, raisedAt: true, decidedAt: true },
  });
  const visible = await filterByProvenance(x.scope, "DECISION", rows);
  return visible.map((d) => ({
    type: "decision" as const,
    id: d.id,
    title: d.title,
    subtitle: [DECISION_STATUS[d.status].label, d.deadline ? `deadline ${formatDay(d.deadline)}` : null, d.decidedAt ? `decided ${formatDay(d.decidedAt)}` : null].filter(Boolean).join(" · "),
    snippet: excerpt(d.finalDecision ?? d.context, x.plan.terms, 180),
    href: links.decision(d.id),
    timestamp: (d.decidedAt ?? d.raisedAt).toISOString(),
    rank: termScore(x.terms, d.title, d.context ?? "") * 0.6 + (d.status === "NEEDED" || d.status === "WAITING_INFO" ? 0.3 : 0.1),
    badges: d.deadline && d.deadline < x.today && (d.status === "NEEDED" || d.status === "WAITING_INFO") ? [relativeDay(d.deadline, x.today)] : undefined,
    meta: { status: d.status, due: d.deadline ? d.deadline.toISOString().slice(0, 10) : null },
  }));
}

export async function fetchMilestones(x: Exec): Promise<SearchResult[]> {
  if (unconstrained(x)) return [];
  const entity: Prisma.MilestoneWhereInput[] = [];
  if (x.goalIds.length) entity.push({ goalId: { in: x.goalIds } });
  if (x.personIds.length) entity.push({ ownerId: { in: x.personIds } });
  if (x.companyIds.length) entity.push({ tasks: { some: { companyId: { in: x.companyIds } } } });
  const text = termsWhere<Prisma.MilestoneWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ description: f })]);
  const and: Prisma.MilestoneWhereInput[] = compose(x, entity, text);
  if (x.plan.openOnly || x.plan.intent === "deadlines" || x.plan.intent === "status") and.push({ status: { notIn: ["COMPLETED", "MISSED"] } });
  const due = dueRange(x);
  if (due) and.push({ dueDate: due });
  const rows = await db.milestone.findMany({
    where: { AND: and },
    orderBy: { dueDate: "asc" },
    take: take(x),
    select: { id: true, title: true, status: true, dueDate: true, progress: true, blocker: true, description: true },
  });
  return rows.map((m) => ({
    type: "milestone" as const,
    id: m.id,
    title: m.title,
    subtitle: [MILESTONE_STATUS[m.status].label, `due ${formatDay(m.dueDate)}`, `${m.progress}%`].join(" · "),
    snippet: m.blocker ? [{ text: `Blocker: ${m.blocker}`, match: false }] : undefined,
    href: links.milestone(m.id),
    timestamp: m.dueDate.toISOString(),
    rank: termScore(x.terms, m.title, m.description ?? "") * 0.6 + (m.status === "AT_RISK" || m.status === "BLOCKED" ? 0.3 : 0.15),
    badges: m.status !== "COMPLETED" && m.dueDate < x.today ? [relativeDay(m.dueDate, x.today)] : undefined,
    meta: { status: m.status, due: m.dueDate.toISOString().slice(0, 10), progress: m.progress },
  }));
}

export async function fetchGoals(x: Exec): Promise<SearchResult[]> {
  if (unconstrained(x)) return [];
  const entity: Prisma.GoalWhereInput[] = [];
  if (x.goalIds.length) entity.push({ id: { in: x.goalIds } });
  if (x.projectIds.length) entity.push({ projects: { some: { id: { in: x.projectIds } } } });
  const text = termsWhere<Prisma.GoalWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ description: f })]);
  if (x.hasEntities && !entity.length && mode(x) !== "or") return [];
  const rows = await db.goal.findMany({
    where: { AND: compose(x, entity, text) },
    orderBy: [{ type: "asc" }, { status: "desc" }],
    take: take(x),
    select: { id: true, title: true, type: true, status: true, progress: true, confidence: true, targetDate: true, description: true, risks: true },
  });
  const order = new Map(x.goalIds.map((id, i) => [id, i]));
  return rows.map((g) => ({
    type: "goal" as const,
    id: g.id,
    title: g.title,
    subtitle: [GOAL_STATUS[g.status].label, `${g.progress}% complete`, `${g.confidence}% confidence`, g.targetDate ? `target ${formatDay(g.targetDate)}` : null].filter(Boolean).join(" · "),
    snippet: g.risks ? [{ text: `Risks: ${g.risks}`, match: false }] : undefined,
    href: links.goal(g.id),
    timestamp: (g.targetDate ?? new Date(0)).toISOString(),
    rank: order.has(g.id) ? 1 - order.get(g.id)! * 0.05 : termScore(x.terms, g.title, g.description ?? ""),
    meta: { status: g.status, progress: g.progress, confidence: g.confidence, targetDate: g.targetDate ? g.targetDate.toISOString().slice(0, 10) : null },
  }));
}

// ─── Deals, risks, opportunities ─────────────────────────────────────────────

export async function fetchDeals(x: Exec): Promise<SearchResult[]> {
  const { plan } = x;
  const entity: Prisma.DealWhereInput[] = [];
  if (x.dealIds.length) entity.push({ id: { in: x.dealIds } });
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  const text = termsWhere<Prisma.DealWhereInput>(x.terms, [(f) => ({ name: f }), (f) => ({ nextStep: f })]);
  const and: Prisma.DealWhereInput[] = compose(x, entity, text);
  const types = dealTypesFor(plan.companyTypes);
  if (types.length) and.push({ type: { in: types } });
  if (unconstrained(x) && !types.length) return [];
  if (plan.openOnly || plan.intent === "status") and.push({ status: "OPEN" });
  const rows = await db.deal.findMany({
    where: { AND: and },
    orderBy: [{ status: "asc" }, { stageOrder: "desc" }, { value: { sort: "desc", nulls: "last" } }],
    take: take(x),
    select: { id: true, name: true, type: true, status: true, stage: true, value: true, probability: true, nextStep: true, lastActivityAt: true, companyId: true, company: { select: { name: true } } },
  });
  return rows.map((d) => ({
    type: "deal" as const,
    id: d.id,
    title: d.name,
    subtitle: [d.stage, d.value ? formatCurrency(d.value) : null, `${d.probability}%`, d.status !== "OPEN" ? d.status.toLowerCase().replace("_", " ") : null, d.lastActivityAt ? `active ${timeAgo(d.lastActivityAt, x.now)}` : null]
      .filter(Boolean)
      .join(" · "),
    snippet: d.nextStep ? [{ text: `Next: ${d.nextStep}`, match: false }] : undefined,
    href: links.deal(d.companyId),
    timestamp: (d.lastActivityAt ?? new Date(0)).toISOString(),
    rank: (d.status === "OPEN" ? 0.5 : 0.1) + (d.probability / 100) * 0.3 + termScore(x.terms, d.name) * 0.2,
    companyId: d.companyId,
    companyName: d.company?.name ?? null,
    meta: { type: d.type, status: d.status, stage: d.stage, value: d.value, probability: d.probability },
  }));
}

export async function fetchRisks(x: Exec): Promise<SearchResult[]> {
  if (unconstrained(x)) return [];
  const entity: Prisma.RiskWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  if (x.goalIds.length) entity.push({ goalId: { in: x.goalIds } }, { milestone: { is: { goalId: { in: x.goalIds } } } });
  if (x.dealIds.length) entity.push({ dealId: { in: x.dealIds } });
  if (x.projectIds.length) entity.push({ projectId: { in: x.projectIds } });
  if (x.personIds.length) entity.push({ ownerPersonId: { in: x.personIds } });
  const text = termsWhere<Prisma.RiskWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ description: f })]);
  const and: Prisma.RiskWhereInput[] = compose(x, entity, text);
  if (x.plan.openOnly || x.plan.intent === "status") and.push({ status: { in: ["OPEN", "MONITORING"] } });
  const occ = occurredRange(x);
  if (occ) and.push({ identifiedAt: occ });
  const rows = await db.risk.findMany({
    where: { AND: and },
    orderBy: [{ status: "asc" }, { severity: "desc" }, { identifiedAt: "desc" }],
    take: take(x),
    select: { id: true, title: true, description: true, status: true, severity: true, identifiedAt: true, companyId: true, company: { select: { name: true } } },
  });
  const visible = await filterByProvenance(x.scope, "RISK", rows);
  return visible.map((r) => ({
    type: "risk" as const,
    id: r.id,
    title: r.title,
    subtitle: [RISK_STATUS[r.status].label, `severity ${r.severity}/5`, r.company?.name, `identified ${timeAgo(r.identifiedAt, x.now)}`].filter(Boolean).join(" · "),
    snippet: excerpt(r.description, x.plan.terms, 180),
    href: links.risk(r.id),
    timestamp: r.identifiedAt.toISOString(),
    rank: termScore(x.terms, r.title, r.description ?? "") * 0.5 + r.severity / 10,
    companyId: r.companyId,
    companyName: r.company?.name ?? null,
    meta: { status: r.status, severity: r.severity },
  }));
}

export async function fetchOpportunities(x: Exec): Promise<SearchResult[]> {
  if (unconstrained(x)) return [];
  const entity: Prisma.OpportunityWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  if (x.personIds.length) entity.push({ personId: { in: x.personIds } });
  if (x.goalIds.length) entity.push({ goalId: { in: x.goalIds } });
  if (x.dealIds.length) entity.push({ dealId: { in: x.dealIds } });
  if (x.projectIds.length) entity.push({ projectId: { in: x.projectIds } });
  const text = termsWhere<Prisma.OpportunityWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ description: f })]);
  const and: Prisma.OpportunityWhereInput[] = compose(x, entity, text);
  if (x.plan.openOnly || x.plan.intent === "status") and.push({ status: { in: ["OPEN", "PURSUING"] } });
  const occ = occurredRange(x);
  if (occ) and.push({ identifiedAt: occ });
  const rows = await db.opportunity.findMany({
    where: { AND: and },
    orderBy: [{ status: "asc" }, { identifiedAt: "desc" }],
    take: take(x),
    select: { id: true, title: true, description: true, kind: true, status: true, estimatedValue: true, identifiedAt: true, companyId: true, company: { select: { name: true } } },
  });
  const visible = await filterByProvenance(x.scope, "OPPORTUNITY", rows);
  return visible.map((o) => ({
    type: "opportunity" as const,
    id: o.id,
    title: o.title,
    subtitle: [OPPORTUNITY_KIND[o.kind].label, OPPORTUNITY_STATUS[o.status].label, o.estimatedValue ? formatCurrency(o.estimatedValue) : null, o.company?.name].filter(Boolean).join(" · "),
    snippet: excerpt(o.description, x.plan.terms, 180),
    href: links.opportunity(o.id),
    timestamp: o.identifiedAt.toISOString(),
    rank: termScore(x.terms, o.title, o.description ?? "") * 0.5 + (o.status === "OPEN" || o.status === "PURSUING" ? 0.3 : 0.1),
    companyId: o.companyId,
    companyName: o.company?.name ?? null,
  }));
}

// ─── Companies, people, projects, resources, notes, insights ─────────────────

export async function fetchCompanies(x: Exec): Promise<SearchResult[]> {
  const entity: Prisma.CompanyWhereInput[] = x.companyIds.length ? [{ id: { in: x.companyIds } }] : [];
  const text = termsWhere<Prisma.CompanyWhereInput>(x.terms, [(f) => ({ name: f }), (f) => ({ description: f }), (f) => ({ industry: f }), (f) => ({ domain: f })]);
  const and = compose(x, entity, text);
  if (x.plan.companyTypes.length && x.plan.intent === "list") and.push({ type: { in: x.plan.companyTypes } });
  if (!and.length) return [];
  const rows = await db.company.findMany({
    where: { AND: and },
    orderBy: { lastActivityAt: { sort: "desc", nulls: "last" } },
    take: take(x),
    select: { id: true, name: true, type: true, industry: true, description: true, relationship: true, lastActivityAt: true, parentId: true },
  });
  return rows.map((c) => ({
    type: "company" as const,
    id: c.id,
    title: c.name,
    subtitle: [COMPANY_TYPES[c.type].label, c.industry, `relationship ${c.relationship}/5`, c.lastActivityAt ? `active ${timeAgo(c.lastActivityAt, x.now)}` : null].filter(Boolean).join(" · "),
    snippet: excerpt(c.description, x.plan.terms, 160),
    href: links.company(c.id),
    timestamp: c.lastActivityAt?.toISOString(),
    rank: x.companyIds[0] === c.id ? 1 : termScore(x.terms, c.name, c.description ?? "") * 0.8 + 0.1,
    companyId: c.id,
    companyName: c.name,
  }));
}

export async function fetchPeople(x: Exec): Promise<SearchResult[]> {
  const entity: Prisma.PersonWhereInput[] = [];
  if (x.personIds.length) entity.push({ id: { in: x.personIds } });
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  const text = termsWhere<Prisma.PersonWhereInput>(x.terms, [(f) => ({ name: f }), (f) => ({ title: f }), (f) => ({ email: f }), (f) => ({ company: { name: f } })]);
  const and = compose(x, entity, text);
  if (!and.length) return [];
  const rows = await db.person.findMany({
    where: { AND: and },
    orderBy: { lastContactAt: { sort: "desc", nulls: "last" } },
    take: take(x),
    select: { id: true, name: true, title: true, isCeo: true, lastContactAt: true, companyId: true, company: { select: { name: true } } },
  });
  return rows.map((p) => ({
    type: "person" as const,
    id: p.id,
    title: p.isCeo ? `${p.name} (you)` : p.name,
    subtitle: [p.title, p.company?.name, p.lastContactAt ? `last contact ${timeAgo(p.lastContactAt, x.now)}` : null].filter(Boolean).join(" · "),
    href: links.person(p.id),
    timestamp: p.lastContactAt?.toISOString(),
    rank: x.personIds.includes(p.id) ? 1 : termScore(x.terms, p.name, p.title ?? "") * 0.8 + 0.1,
    companyId: p.companyId,
    companyName: p.company?.name ?? null,
  }));
}

export async function fetchProjects(x: Exec): Promise<SearchResult[]> {
  const entity: Prisma.ProjectWhereInput[] = x.projectIds.length ? [{ id: { in: x.projectIds } }] : [];
  const text = termsWhere<Prisma.ProjectWhereInput>(x.terms, [(f) => ({ name: f }), (f) => ({ description: f })]);
  const and = compose(x, entity, text);
  if (!and.length) return [];
  const rows = await db.project.findMany({ where: { AND: and }, take: take(x), select: { id: true, name: true, kind: true, status: true, description: true, updatedAt: true } });
  return rows.map((p) => ({
    type: "project" as const,
    id: p.id,
    title: p.name,
    subtitle: [p.kind.replace("_", " ").toLowerCase(), p.status].filter(Boolean).join(" · "),
    snippet: excerpt(p.description, x.plan.terms, 160),
    href: links.project(p.name),
    timestamp: p.updatedAt.toISOString(),
    rank: x.projectIds.includes(p.id) ? 1 : termScore(x.terms, p.name, p.description ?? ""),
  }));
}

export async function fetchResources(x: Exec): Promise<SearchResult[]> {
  if (unconstrained(x)) return [];
  const entity: Prisma.ResourceWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companies: { some: { id: { in: x.companyIds } } } });
  if (x.goalIds.length) entity.push({ goals: { some: { id: { in: x.goalIds } } } });
  if (x.personIds.length) entity.push({ people: { some: { id: { in: x.personIds } } } });
  const text = termsWhere<Prisma.ResourceWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ summary: f }), (f) => ({ description: f }), (_f, t) => ({ tags: { has: t.toLowerCase() } })]);
  // A resource mirroring an ingested document is only as visible as that document.
  const and: Prisma.ResourceWhereInput[] = [...compose(x, entity, text), ...(x.scope.all ? [] : [{ OR: [{ document: { is: null } }, { document: { is: documentWhere(x.scope) } }] }])];
  const rows = await db.resource.findMany({
    where: { AND: and },
    orderBy: { updatedAt: "desc" },
    take: take(x),
    select: { id: true, title: true, type: true, summary: true, updatedAt: true, document: { select: { id: true } } },
  });
  return rows
    .filter((r) => !r.document) // documents appear in the Documents group
    .map((r) => ({
      type: "resource" as const,
      id: r.id,
      title: r.title,
      subtitle: RESOURCE_TYPES[r.type].label,
      snippet: excerpt(r.summary, x.plan.terms, 180),
      href: links.resource(r.id),
      timestamp: r.updatedAt.toISOString(),
      rank: termScore(x.terms, r.title, r.summary ?? "") * 0.8 + 0.1,
    }));
}

export async function fetchNotes(x: Exec): Promise<SearchResult[]> {
  if (unconstrained(x)) return [];
  const entity: Prisma.NoteWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  if (x.personIds.length) entity.push({ personId: { in: x.personIds } });
  if (x.meetingIds.length) entity.push({ meetingId: { in: x.meetingIds } });
  if (x.goalIds.length) entity.push({ goalId: { in: x.goalIds } });
  const text = termsWhere<Prisma.NoteWhereInput>(x.terms, [(f) => ({ body: f })]);
  const and: Prisma.NoteWhereInput[] = compose(x, entity, text);
  const occ = occurredRange(x);
  if (occ) and.push({ createdAt: occ });
  if (x.plan.companyTypes.length) and.push({ OR: [{ company: { type: { in: x.plan.companyTypes } } }, { meeting: { is: { company: { type: { in: x.plan.companyTypes } } } } }] });
  const rows = await db.note.findMany({
    where: { AND: and },
    orderBy: { createdAt: "desc" },
    take: take(x),
    select: {
      id: true,
      body: true,
      author: true,
      createdAt: true,
      meetingId: true,
      taskId: true,
      companyId: true,
      personId: true,
      meeting: { select: { title: true } },
      company: { select: { name: true } },
    },
  });
  return rows.map((n) => ({
    type: "note" as const,
    id: n.id,
    title: n.meeting ? `Note on ${n.meeting.title}` : n.company ? `Note on ${n.company.name}` : "Note",
    subtitle: [n.author, formatDateTime(n.createdAt, x.timezone)].join(" · "),
    snippet: excerpt(n.body, x.plan.terms, 200),
    href: n.meetingId ? links.meeting(n.meetingId) : n.taskId ? links.task(n.taskId) : n.companyId ? links.company(n.companyId) : n.personId ? links.person(n.personId) : links.search(n.body.slice(0, 40)),
    timestamp: n.createdAt.toISOString(),
    rank: termScore(x.terms, "", n.body) * 0.6 + recency(x, n.createdAt) * 0.4,
    companyId: n.companyId,
    companyName: n.company?.name ?? null,
  }));
}

export async function fetchInsights(x: Exec): Promise<SearchResult[]> {
  if (unconstrained(x)) return [];
  const entity: Prisma.BrainInsightWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  if (x.personIds.length) entity.push({ personId: { in: x.personIds } });
  if (x.goalIds.length) entity.push({ goalId: { in: x.goalIds } });
  if (x.dealIds.length) entity.push({ dealId: { in: x.dealIds } });
  if (x.meetingIds.length) entity.push({ meetingId: { in: x.meetingIds } });
  if (x.graphItemIds.length) entity.push({ sourceItemId: { in: x.graphItemIds } });
  const text = termsWhere<Prisma.BrainInsightWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ summary: f })]);
  const and: Prisma.BrainInsightWhereInput[] = [insightAccessWhere(x.scope), { status: { not: "DISMISSED" } }, ...compose(x, entity, text)];
  const occ = occurredRange(x);
  if (occ) and.push({ createdAt: occ });
  const rows = await db.brainInsight.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: "desc" }, { importance: "desc" }],
    take: take(x),
    select: { id: true, type: true, title: true, summary: true, importance: true, createdAt: true, companyId: true, company: { select: { name: true } } },
  });
  const visible = await filterByProvenance(x.scope, "INSIGHT", rows);
  return visible.map((i) => ({
    type: "insight" as const,
    id: i.id,
    title: i.title,
    subtitle: [INSIGHT_TYPES[i.type].label, `importance ${i.importance}/5`, timeAgo(i.createdAt, x.now)].join(" · "),
    snippet: excerpt(i.summary, x.plan.terms, 180),
    href: links.insight(i.id),
    timestamp: i.createdAt.toISOString(),
    rank: termScore(x.terms, i.title, i.summary ?? "") * 0.4 + i.importance / 10 + recency(x, i.createdAt, 30) * 0.1,
    companyId: i.companyId,
    companyName: i.company?.name ?? null,
  }));
}
