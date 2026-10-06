/**
 * Applying proposals: the single code path that turns a validated proposal
 * into Brain records. The writer calls these for high-confidence extractions
 * and the review queue calls them on approval, so both produce identical
 * records, history (Activity) and provenance (SourceReference).
 */
import type { EntityType } from "@/generated/prisma/enums";
import type { Tx } from "@/lib/db";
import { addDays, dayFromKey, dayKey, formatDay } from "@/lib/dates";
import { confidenceFromScore, SOURCE_ITEM_KINDS } from "@/lib/intelligence";
import { domainOf, normalizeCompanyName, normalizePersonName } from "../resolve/names";
import { upsertRelationship } from "../resolve/relationships";
import { actionKey, shortHash } from "./dedupe";
import { noteCreated, noteDuplicate, noteUpdated, type WriteEnv } from "./env";
import { recordActivity } from "./history";
import { upsertInsight } from "./insights";
import { hasReferenceFrom, reference } from "./provenance";
import type {
  CommitmentProposalT,
  DeadlineProposalT,
  DecisionProposalT,
  FieldChangeProposalT,
  MeetingProposalT,
  NewCompanyProposalT,
  NewInvestorProposalT,
  NewPersonProposalT,
  OpportunityProposalT,
  RiskProposalT,
  TaskProposalT,
} from "./review-schemas";

// ─── Small helpers ───────────────────────────────────────────────────────────

export function day(value: string | null | undefined): Date | null {
  return value ? dayFromKey(value) : null;
}

/** Calendar day + n business days (Sat/Sun skipped). */
export function addBusinessDays(d: Date, n: number): Date {
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addDays(cur, 1);
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return cur;
}

export function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function sourceLabel(env: WriteEnv): string {
  return env.source ? SOURCE_ITEM_KINDS[env.source.kind].label.toLowerCase() : "review";
}

/** Drop dangling foreign keys (a proposal can outlive a merged or deleted record). */
async function exists(tx: Tx, kind: "person" | "company" | "goal" | "milestone" | "meeting" | "deal" | "project" | "thread" | "task" | "decision", id: string | null | undefined): Promise<string | null> {
  if (!id) return null;
  const where = { where: { id } };
  let n = 0;
  switch (kind) {
    case "person":
      n = await tx.person.count(where);
      break;
    case "company":
      n = await tx.company.count(where);
      break;
    case "goal":
      n = await tx.goal.count(where);
      break;
    case "milestone":
      n = await tx.milestone.count(where);
      break;
    case "meeting":
      n = await tx.meeting.count(where);
      break;
    case "deal":
      n = await tx.deal.count(where);
      break;
    case "project":
      n = await tx.project.count(where);
      break;
    case "thread":
      n = await tx.emailThread.count(where);
      break;
    case "task":
      n = await tx.task.count(where);
      break;
    case "decision":
      n = await tx.decision.count(where);
      break;
  }
  return n ? id : null;
}

async function existingPeople(tx: Tx, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await tx.person.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Record that another source said the same thing (dedupe hit). Never doubles up on re-processing. */
export async function corroborate(env: WriteEnv, targetType: EntityType, targetId: string, opts: { excerpt?: string | null; confidence?: number | null } = {}) {
  noteDuplicate(env);
  if (!env.source) return;
  if (await hasReferenceFrom(env.tx, targetType, targetId, env.source.id)) return;
  await reference(env, targetType, targetId, "CORROBORATED_BY", opts);
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

export async function createTask(env: WriteEnv, p: TaskProposalT): Promise<{ id: string }> {
  const { tx } = env;
  const goalId = await exists(tx, "goal", p.goalId);
  const goal = goalId ? await tx.goal.findUnique({ where: { id: goalId }, select: { pillarId: true } }) : null;
  const people = await existingPeople(tx, p.personIds);
  const due = day(p.dueDate);
  const task = await tx.task.create({
    data: {
      title: p.title.slice(0, 300),
      description: p.description,
      status: "TODO",
      priority: p.priority,
      focusArea: p.focusArea,
      dueDate: due,
      originalDueDate: due,
      hardDeadline: p.hardDeadline,
      source: p.source,
      sourceRef: env.source ? `source:${env.source.id}` : null,
      extractionConfidence: confidenceFromScore(p.confidence),
      ...p.scores,
      ownerId: await exists(tx, "person", p.ownerPersonId),
      companyId: await exists(tx, "company", p.companyId),
      goalId,
      pillarId: goal?.pillarId ?? null,
      milestoneId: await exists(tx, "milestone", p.milestoneId),
      meetingId: await exists(tx, "meeting", p.meetingId),
      ...(people.length ? { people: { connect: people.map((id) => ({ id })) } } : {}),
      createdAt: env.now,
    },
  });
  await recordActivity(env, "TASK_CREATED", `Brain captured a task from ${sourceLabel(env)}: ${task.title}`, { taskId: task.id, companyId: task.companyId, goalId: task.goalId, meetingId: task.meetingId }, {
    confidence: p.confidence,
    engine: env.engine,
    dueDate: p.dueDate,
  });
  await reference(env, "TASK", task.id, "CREATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
  noteCreated(env, "TASK", task.id);
  return { id: task.id };
}

// ─── Commitments ─────────────────────────────────────────────────────────────

export function commitmentFingerprint(direction: string, counterparty: string | null, title: string, thread: string | null): string {
  return `cm:${shortHash(direction, counterparty ?? "", actionKey(title), thread ?? "")}`;
}

/** Follow-up date: INBOUND → the business day after it is due (chase it); OUTBOUND → the due date. */
export function followUpFor(direction: string, due: Date | null): Date | null {
  if (!due) return null;
  return direction === "INBOUND" ? addBusinessDays(due, 1) : due;
}

export async function createCommitment(env: WriteEnv, p: CommitmentProposalT): Promise<{ id: string; taskId: string | null; created: boolean }> {
  const { tx } = env;
  const companyId = await exists(tx, "company", p.companyId);
  const counterpartyPersonId = await exists(tx, "person", p.counterpartyPersonId);
  const ownerPersonId = await exists(tx, "person", p.ownerPersonId);
  const threadId = await exists(tx, "thread", p.threadId);
  const meetingId = await exists(tx, "meeting", p.meetingId);
  const fingerprint = commitmentFingerprint(p.direction, companyId ?? counterpartyPersonId, p.title, threadId ?? meetingId);

  const prior = await tx.commitment.findUnique({ where: { fingerprint }, select: { id: true, taskId: true } });
  if (prior) {
    await corroborate(env, "COMMITMENT", prior.id, { excerpt: p.evidence, confidence: p.confidence });
    return { id: prior.id, taskId: prior.taskId, created: false };
  }

  const due = day(p.dueDate);
  let taskId: string | null = null;
  if (p.mirrorTask) {
    const linked = await exists(tx, "task", p.linkTaskId);
    const free = linked ? await tx.commitment.count({ where: { taskId: linked } }) === 0 : false;
    if (linked && free) {
      taskId = linked;
      // The task now stands for a promise: make the deadline hard and the CEO the only one who can keep it.
      await tx.task.update({ where: { id: linked }, data: { hardDeadline: true, ceoUniqueness: 5, ...(due ? { dueDate: due } : {}) } });
    } else {
      const t = await createTask(env, {
        title: p.title,
        description: `Commitment: ${p.text}`.slice(0, 4000),
        ownerPersonId,
        ownerName: null,
        dueDate: p.dueDate,
        dueText: p.dueText,
        hardDeadline: true,
        priority: p.priority,
        focusArea: p.focusArea,
        source: env.source ? sourceToItemSource(env.source.kind) : "BRAIN",
        companyId,
        goalId: p.goalId,
        milestoneId: null,
        meetingId,
        personIds: counterpartyPersonId ? [counterpartyPersonId] : [],
        scores: { ...p.scores, ceoUniqueness: 5 },
        confidence: p.confidence,
        evidence: p.evidence,
      });
      taskId = t.id;
    }
  }

  const row = await tx.commitment.create({
    data: {
      direction: p.direction,
      title: p.title.slice(0, 300),
      text: p.text,
      dueDate: due,
      dueText: p.dueText,
      followUpDate: day(p.followUpDate) ?? followUpFor(p.direction, due),
      committedAt: env.source?.occurredAt ?? env.now,
      confidence: confidenceFromScore(p.confidence),
      confidenceScore: p.confidence,
      fingerprint,
      ownerPersonId,
      counterpartyPersonId,
      companyId,
      taskId,
      threadId,
      meetingId,
      dealId: await exists(tx, "deal", p.dealId),
      goalId: await exists(tx, "goal", p.goalId),
      projectId: await exists(tx, "project", p.projectId),
      createdAt: env.now,
    },
  });
  const who = p.direction === "INBOUND" ? "owed to us" : p.direction === "OUTBOUND" ? "we owe" : "internal";
  await recordActivity(
    env,
    "COMMITMENT_CREATED",
    `Commitment captured (${who}): ${row.title}${due ? ` — due ${formatDay(due)}` : ""}`,
    { commitmentId: row.id, companyId, personId: p.direction === "INBOUND" ? ownerPersonId : counterpartyPersonId, taskId, meetingId },
    { direction: p.direction, dueDate: p.dueDate, confidence: p.confidence },
  );
  await reference(env, "COMMITMENT", row.id, "CREATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
  noteCreated(env, "COMMITMENT", row.id);
  return { id: row.id, taskId, created: true };
}

export function sourceToItemSource(kind: string) {
  switch (kind) {
    case "EMAIL_MESSAGE":
      return "EMAIL" as const;
    case "CALENDAR_EVENT":
      return "CALENDAR" as const;
    case "DOCUMENT":
      return "DOCUMENT" as const;
    case "MEETING_NOTES":
      return "MEETING" as const;
    default:
      return "BRAIN" as const;
  }
}

/** Mark a commitment fulfilled (and complete its mirrored task). */
export async function fulfillCommitment(env: WriteEnv, commitmentId: string, note: string, excerpt?: string | null): Promise<boolean> {
  const { tx } = env;
  const c = await tx.commitment.findUnique({ where: { id: commitmentId }, select: { id: true, status: true, title: true, taskId: true, companyId: true, ownerPersonId: true } });
  if (!c || c.status !== "OPEN") return false;
  const at = env.source?.occurredAt ?? env.now;
  await tx.commitment.update({ where: { id: c.id }, data: { status: "FULFILLED", fulfilledAt: at, resolutionNote: note.slice(0, 1000) } });
  await recordActivity(env, "COMMITMENT_FULFILLED", `Commitment fulfilled: ${c.title}`, { commitmentId: c.id, companyId: c.companyId, personId: c.ownerPersonId, taskId: c.taskId }, { from: "OPEN", to: "FULFILLED" });
  if (c.taskId) {
    const t = await tx.task.findUnique({ where: { id: c.taskId }, select: { status: true, title: true } });
    if (t && t.status !== "DONE" && t.status !== "CANCELLED") {
      await tx.task.update({ where: { id: c.taskId }, data: { status: "DONE", completedAt: at } });
      await recordActivity(env, "TASK_COMPLETED", `Completed automatically — commitment fulfilled: ${t.title}`, { taskId: c.taskId, commitmentId: c.id, companyId: c.companyId }, { from: t.status, to: "DONE" });
      await reference(env, "TASK", c.taskId, "UPDATED_FROM", { excerpt });
      noteUpdated(env, "TASK", c.taskId);
    }
  }
  await reference(env, "COMMITMENT", c.id, "UPDATED_FROM", { excerpt });
  noteUpdated(env, "COMMITMENT", c.id);
  // Overdue/follow-up nudges for it are no longer relevant.
  await tx.inboxItem.updateMany({ where: { commitmentId: c.id, status: { in: ["OPEN", "SNOOZED"] } }, data: { status: "DONE", resolvedAt: env.now, resolution: "Resolved automatically: commitment fulfilled." } });
  await tx.brainInsight.updateMany({ where: { commitmentId: c.id, status: "NEW" }, data: { status: "ACTIONED", updatedAt: env.now } });
  return true;
}

// ─── Deadlines ───────────────────────────────────────────────────────────────

export async function applyDeadline(env: WriteEnv, p: DeadlineProposalT): Promise<{ type: EntityType; id: string }> {
  const { tx } = env;
  if (p.targetType === "TASK" && (await exists(tx, "task", p.targetId))) {
    const t = await tx.task.findUniqueOrThrow({ where: { id: p.targetId! }, select: { dueDate: true } });
    await applyFieldChange(env, {
      targetType: "TASK",
      targetId: p.targetId!,
      targetLabel: p.what,
      field: "dueDate",
      from: t.dueDate ? dayKey(t.dueDate) : null,
      to: p.date,
      fromLabel: null,
      toLabel: null,
      changeKind: "deadline",
      note: null,
      confidence: p.confidence,
      evidence: p.evidence,
    });
    if (p.hard) await tx.task.update({ where: { id: p.targetId! }, data: { hardDeadline: true } });
    return { type: "TASK", id: p.targetId! };
  }
  if (p.targetType === "COMMITMENT" && p.targetId && (await tx.commitment.count({ where: { id: p.targetId } }))) {
    const c = await tx.commitment.findUniqueOrThrow({ where: { id: p.targetId }, select: { dueDate: true } });
    await applyFieldChange(env, {
      targetType: "COMMITMENT",
      targetId: p.targetId,
      targetLabel: p.what,
      field: "dueDate",
      from: c.dueDate ? dayKey(c.dueDate) : null,
      to: p.date,
      fromLabel: null,
      toLabel: null,
      changeKind: "deadline",
      note: null,
      confidence: p.confidence,
      evidence: p.evidence,
    });
    return { type: "COMMITMENT", id: p.targetId };
  }
  const t = await createTask(env, {
    title: p.what,
    description: `Deadline captured from ${sourceLabel(env)}${env.source ? ` “${env.source.title}”` : ""}.`,
    ownerPersonId: p.ownerPersonId ?? env.ceo.personId,
    ownerName: null,
    dueDate: p.date,
    dueText: null,
    hardDeadline: p.hard,
    priority: p.priority,
    focusArea: p.focusArea,
    source: env.source ? sourceToItemSource(env.source.kind) : "BRAIN",
    companyId: p.companyId,
    goalId: p.goalId,
    milestoneId: null,
    meetingId: p.meetingId,
    personIds: [],
    scores: { strategicImpact: 3, revenueImpact: 0, fundraisingImpact: 0, customerImpact: 0, scientificImpact: 0, riskLevel: p.hard ? 3 : 2, ceoUniqueness: 3, opportunityCost: 2 },
    confidence: p.confidence,
    evidence: p.evidence,
  });
  return { type: "TASK", id: t.id };
}

// ─── Field changes (protected updates to existing work) ──────────────────────

export async function applyFieldChange(env: WriteEnv, p: FieldChangeProposalT): Promise<{ type: EntityType; id: string; changed: boolean }> {
  const { tx } = env;
  const to = p.to;
  const excerpt = p.evidence;

  switch (p.targetType) {
    case "TASK": {
      const t = await tx.task.findUnique({ where: { id: p.targetId }, select: { id: true, title: true, dueDate: true, ownerId: true, status: true, companyId: true } });
      if (!t) throw new Error("The task no longer exists.");
      if (p.field === "dueDate") {
        const next = day(to as string | null);
        const prev = t.dueDate;
        if ((prev?.getTime() ?? null) === (next?.getTime() ?? null)) return { type: "TASK", id: t.id, changed: false };
        const later = prev && next && next > prev;
        await tx.task.update({ where: { id: t.id }, data: { dueDate: next, ...(later ? { postponeCount: { increment: 1 } } : {}) } });
        await recordActivity(env, "DEADLINE_CHANGED", `Deadline moved: ${t.title} — ${prev ? formatDay(prev) : "no date"} → ${next ? formatDay(next) : "no date"}`, { taskId: t.id, companyId: t.companyId }, {
          field: "dueDate",
          from: prev ? dayKey(prev) : null,
          to: next ? dayKey(next) : null,
        });
      } else if (p.field === "ownerId") {
        const owner = await tx.person.findUnique({ where: { id: String(to) }, select: { id: true, name: true } });
        if (!owner) throw new Error("The proposed owner no longer exists.");
        if (t.ownerId === owner.id) return { type: "TASK", id: t.id, changed: false };
        await tx.task.update({ where: { id: t.id }, data: { ownerId: owner.id } });
        await recordActivity(env, "OWNER_CHANGED", `Owner changed: ${t.title} → ${owner.name}`, { taskId: t.id, personId: owner.id, companyId: t.companyId }, { field: "ownerId", from: t.ownerId, to: owner.id });
      } else if (p.field === "status") {
        const status = String(to) as "TODO" | "IN_PROGRESS" | "WAITING" | "BLOCKED" | "DONE" | "CANCELLED" | "SOMEDAY";
        if (t.status === status) return { type: "TASK", id: t.id, changed: false };
        await tx.task.update({ where: { id: t.id }, data: { status, completedAt: status === "DONE" ? (env.source?.occurredAt ?? env.now) : null } });
        await recordActivity(env, status === "DONE" ? "TASK_COMPLETED" : "STATUS_CHANGED", `${t.title}: ${t.status} → ${status}`, { taskId: t.id, companyId: t.companyId }, { field: "status", from: t.status, to: status });
      }
      await reference(env, "TASK", t.id, "UPDATED_FROM", { excerpt, confidence: p.confidence });
      noteUpdated(env, "TASK", t.id);
      return { type: "TASK", id: t.id, changed: true };
    }

    case "COMMITMENT": {
      const c = await tx.commitment.findUnique({ where: { id: p.targetId }, select: { id: true, title: true, direction: true, dueDate: true, status: true, taskId: true, companyId: true, ownerPersonId: true } });
      if (!c) throw new Error("The commitment no longer exists.");
      if (p.field === "dueDate") {
        const next = day(to as string | null);
        if ((c.dueDate?.getTime() ?? null) === (next?.getTime() ?? null)) return { type: "COMMITMENT", id: c.id, changed: false };
        await tx.commitment.update({ where: { id: c.id }, data: { dueDate: next, followUpDate: followUpFor(c.direction, next) } });
        await recordActivity(env, "DEADLINE_CHANGED", `Commitment due date moved: ${c.title} — ${c.dueDate ? formatDay(c.dueDate) : "no date"} → ${next ? formatDay(next) : "no date"}`, { commitmentId: c.id, companyId: c.companyId, taskId: c.taskId }, {
          field: "dueDate",
          from: c.dueDate ? dayKey(c.dueDate) : null,
          to: next ? dayKey(next) : null,
        });
        if (c.taskId) {
          await applyFieldChange(env, { ...p, targetType: "TASK", targetId: c.taskId });
        }
      } else if (p.field === "status") {
        const status = String(to);
        if (status === c.status) return { type: "COMMITMENT", id: c.id, changed: false };
        if (status === "FULFILLED") {
          await fulfillCommitment(env, c.id, p.note ?? "Marked fulfilled after review.", excerpt);
          return { type: "COMMITMENT", id: c.id, changed: true };
        }
        await tx.commitment.update({ where: { id: c.id }, data: { status: status as "OPEN" | "CANCELLED" | "SUPERSEDED", resolutionNote: p.note } });
        await recordActivity(env, "STATUS_CHANGED", `Commitment ${status.toLowerCase()}: ${c.title}`, { commitmentId: c.id, companyId: c.companyId }, { field: "status", from: c.status, to: status });
        if (c.taskId && status !== "OPEN") {
          await tx.task.updateMany({ where: { id: c.taskId, status: { notIn: ["DONE", "CANCELLED"] } }, data: { status: "CANCELLED" } });
        }
      } else if (p.field === "ownerId") {
        const owner = await tx.person.findUnique({ where: { id: String(to) }, select: { id: true, name: true } });
        if (!owner) throw new Error("The proposed owner no longer exists.");
        await tx.commitment.update({ where: { id: c.id }, data: { ownerPersonId: owner.id } });
        await recordActivity(env, "OWNER_CHANGED", `Commitment owner changed: ${c.title} → ${owner.name}`, { commitmentId: c.id, personId: owner.id }, { field: "ownerPersonId", from: c.ownerPersonId, to: owner.id });
      }
      await reference(env, "COMMITMENT", c.id, "UPDATED_FROM", { excerpt, confidence: p.confidence });
      noteUpdated(env, "COMMITMENT", c.id);
      return { type: "COMMITMENT", id: c.id, changed: true };
    }

    case "MILESTONE": {
      const m = await tx.milestone.findUnique({ where: { id: p.targetId }, select: { id: true, title: true, dueDate: true, status: true, goalId: true } });
      if (!m) throw new Error("The milestone no longer exists.");
      if (p.field === "dueDate") {
        const next = day(to as string)!;
        if (m.dueDate.getTime() === next.getTime()) return { type: "MILESTONE", id: m.id, changed: false };
        await tx.milestone.update({ where: { id: m.id }, data: { dueDate: next } });
        await recordActivity(env, "DEADLINE_CHANGED", `Milestone date moved: ${m.title} — ${formatDay(m.dueDate)} → ${formatDay(next)}`, { milestoneId: m.id, goalId: m.goalId }, { field: "dueDate", from: dayKey(m.dueDate), to: dayKey(next) });
      } else if (p.field === "status") {
        const status = String(to) as "PLANNED" | "IN_PROGRESS" | "AT_RISK" | "BLOCKED" | "COMPLETED" | "MISSED";
        if (m.status === status) return { type: "MILESTONE", id: m.id, changed: false };
        const done = status === "COMPLETED";
        await tx.milestone.update({ where: { id: m.id }, data: { status, ...(done ? { completedAt: env.source?.occurredAt ?? env.now, progress: 100, blocker: null } : {}) } });
        await recordActivity(env, done ? "MILESTONE_COMPLETED" : "MILESTONE_UPDATED", done ? `Milestone completed: ${m.title}` : `Milestone ${m.title}: ${m.status} → ${status}`, { milestoneId: m.id, goalId: m.goalId }, { field: "status", from: m.status, to: status });
      }
      await reference(env, "MILESTONE", m.id, "UPDATED_FROM", { excerpt, confidence: p.confidence });
      noteUpdated(env, "MILESTONE", m.id);
      return { type: "MILESTONE", id: m.id, changed: true };
    }

    case "DEAL": {
      const d = await tx.deal.findUnique({ where: { id: p.targetId }, select: { id: true, name: true, value: true, expectedClose: true, companyId: true } });
      if (!d) throw new Error("The deal no longer exists.");
      if (p.field === "value") {
        const next = Number(to);
        if (d.value === next) return { type: "DEAL", id: d.id, changed: false };
        await tx.deal.update({ where: { id: d.id }, data: { value: next, lastActivityAt: env.source?.occurredAt ?? env.now } });
        await recordActivity(env, "STATUS_CHANGED", `Deal value changed: ${d.name} — ${d.value != null ? formatMoney(d.value) : "none"} → ${formatMoney(next)}`, { companyId: d.companyId }, { dealId: d.id, field: "value", from: d.value, to: next });
      } else if (p.field === "expectedClose") {
        const next = day(to as string | null);
        await tx.deal.update({ where: { id: d.id }, data: { expectedClose: next } });
        await recordActivity(env, "DEADLINE_CHANGED", `Expected close moved: ${d.name} → ${next ? formatDay(next) : "no date"}`, { companyId: d.companyId }, { dealId: d.id, field: "expectedClose", from: d.expectedClose ? dayKey(d.expectedClose) : null, to: next ? dayKey(next) : null });
      }
      await reference(env, "DEAL", d.id, "UPDATED_FROM", { excerpt, confidence: p.confidence });
      noteUpdated(env, "DEAL", d.id);
      return { type: "DEAL", id: d.id, changed: true };
    }

    case "RISK": {
      const r = await tx.risk.findUnique({ where: { id: p.targetId }, select: { id: true, title: true, status: true, severity: true, companyId: true } });
      if (!r) throw new Error("The risk no longer exists.");
      if (p.field === "status") {
        const status = String(to) as "OPEN" | "MONITORING" | "MITIGATED" | "RESOLVED" | "ACCEPTED";
        if (r.status === status) return { type: "RISK", id: r.id, changed: false };
        const closed = status === "RESOLVED" || status === "MITIGATED";
        await tx.risk.update({ where: { id: r.id }, data: { status, ...(closed ? { resolvedAt: env.source?.occurredAt ?? env.now, resolution: p.note ?? excerpt ?? null } : {}) } });
        await recordActivity(env, closed ? "RISK_RESOLVED" : "STATUS_CHANGED", closed ? `Risk resolved: ${r.title}` : `Risk ${r.title}: ${r.status} → ${status}`, { riskId: r.id, companyId: r.companyId }, { field: "status", from: r.status, to: status });
        if (closed) await tx.brainInsight.updateMany({ where: { riskId: r.id, status: { in: ["NEW", "ACKNOWLEDGED"] } }, data: { status: "ACTIONED", updatedAt: env.now } });
      } else if (p.field === "severity") {
        const sev = Number(to);
        if (r.severity === sev) return { type: "RISK", id: r.id, changed: false };
        await tx.risk.update({ where: { id: r.id }, data: { severity: sev } });
        await recordActivity(env, "STATUS_CHANGED", `Risk severity ${r.severity} → ${sev}: ${r.title}`, { riskId: r.id, companyId: r.companyId }, { field: "severity", from: r.severity, to: sev });
      }
      await reference(env, "RISK", r.id, "UPDATED_FROM", { excerpt, confidence: p.confidence });
      noteUpdated(env, "RISK", r.id);
      return { type: "RISK", id: r.id, changed: true };
    }

    case "DECISION": {
      const d = await tx.decision.findUnique({ where: { id: p.targetId }, select: { id: true, title: true, deadline: true, status: true, goalId: true } });
      if (!d) throw new Error("The decision no longer exists.");
      if (p.field === "deadline") {
        const next = day(to as string | null);
        await tx.decision.update({ where: { id: d.id }, data: { deadline: next } });
        await recordActivity(env, "DEADLINE_CHANGED", `Decision deadline moved: ${d.title} → ${next ? formatDay(next) : "no date"}`, { decisionId: d.id, goalId: d.goalId }, { field: "deadline", from: d.deadline ? dayKey(d.deadline) : null, to: next ? dayKey(next) : null });
      } else if (p.field === "status") {
        const status = String(to) as "NEEDED" | "WAITING_INFO" | "DECIDED" | "DEFERRED";
        await tx.decision.update({ where: { id: d.id }, data: { status, ...(status === "DECIDED" ? { decidedAt: env.source?.occurredAt ?? env.now } : {}) } });
        await recordActivity(env, status === "DECIDED" ? "DECISION_MADE" : "DECISION_UPDATED", `Decision ${d.title}: ${d.status} → ${status}`, { decisionId: d.id, goalId: d.goalId }, { field: "status", from: d.status, to: status });
      }
      await reference(env, "DECISION", d.id, "UPDATED_FROM", { excerpt, confidence: p.confidence });
      noteUpdated(env, "DECISION", d.id);
      return { type: "DECISION", id: d.id, changed: true };
    }

    case "MEETING": {
      const m = await tx.meeting.findUnique({ where: { id: p.targetId }, select: { id: true, title: true, status: true, companyId: true } });
      if (!m) throw new Error("The meeting no longer exists.");
      const status = String(to) as "SCHEDULED" | "CANCELLED" | "COMPLETED";
      if (m.status === status) return { type: "MEETING", id: m.id, changed: false };
      await tx.meeting.update({ where: { id: m.id }, data: { status } });
      await recordActivity(env, status === "CANCELLED" ? "MEETING_CANCELLED" : status === "COMPLETED" ? "MEETING_OCCURRED" : "STATUS_CHANGED", `${m.title}: ${m.status} → ${status}`, { meetingId: m.id, companyId: m.companyId }, { field: "status", from: m.status, to: status });
      await reference(env, "MEETING", m.id, "UPDATED_FROM", { excerpt, confidence: p.confidence });
      noteUpdated(env, "MEETING", m.id);
      return { type: "MEETING", id: m.id, changed: true };
    }
  }
}

// ─── Decisions ───────────────────────────────────────────────────────────────

export async function applyDecision(env: WriteEnv, p: DecisionProposalT, opts: { meetingId?: string | null } = {}): Promise<{ id: string; created: boolean }> {
  const { tx } = env;
  const goalId = await exists(tx, "goal", p.goalId);
  const goal = goalId ? await tx.goal.findUnique({ where: { id: goalId }, select: { pillarId: true, title: true } }) : null;
  const companies = (await tx.company.findMany({ where: { id: { in: p.companyIds } }, select: { id: true } })).map((c) => c.id);
  const match = p.matchDecisionId ? await tx.decision.findUnique({ where: { id: p.matchDecisionId }, select: { id: true, status: true, title: true, deadline: true } }) : null;
  const meetingId = (await exists(tx, "meeting", p.meetingId ?? opts.meetingId ?? null)) ?? null;
  const at = env.source?.occurredAt ?? env.now;
  let id: string;
  let created = false;

  if (p.status === "NEEDED") {
    if (match && match.status !== "DECIDED") {
      if (!match.deadline && p.deadline) {
        await tx.decision.update({ where: { id: match.id }, data: { deadline: day(p.deadline) } });
        await recordActivity(env, "DEADLINE_CHANGED", `Decision deadline set: ${match.title} → ${formatDay(day(p.deadline))}`, { decisionId: match.id }, { field: "deadline", from: null, to: p.deadline });
        await reference(env, "DECISION", match.id, "UPDATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
        noteUpdated(env, "DECISION", match.id);
      } else {
        await corroborate(env, "DECISION", match.id, { excerpt: p.evidence, confidence: p.confidence });
      }
      return { id: match.id, created: false };
    }
    const d = await tx.decision.create({
      data: {
        title: p.title.slice(0, 300),
        context: p.context,
        status: "NEEDED",
        raisedAt: at,
        deadline: day(p.deadline),
        strategicImpact: p.strategicImpact,
        goalId,
        pillarId: goal?.pillarId ?? null,
        ownerId: (await exists(tx, "person", p.ownerPersonId)) ?? env.ceo.personId,
        options: { create: p.options.map((title, order) => ({ title: title.slice(0, 200), order, pros: [], cons: [], risks: [] })) },
        ...(companies.length ? { companies: { connect: companies.map((cid) => ({ id: cid })) } } : {}),
        createdAt: env.now,
      },
    });
    id = d.id;
    created = true;
    await recordActivity(env, "DECISION_CREATED", `Decision needed: ${d.title}${d.deadline ? ` — by ${formatDay(d.deadline)}` : ""}`, { decisionId: d.id, goalId, companyId: companies[0] ?? null, meetingId }, { confidence: p.confidence });
    await reference(env, "DECISION", d.id, "CREATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
    noteCreated(env, "DECISION", d.id);
  } else {
    const finalDecision = (p.decision ?? p.title).slice(0, 2000);
    if (match) {
      await tx.decision.update({ where: { id: match.id }, data: { status: "DECIDED", finalDecision, decidedAt: at, ...(companies.length ? { companies: { connect: companies.map((cid) => ({ id: cid })) } } : {}) } });
      id = match.id;
      await reference(env, "DECISION", id, "UPDATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
      noteUpdated(env, "DECISION", id);
    } else {
      const d = await tx.decision.create({
        data: {
          title: p.title.slice(0, 300),
          context: p.context,
          status: "DECIDED",
          raisedAt: at,
          decidedAt: at,
          finalDecision,
          strategicImpact: p.strategicImpact,
          goalId,
          pillarId: goal?.pillarId ?? null,
          ownerId: (await exists(tx, "person", p.ownerPersonId)) ?? env.ceo.personId,
          ...(companies.length ? { companies: { connect: companies.map((cid) => ({ id: cid })) } } : {}),
          createdAt: env.now,
        },
      });
      id = d.id;
      created = true;
      await reference(env, "DECISION", id, "CREATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
      noteCreated(env, "DECISION", id);
    }
    await recordActivity(env, "DECISION_MADE", `Decision recorded: ${p.title}${p.decidedByName ? ` (decided by ${p.decidedByName})` : ""}`, { decisionId: id, goalId, meetingId, companyId: companies[0] ?? null }, {
      from: match?.status ?? null,
      to: "DECIDED",
      decision: finalDecision,
    });
    // Close the CEO inbox prompts about it.
    await tx.inboxItem.updateMany({ where: { decisionId: id, status: { in: ["OPEN", "SNOOZED"] } }, data: { status: "DONE", resolvedAt: env.now, resolution: "Resolved automatically: decision recorded." } });
  }

  // Graph: where the decision came from and what it affects.
  if (meetingId) await upsertRelationship(tx, { fromType: "DECISION", fromId: id, relation: "ORIGINATED_FROM", toType: "MEETING", toId: meetingId, confidence: p.confidence, sourceItemId: env.source?.id ?? null, at: env.now });
  else if (env.source) await upsertRelationship(tx, { fromType: "DECISION", fromId: id, relation: "ORIGINATED_FROM", toType: "SOURCE_ITEM", toId: env.source.id, confidence: p.confidence, sourceItemId: env.source.id, at: env.now });
  if (goalId) await upsertRelationship(tx, { fromType: "DECISION", fromId: id, relation: "AFFECTS", toType: "GOAL", toId: goalId, confidence: p.confidence, sourceItemId: env.source?.id ?? null, at: env.now });
  return { id, created };
}

// ─── Risks & opportunities ───────────────────────────────────────────────────

export function riskFingerprint(companyId: string | null, category: string, title: string): string {
  return `rk:${shortHash(companyId ?? "", category, actionKey(title))}`;
}

export function opportunityFingerprint(companyId: string | null, kind: string, title: string): string {
  return `op:${shortHash(companyId ?? "", kind, actionKey(title))}`;
}

export async function createRisk(env: WriteEnv, p: RiskProposalT, opts: { matchRiskId?: string | null } = {}): Promise<{ id: string; created: boolean; severity: number }> {
  const { tx } = env;
  const companyId = await exists(tx, "company", p.companyId);
  const fingerprint = riskFingerprint(companyId, p.category, p.title);
  const prior = opts.matchRiskId
    ? await tx.risk.findUnique({ where: { id: opts.matchRiskId }, select: { id: true, severity: true, title: true } })
    : await tx.risk.findUnique({ where: { fingerprint }, select: { id: true, severity: true, title: true } });
  if (prior) {
    if (p.severity > prior.severity) {
      await applyFieldChange(env, { targetType: "RISK", targetId: prior.id, targetLabel: prior.title, field: "severity", from: prior.severity, to: p.severity, fromLabel: null, toLabel: null, changeKind: null, note: null, confidence: p.confidence, evidence: p.evidence });
    } else {
      await corroborate(env, "RISK", prior.id, { excerpt: p.evidence, confidence: p.confidence });
    }
    return { id: prior.id, created: false, severity: Math.max(prior.severity, p.severity) };
  }
  const goalId = await exists(tx, "goal", p.goalId);
  const dealId = await exists(tx, "deal", p.dealId);
  const milestoneId = await exists(tx, "milestone", p.milestoneId);
  const risk = await tx.risk.create({
    data: {
      title: p.title.slice(0, 300),
      description: p.description,
      category: p.category,
      severity: p.severity,
      likelihood: p.likelihood,
      status: "OPEN",
      identifiedAt: env.source?.occurredAt ?? env.now,
      confidence: confidenceFromScore(p.confidence),
      confidenceScore: p.confidence,
      fingerprint,
      ownerPersonId: await exists(tx, "person", p.ownerPersonId),
      companyId,
      goalId,
      milestoneId,
      dealId,
      projectId: await exists(tx, "project", p.projectId),
      createdAt: env.now,
    },
  });
  await recordActivity(env, "RISK_EMERGED", `Risk identified (severity ${risk.severity}): ${risk.title}`, { riskId: risk.id, companyId, goalId, milestoneId }, { severity: risk.severity, category: risk.category, confidence: p.confidence });
  await reference(env, "RISK", risk.id, "CREATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
  noteCreated(env, "RISK", risk.id);
  await upsertInsight(env, {
    type: "RISK",
    fingerprint: `risk:${risk.id}`,
    title: `Risk: ${risk.title}`,
    summary: p.description,
    recommendation: risk.severity >= 4 ? "Assign an owner and agree a mitigation this week." : "Monitor and assign an owner if it grows.",
    importance: risk.severity,
    requiresCeo: risk.severity >= 4,
    links: { riskId: risk.id, companyId, goalId, milestoneId, dealId },
    excerpt: p.evidence,
    confidence: p.confidence,
  });
  return { id: risk.id, created: true, severity: risk.severity };
}

export async function createOpportunity(env: WriteEnv, p: OpportunityProposalT, opts: { matchOpportunityId?: string | null } = {}): Promise<{ id: string; created: boolean }> {
  const { tx } = env;
  const companyId = await exists(tx, "company", p.companyId);
  const fingerprint = opportunityFingerprint(companyId, p.kind, p.title);
  const prior = opts.matchOpportunityId
    ? await tx.opportunity.findUnique({ where: { id: opts.matchOpportunityId }, select: { id: true, estimatedValue: true } })
    : await tx.opportunity.findUnique({ where: { fingerprint }, select: { id: true, estimatedValue: true } });
  if (prior) {
    if (p.estimatedValue != null && prior.estimatedValue == null) {
      await tx.opportunity.update({ where: { id: prior.id }, data: { estimatedValue: p.estimatedValue } });
      await reference(env, "OPPORTUNITY", prior.id, "UPDATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
      noteUpdated(env, "OPPORTUNITY", prior.id);
    } else {
      await corroborate(env, "OPPORTUNITY", prior.id, { excerpt: p.evidence, confidence: p.confidence });
    }
    return { id: prior.id, created: false };
  }
  const goalId = await exists(tx, "goal", p.goalId);
  const dealId = await exists(tx, "deal", p.dealId);
  const personId = await exists(tx, "person", p.personId);
  const opp = await tx.opportunity.create({
    data: {
      title: p.title.slice(0, 300),
      description: p.description,
      kind: p.kind,
      status: "OPEN",
      estimatedValue: p.estimatedValue,
      nextStep: p.nextStep,
      identifiedAt: env.source?.occurredAt ?? env.now,
      confidence: confidenceFromScore(p.confidence),
      confidenceScore: p.confidence,
      fingerprint,
      companyId,
      personId,
      dealId,
      goalId,
      projectId: await exists(tx, "project", p.projectId),
      createdAt: env.now,
    },
  });
  await recordActivity(env, "OPPORTUNITY_IDENTIFIED", `Opportunity identified: ${opp.title}${opp.estimatedValue ? ` (${formatMoney(opp.estimatedValue)})` : ""}`, { opportunityId: opp.id, companyId, goalId, personId }, { kind: opp.kind, estimatedValue: opp.estimatedValue, confidence: p.confidence });
  await reference(env, "OPPORTUNITY", opp.id, "CREATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
  noteCreated(env, "OPPORTUNITY", opp.id);
  const big = (opp.estimatedValue ?? 0) >= 500_000;
  await upsertInsight(env, {
    type: "OPPORTUNITY",
    fingerprint: `opp:${opp.id}`,
    title: `Opportunity: ${opp.title}`,
    summary: p.description,
    recommendation: p.nextStep ?? "Decide whether to pursue it and who owns the next step.",
    importance: big ? 4 : 3,
    requiresCeo: big,
    links: { opportunityId: opp.id, companyId, goalId, dealId, personId },
    excerpt: p.evidence,
    confidence: p.confidence,
  });
  return { id: opp.id, created: true };
}

// ─── Meetings (review path) ──────────────────────────────────────────────────

export async function createMeetingFromProposal(env: WriteEnv, p: MeetingProposalT): Promise<{ id: string }> {
  const { tx } = env;
  const attendees = await existingPeople(tx, p.attendeeIds);
  const m = await tx.meeting.create({
    data: {
      title: p.title,
      type: p.type,
      category: p.category,
      focusArea: p.focusArea,
      startsAt: new Date(p.startsAt),
      endsAt: new Date(p.endsAt),
      importance: p.importance,
      location: p.location,
      objective: p.objective,
      source: env.source ? sourceToItemSource(env.source.kind) : "BRAIN",
      companyId: await exists(tx, "company", p.companyId),
      goalId: await exists(tx, "goal", p.goalId),
      ...(attendees.length ? { attendees: { connect: attendees.map((id) => ({ id })) } } : {}),
      createdAt: env.now,
    },
  });
  await recordActivity(env, "ENTITY_CREATED", `Meeting added: ${m.title}`, { meetingId: m.id, companyId: m.companyId }, { entity: "MEETING" });
  await reference(env, "MEETING", m.id, "CREATED_FROM", { excerpt: p.evidence, confidence: p.confidence });
  noteCreated(env, "MEETING", m.id);
  return { id: m.id };
}

// ─── Entities (people, companies, investors) ─────────────────────────────────

const COMPANY_TO_PERSON_TYPE = { INVESTOR: "INVESTOR", CUSTOMER: "CUSTOMER", PROSPECT: "CUSTOMER", PARTNER: "PARTNER", ACADEMIC: "PARTNER" } as const;

export function personTypeForCompany(type: string | null | undefined): "INVESTOR" | "CUSTOMER" | "PARTNER" | "OTHER" {
  return (type && COMPANY_TO_PERSON_TYPE[type as keyof typeof COMPANY_TO_PERSON_TYPE]) || "OTHER";
}

export async function addAlias(
  tx: Tx,
  entityType: "PERSON" | "COMPANY" | "PROJECT",
  entityId: string,
  alias: string,
  kind: "NAME" | "NICKNAME" | "ABBREVIATION" | "EMAIL" | "DOMAIN" | "SUBSIDIARY" | "FORMER_NAME",
  source: "SYSTEM" | "SEED" | "LEARNED" | "USER",
  confidence = 1,
  now?: Date,
): Promise<boolean> {
  const normalized =
    kind === "EMAIL" || kind === "DOMAIN" ? alias.trim().toLowerCase() : entityType === "PERSON" ? normalizePersonName(alias) : normalizeCompanyName(alias);
  if (!normalized) return false;
  const existing = await tx.entityAlias.findUnique({ where: { entityType_entityId_normalized: { entityType, entityId, normalized } }, select: { id: true } });
  if (existing) return false;
  await tx.entityAlias.create({ data: { entityType, entityId, alias: alias.slice(0, 300), normalized: normalized.slice(0, 300), kind, source, confidence, ...(now ? { createdAt: now } : {}) } });
  return true;
}

/** Attach people that were created without a company to a (newly confirmed) company. */
async function attachPeople(env: WriteEnv, companyId: string, companyType: string, personIds: string[], domain: string | null) {
  const { tx } = env;
  const ids = new Set(personIds);
  if (domain) {
    const byDomain = await tx.person.findMany({ where: { companyId: null, email: { endsWith: `@${domain}` } }, select: { id: true } });
    for (const p of byDomain) ids.add(p.id);
  }
  if (!ids.size) return;
  const type = personTypeForCompany(companyType);
  const people = await tx.person.findMany({ where: { id: { in: [...ids] }, companyId: null, isCeo: false }, select: { id: true, type: true, email: true } });
  for (const p of people) {
    await tx.person.update({ where: { id: p.id }, data: { companyId, ...(p.type === "OTHER" ? { type } : {}) } });
    if (p.email && domainOf(p.email) === domain) {
      await upsertRelationship(tx, { fromType: "PERSON", fromId: p.id, relation: "WORKS_AT", toType: "COMPANY", toId: companyId, confidence: 0.95, sourceItemId: env.source?.id ?? null, at: env.now });
    }
  }
}

async function createCompanyRow(env: WriteEnv, input: { name: string; domain: string | null; type: "INVESTOR" | "CUSTOMER" | "PROSPECT" | "PARTNER" | "ACADEMIC" | "VENDOR" | "COMPETITOR" | "OTHER"; industry?: string | null; website?: string | null }, why: string) {
  const { tx } = env;
  const sameName = await tx.company.findUnique({ where: { name: input.name }, select: { id: true, type: true, name: true } });
  if (sameName) {
    if (input.domain) await addAlias(tx, "COMPANY", sameName.id, input.domain, "DOMAIN", "LEARNED", 0.9, env.now);
    return { id: sameName.id, type: sameName.type as string, name: sameName.name, created: false };
  }
  const company = await tx.company.create({
    data: {
      name: input.name.slice(0, 200),
      type: input.type,
      domain: input.domain,
      industry: input.industry ?? null,
      website: input.website ?? (input.domain ? `https://${input.domain}` : null),
      relationship: 2,
      lastActivityAt: env.source ? (env.source.occurredAt < env.now ? env.source.occurredAt : env.now) : null,
      createdAt: env.now,
    },
  });
  if (input.domain) await addAlias(tx, "COMPANY", company.id, input.domain, "DOMAIN", "SYSTEM", 1, env.now);
  await recordActivity(env, "ENTITY_CREATED", `New ${input.type.toLowerCase()} company: ${company.name}`, { companyId: company.id }, { entity: "COMPANY", domain: input.domain, reason: why });
  noteCreated(env, "COMPANY", company.id);
  return { id: company.id, type: company.type as string, name: company.name, created: true };
}

export async function createCompanyFromProposal(env: WriteEnv, p: NewCompanyProposalT): Promise<{ id: string }> {
  const c = await createCompanyRow(env, { name: p.name, domain: p.domain, type: p.type, industry: p.industry }, "confirmed in review");
  await attachPeople(env, c.id, c.type, p.personIds, p.domain);
  return { id: c.id };
}

export async function createInvestorFromProposal(env: WriteEnv, p: NewInvestorProposalT): Promise<{ id: string; dealId: string | null }> {
  const { tx } = env;
  const c = await createCompanyRow(env, { name: p.name, domain: p.domain, type: "INVESTOR", industry: p.industry, website: p.website }, "new investor confirmed in review");
  if (!c.created && c.type !== "INVESTOR") await tx.company.update({ where: { id: c.id }, data: { type: "INVESTOR" } });
  await attachPeople(env, c.id, "INVESTOR", p.personIds, p.domain);
  let dealId: string | null = null;
  if (p.createDeal) {
    const deal = await tx.deal.create({
      data: {
        name: p.dealName ?? `${c.name} — fundraising`,
        type: "FUNDRAISING",
        status: "OPEN",
        stage: "Intro",
        stageOrder: 1,
        probability: 10,
        companyId: c.id,
        ownerId: env.ceo.personId,
        stageChangedAt: env.now,
        lastActivityAt: env.source?.occurredAt ?? env.now,
        createdAt: env.now,
      },
    });
    dealId = deal.id;
    await upsertRelationship(tx, { fromType: "COMPANY", fromId: c.id, relation: "ASSOCIATED_WITH", toType: "DEAL", toId: deal.id, confidence: 1, sourceItemId: env.source?.id ?? null, at: env.now });
    noteCreated(env, "DEAL", deal.id);
  }
  return { id: c.id, dealId };
}

export async function createPersonFromProposal(env: WriteEnv, p: NewPersonProposalT): Promise<{ id: string }> {
  const { tx } = env;
  if (p.email) {
    const same = await tx.person.findUnique({ where: { email: p.email.toLowerCase() }, select: { id: true } });
    if (same) return { id: same.id };
  }
  const companyId = await exists(tx, "company", p.companyId);
  const person = await tx.person.create({
    data: { name: p.name, email: p.email?.toLowerCase() ?? null, title: p.title, type: p.type, companyId, createdAt: env.now },
  });
  if (p.email) await addAlias(tx, "PERSON", person.id, p.email, "EMAIL", "SYSTEM", 1, env.now);
  await recordActivity(env, "ENTITY_CREATED", `New contact: ${person.name}`, { personId: person.id, companyId }, { entity: "PERSON", email: p.email });
  noteCreated(env, "PERSON", person.id);
  return { id: person.id };
}

/** For MERGE decisions on NEW_COMPANY / NEW_INVESTOR: "this is actually company X". */
export async function adoptIntoCompany(env: WriteEnv, companyId: string, p: { name: string; domain: string | null; personIds: string[] }) {
  const { tx } = env;
  const c = await tx.company.findUnique({ where: { id: companyId }, select: { id: true, type: true, name: true } });
  if (!c) throw new Error("The company to merge into no longer exists.");
  if (p.domain) await addAlias(tx, "COMPANY", c.id, p.domain, "DOMAIN", "USER", 1, env.now);
  if (normalizeCompanyName(p.name) !== normalizeCompanyName(c.name)) await addAlias(tx, "COMPANY", c.id, p.name, "NAME", "USER", 1, env.now);
  await attachPeople(env, c.id, c.type, p.personIds, p.domain);
  return { id: c.id };
}
