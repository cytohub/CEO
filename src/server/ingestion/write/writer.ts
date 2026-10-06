/**
 * BRAIN_WRITE: turn one item's validated extraction into Brain records.
 *
 * For every extracted record: resolve references (owner, company, goal, deal),
 * look for an existing record that already captures it (dedupe), run the
 * confidence gate, then write it or queue it for review — always through the
 * functions in records.ts, with provenance and history. Afterwards the same
 * transaction runs lifecycle detection (commitments fulfilled, risks
 * resolved, meetings held), change detection and the CEO attention engine.
 * Re-processing an item is idempotent: it corroborates instead of creating.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { ResourceType } from "@/generated/prisma/enums";
import { dayFromKey, dayKey, daysBetween, formatDay, toDay } from "@/lib/dates";
import { SOURCE_ITEM_KINDS } from "@/lib/intelligence";
import { titleKey } from "../extract/text";
import {
  type ExtractedCommitmentT,
  type ExtractedDecisionT,
  type ExtractedOpportunityT,
  type ExtractedRiskT,
  type ExtractedTaskT,
  type IntelligenceExtraction,
} from "../extraction-schema";
import { companyShortName, normalizePersonName, stripAccents } from "../resolve/names";
import { upsertRelationship } from "../resolve/relationships";
import type { Classification, LoadedSourceItem, PipelineContext, ResolutionContext, WriteSummary } from "../types";
import { applyAttention } from "./attention";
import { detectChanges, raiseChange } from "./changes";
import { detectFulfillment } from "./commitments";
import { actionKey, actionSimilarity, findDuplicateCommitment, findDuplicateTask, shortHash, tokenCoverage, type DedupeScope, type TaskCandidate } from "./dedupe";
import { BRAIN_ACTOR, emptyCounters, emptySummary, noteCreated, noteUpdated, snapshotOf } from "./env";
import { gate, PROTECTED_REASONS } from "./gate";
import { isCeoTouchedTask, recordActivity } from "./history";
import {
  ceoIsDirect,
  ceoSoleRecipient,
  companyByName,
  dealFor,
  externalSender,
  isLoud,
  loadWriteRefs,
  matchGoal,
  personName,
  resolveOwner,
  senderIsCeo,
  type DueChange,
  type ItemCtx,
} from "./item";
import { completeMeetingFromNotes, syncCalendarMeeting } from "./meetings";
import { cleanDecisionTitle, cleanTitle, sameSentence, sentencesOf, thirdPartyActor } from "./phrasing";
import { hasReferenceFrom, reference } from "./provenance";
import {
  applyDecision,
  applyFieldChange,
  commitmentFingerprint,
  corroborate,
  createCommitment,
  createOpportunity,
  createRisk,
  createTask,
  formatMoney,
  opportunityFingerprint,
  riskFingerprint,
  sourceToItemSource,
} from "./records";
import { flushReviews, queueReview } from "./review";
import type { CommitmentProposalT, TaskProposalT } from "./review-schemas";
import { defaultPriority, focusAreaFor, isHardDeadline, taskScores } from "./task-scoring";

export async function writeIntelligence(
  ctx: PipelineContext,
  item: LoadedSourceItem,
  extraction: IntelligenceExtraction,
  resolution: ResolutionContext,
  classification: Classification,
): Promise<WriteSummary> {
  const summary = emptySummary();
  const counters = emptyCounters();

  await ctx.db.$transaction(
    async (tx) => {
      const w: ItemCtx = {
        tx,
        now: ctx.now,
        today: ctx.ceo.today,
        timezone: ctx.ceo.timezone,
        ceo: { personId: ctx.ceo.personId, userId: ctx.ceo.userId, name: ctx.ceo.name, email: ctx.ceo.email },
        actor: BRAIN_ACTOR,
        source: snapshotOf(item),
        engine: item.extractionEngine,
        relevance: classification.relevance,
        summary,
        counters,
        ctx,
        item,
        extraction,
        resolution,
        classification,
        direction: item.emailMessage?.direction ?? null,
        threadId: item.emailMessage?.threadId ?? null,
        meetingId: item.meetingId ?? item.calendarEvent?.meetingId ?? null,
        refs: await loadWriteRefs(tx, resolution),
        written: { tasks: [], commitments: [], decisions: [], queuedTasks: [], risks: [], opportunities: [], dueChanges: [], changes: [], meeting: null },
        // Review items are collected and filed together: at most a few per source item, highest impact first.
        reviewBuffer: [],
      };

      // Meetings first: tasks and decisions from the item attach to them.
      if (item.calendarEvent) await syncCalendarMeeting(w);

      // Commitments before tasks: a CEO promise owns its mirrored task, and a
      // task extracted for the same action then corroborates it.
      for (const c of extraction.commitments) await writeCommitment(w, c);
      for (const t of extraction.tasks) await writeTask(w, t);
      for (const f of extraction.followUps) await writeFollowUp(w, f);
      for (const m of extraction.meetingRequests) await writeMeetingRequest(w, m);
      for (const d of extraction.decisions) await writeDecision(w, d);
      for (const d of extraction.deadlines) await writeDeadline(w, d);
      for (const r of extraction.risks) await writeRisk(w, r);
      for (const o of extraction.opportunities) await writeOpportunity(w, o);
      await writeFacts(w);
      if (item.document) await writeDocument(w);
      await writeExtractedRelationships(w);

      await detectFulfillment(w);
      await detectRiskResolution(w);
      if (item.kind === "MEETING_NOTES" && item.meetingId) await completeMeetingFromNotes(w, item.meetingId);

      await detectChanges(w);
      await flushReviews(w);
      await applyAttention(w);
    },
    { timeout: 120_000, maxWait: 10_000 },
  );

  // Counters only after commit, so a rolled-back attempt is not double-counted on retry.
  if (counters.recordsWritten) ctx.count("recordsWritten", counters.recordsWritten);
  if (counters.reviewItems) ctx.count("reviewItems", counters.reviewItems);
  if (counters.duplicatesPrevented) ctx.count("duplicatesPrevented", counters.duplicatesPrevented);
  ctx.log("BRAIN_WRITE", `${item.title}: ${summary.created.length} created, ${summary.updated.length} updated, ${summary.reviewItemIds.length} review, ${summary.duplicatesPrevented} duplicates prevented`);
  return summary;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function ctxKey(w: ItemCtx): string {
  return w.threadId ? `thread:${w.threadId}` : w.meetingId ? `meeting:${w.meetingId}` : `item:${w.item.id}`;
}

function scope(w: ItemCtx, companyId: string | null, ownerPersonId: string | null): DedupeScope {
  const companyIds = [...new Set([companyId, w.resolution.primaryCompanyId].filter((x): x is string => !!x))];
  return { sourceItemId: w.item.id, threadId: w.threadId, meetingId: w.meetingId, companyIds, ownerPersonId, now: w.now };
}

function describe(w: ItemCtx, text: string | null | undefined, evidence: string | null | undefined): string {
  const from = w.resolution.counterpartPersonIds.map((id) => personName(w, id)).find(Boolean);
  const company = w.resolution.primaryCompanyId ? w.refs.companies.get(w.resolution.primaryCompanyId)?.name : null;
  const who = [from, company].filter(Boolean).join(", ");
  const src = `${SOURCE_ITEM_KINDS[w.item.kind].label} “${w.item.title}”${who ? ` (${who})` : ""}, ${formatDay(toDay(w.item.occurredAt, w.timezone))}`;
  const parts = [text?.trim(), evidence ? `Source — ${src}: “${evidence.trim()}”` : `Source — ${src}.`].filter(Boolean);
  return parts.join("\n\n").slice(0, 4000);
}

function moneyMax(w: ItemCtx): number | null {
  const values = w.extraction.facts.filter((f) => f.kind === "MONEY" && f.numericValue != null).map((f) => f.numericValue!);
  return values.length ? Math.max(...values) : null;
}

function maxRiskSeverity(w: ItemCtx): number | null {
  return w.extraction.risks.length ? Math.max(...w.extraction.risks.map((r) => r.severity)) : null;
}

function isScientific(w: ItemCtx): boolean {
  return w.extraction.activityTags.includes("SCIENTIFIC") || w.classification.category === "SCIENTIFIC_LEADERSHIP";
}

async function buildTaskProposal(
  w: ItemCtx,
  t: { title: string; description: string | null; ownerName: string | null; dueDate: string | null; dueText: string | null; priorityHint: "P0" | "P1" | "P2" | "P3" | null; companyName: string | null; focusArea: TaskProposalT["focusArea"] | null; confidence: number; evidence: string },
  ownerPersonId: string | null,
  opts: { ownerIsCeo: boolean; hard?: boolean; personIds?: string[] } = { ownerIsCeo: false },
): Promise<TaskProposalT> {
  const companyId = companyByName(w, t.companyName) ?? w.resolution.primaryCompanyId;
  const company = companyId ? w.refs.companies.get(companyId) : null;
  const deal = dealFor(w, companyId);
  const goalId = await matchGoal(w, companyId);
  const hard = opts.hard ?? (isHardDeadline(t.dueText, t.evidence) || w.extraction.deadlines.some((d) => d.hard && d.date === t.dueDate));
  const due = t.dueDate ? dayFromKey(t.dueDate) : null;
  const scores = taskScores({
    category: w.classification.category,
    strategicScore: w.extraction.strategicRelevance.score,
    goalMatched: !!goalId,
    companyType: company?.type ?? null,
    companyRelationship: company?.relationship ?? null,
    dealValue: deal?.value ?? null,
    dealType: deal?.type ?? null,
    moneyMax: moneyMax(w),
    maxRiskSeverity: maxRiskSeverity(w),
    hard,
    ownerIsCeo: opts.ownerIsCeo,
    askedPersonally: opts.ownerIsCeo && (ceoSoleRecipient(w) || senderIsCeo(w) || w.item.kind === "MEETING_NOTES"),
    dueInDays: due ? daysBetween(w.today, due) : null,
    scientific: isScientific(w),
  });
  return {
    title: t.title.slice(0, 300),
    description: describe(w, t.description, t.evidence),
    ownerPersonId,
    ownerName: t.ownerName,
    dueDate: t.dueDate,
    dueText: t.dueText,
    hardDeadline: hard,
    priority: defaultPriority(w.classification.relevance, t.priorityHint),
    focusArea: focusAreaFor(w.classification.category, t.focusArea),
    source: sourceToItemSource(w.item.kind),
    companyId,
    goalId,
    milestoneId: null,
    meetingId: w.meetingId,
    personIds: (opts.personIds ?? w.resolution.counterpartPersonIds).slice(0, 5),
    scores,
    confidence: t.confidence,
    evidence: t.evidence,
  };
}

/** A new due date on existing work: protected (review) on CEO-touched or P0/P1 work, applied otherwise. */
async function proposeDueDate(
  w: ItemCtx,
  target: { type: "TASK" | "COMMITMENT"; id: string; title: string; dueDate: Date | null; priority: string | null; ownerId: string | null; companyId: string | null; taskId?: string | null },
  to: string,
  evidence: string | null,
  confidence: number,
): Promise<DueChange | null> {
  const next = dayFromKey(to);
  if (target.dueDate && target.dueDate.getTime() === next.getTime()) return null;
  const change: DueChange = { type: target.type, id: target.id, title: target.title, from: target.dueDate, to: next, applied: false, ownerId: target.ownerId, priority: (target.priority as DueChange["priority"]) ?? null, companyId: target.companyId };
  const proposal = {
    targetType: target.type,
    targetId: target.id,
    targetLabel: target.title,
    field: "dueDate" as const,
    from: target.dueDate ? dayKey(target.dueDate) : null,
    to,
    fromLabel: target.dueDate ? formatDay(target.dueDate) : null,
    toLabel: formatDay(next),
    changeKind: "deadline_moved",
    note: null,
    confidence,
    evidence,
  };
  // Adding a date where there was none is not a change of commitment.
  if (!target.dueDate) {
    await applyFieldChange(w, proposal);
    return null;
  }
  const taskId = target.type === "TASK" ? target.id : (target.taskId ?? null);
  const protectedWork = target.priority === "P0" || target.priority === "P1" || (taskId ? await isCeoTouchedTask(w, taskId) : false);
  if (protectedWork) {
    await queueReview(w, {
      kind: "FIELD_CHANGE",
      title: `Move deadline? ${target.title}: ${formatDay(target.dueDate)} → ${formatDay(next)}`,
      reason: PROTECTED_REASONS.DEADLINE_CHANGE,
      impact: target.priority === "P0" || target.priority === "P1" ? 4 : 3,
      confidenceScore: confidence,
      proposal,
      targetType: target.type,
      targetId: target.id,
      excerpt: evidence,
      fingerprint: `field:${target.type}:${target.id}:dueDate:${to}`,
      sensitivity: w.item.sensitivity,
    });
  } else {
    await applyFieldChange(w, proposal);
    change.applied = true;
  }
  w.written.dueChanges.push(change);
  return change;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

async function handleTaskDuplicate(w: ItemCtx, t: TaskCandidate, p: TaskProposalT) {
  w.written.tasks.push({ id: t.id, title: t.title, ownerId: t.ownerId, dueDate: p.dueDate ? dayFromKey(p.dueDate) : t.dueDate, hard: t.hardDeadline || p.hardDeadline, priority: t.priority as TaskProposalT["priority"], created: false, confidence: p.confidence, companyId: t.companyId, evidence: p.evidence, dueText: p.dueText });
  const firstTouch = !(await hasReferenceFrom(w.tx, "TASK", t.id, w.item.id));
  if (firstTouch && p.dueDate) await proposeDueDate(w, { type: "TASK", id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority, ownerId: t.ownerId, companyId: t.companyId }, p.dueDate, p.evidence, p.confidence);
  if (firstTouch && p.hardDeadline && !t.hardDeadline) await w.tx.task.update({ where: { id: t.id }, data: { hardDeadline: true } });
  if (firstTouch && p.ownerPersonId && t.ownerId && p.ownerPersonId !== t.ownerId) {
    // Owners of existing work are protected.
    await queueReview(w, {
      kind: "FIELD_CHANGE",
      title: `Change owner? ${t.title} → ${personName(w, p.ownerPersonId) ?? "new owner"}`,
      reason: PROTECTED_REASONS.OWNER_CHANGE,
      impact: 3,
      confidenceScore: p.confidence,
      proposal: { targetType: "TASK", targetId: t.id, targetLabel: t.title, field: "ownerId", from: t.ownerId, to: p.ownerPersonId, fromLabel: personName(w, t.ownerId), toLabel: personName(w, p.ownerPersonId), changeKind: "owner_changed", note: null, confidence: p.confidence, evidence: p.evidence },
      targetType: "TASK",
      targetId: t.id,
      excerpt: p.evidence,
      fingerprint: `field:TASK:${t.id}:ownerId:${p.ownerPersonId}`,
      sensitivity: w.item.sensitivity,
    });
  }
  await corroborate(w, "TASK", t.id, { excerpt: p.evidence, confidence: p.confidence });
}

/** Create, update or queue one task. `forceReview` holds back tasks whose owner could not be established. */
async function placeTask(w: ItemCtx, p: TaskProposalT, opts: { forceReview?: string | null; reviewTitle?: string } = {}) {
  const dup = await findDuplicateTask(w.tx, p.title, scope(w, p.companyId, p.ownerPersonId));
  if (dup) return handleTaskDuplicate(w, dup.record, p);

  const g = gate({ confidence: p.confidence, relevance: w.classification.relevance });
  const outcome = opts.forceReview && g.outcome === "WRITE" ? "REVIEW" : g.outcome;
  if (outcome === "WRITE") {
    const t = await createTask(w, p);
    w.written.tasks.push({ id: t.id, title: p.title, ownerId: p.ownerPersonId, dueDate: p.dueDate ? dayFromKey(p.dueDate) : null, hard: p.hardDeadline, priority: p.priority, created: true, confidence: p.confidence, companyId: p.companyId, evidence: p.evidence, dueText: p.dueText });
  } else if (outcome === "REVIEW") {
    w.written.queuedTasks.push({ title: p.title, dueDate: p.dueDate ? dayFromKey(p.dueDate) : null, evidence: p.evidence, ownerId: p.ownerPersonId });
    await queueReview(w, {
      kind: "TASK",
      title: opts.reviewTitle ?? `Possible task: ${p.title}`,
      reason: opts.forceReview ?? g.reason,
      impact: p.priority === "P0" || p.priority === "P1" ? 4 : 3,
      confidenceScore: p.confidence,
      proposal: p,
      excerpt: p.evidence,
      fingerprint: `review:TASK:${ctxKey(w)}:${shortHash(actionKey(p.title))}`,
      sensitivity: w.item.sensitivity,
    });
  }
}

async function writeTask(w: ItemCtx, t: ExtractedTaskT) {
  const owner = resolveOwner(w, t.ownerName, t.ownerIsCeo);
  if (owner.kind === "EXTERNAL") {
    // Work "owned" by someone outside CytoHub is a promise to us, not our task.
    return writeCommitment(w, {
      direction: "INBOUND",
      title: t.title,
      text: t.description ?? t.title,
      owedByName: t.ownerName,
      owedToName: null,
      companyName: t.companyName,
      dueDate: t.dueDate,
      dueText: t.dueText,
      confidence: t.confidence,
      evidence: t.evidence,
    });
  }
  let ownerPersonId: string | null = owner.kind === "UNKNOWN" ? null : owner.personId;
  let forceReview: string | null = null;
  if (owner.kind === "UNKNOWN") {
    // Unowned action items are never silently assigned: a reviewer picks the owner (the CEO by default when addressed).
    if (owner.name) forceReview = `The owner “${owner.name}” is not a known CytoHub person.`;
    else forceReview = "No owner was named for this action item.";
    if (!owner.name && ceoIsDirect(w)) ownerPersonId = w.ceo.personId;
  }
  const p = await buildTaskProposal(w, t, ownerPersonId, { ownerIsCeo: ownerPersonId === w.ceo.personId });
  await placeTask(w, p, { forceReview });
}

async function writeFollowUp(w: ItemCtx, f: IntelligenceExtraction["followUps"][number]) {
  if (/^expect\b/i.test(f.title)) {
    // "Expect follow-up from Henrik": they owe us the next step.
    return writeCommitment(w, { direction: "INBOUND", title: f.title, text: f.evidence, owedByName: f.withName, owedToName: null, companyName: null, dueDate: f.dueDate, dueText: null, confidence: f.confidence, evidence: f.evidence });
  }
  const ceoPromised = senderIsCeo(w) && /\b(i('ll| will| shall)|we('ll| will)|let me)\b/i.test(f.evidence);
  if (ceoPromised) {
    return writeCommitment(w, { direction: "OUTBOUND", title: f.title, text: f.evidence, owedByName: null, owedToName: f.withName, companyName: null, dueDate: f.dueDate, dueText: null, confidence: f.confidence, evidence: f.evidence });
  }
  const title = /^follow[ -]?up/i.test(f.title) || !f.withName ? f.title : `Follow up with ${f.withName}: ${f.title}`;
  const p = await buildTaskProposal(
    w,
    { title, description: null, ownerName: null, dueDate: f.dueDate, dueText: null, priorityHint: null, companyName: null, focusArea: null, confidence: f.confidence, evidence: f.evidence },
    w.ceo.personId,
    { ownerIsCeo: true },
  );
  await placeTask(w, p);
}

async function writeMeetingRequest(w: ItemCtx, m: IntelligenceExtraction["meetingRequests"][number]) {
  const primary = w.resolution.primaryCompanyId ? w.refs.companies.get(w.resolution.primaryCompanyId) : null;
  const who = m.withName ?? personName(w, w.resolution.counterpartPersonIds[0]) ?? (primary ? companyShortName(primary.name) : null) ?? "them";
  const times = m.proposedTimes.length ? `Proposed: ${m.proposedTimes.join("; ")}.` : null;
  const subject = /\bre:\s*(.+)$/i.exec(m.title)?.[1]?.trim() ?? null;
  const p = await buildTaskProposal(
    w,
    { title: `Schedule time with ${who}${subject ? ` re: ${subject}` : ""}`.slice(0, 300), description: [m.title, times].filter(Boolean).join(" — "), ownerName: null, dueDate: null, dueText: null, priorityHint: null, companyName: null, focusArea: null, confidence: m.confidence, evidence: m.evidence },
    w.ceo.personId,
    { ownerIsCeo: true },
  );
  await placeTask(w, p);
}

// ─── Commitments ─────────────────────────────────────────────────────────────

async function writeCommitment(w: ItemCtx, c: ExtractedCommitmentT) {
  let direction = c.direction;
  let ownerPersonId: string | null = null;
  let counterpartyPersonId: string | null = null;
  let forceReview: string | null = null;
  /** "CytoHub shall…" (contracts): an obligation of the company, owned by no one person. */
  let companyObligation = false;
  const counterpart = w.resolution.counterpartPersonIds[0] ?? null;

  if (direction === "INBOUND") {
    const o = resolveOwner(w, c.owedByName, false);
    ownerPersonId = o.kind === "EXTERNAL" ? o.personId : (externalSender(w) ?? counterpart);
    const to = resolveOwner(w, c.owedToName, false);
    counterpartyPersonId = to.kind === "TEAM" || to.kind === "CEO" ? to.personId : w.ceo.personId;
    if (!ownerPersonId) forceReview = "Could not tell who made this promise.";
  } else {
    const o = resolveOwner(w, c.owedByName, false);
    if (o.kind === "EXTERNAL") {
      // The extractor said "we owe", but the named person is outside CytoHub.
      direction = "INBOUND";
      ownerPersonId = o.personId;
      counterpartyPersonId = w.ceo.personId;
    } else {
      if (o.kind === "CEO" || o.kind === "TEAM") ownerPersonId = o.personId;
      else if (companyLevel(c.owedByName)) companyObligation = true;
      else if (senderIsCeo(w) || (!c.owedByName && w.item.kind === "MEETING_NOTES")) ownerPersonId = w.ceo.personId;
      else {
        const sender = w.resolution.people.find((p) => p.role === "SENDER" || p.role === "ORGANIZER");
        if (sender && (sender.isCeo || w.refs.people.get(sender.id)?.type === "TEAM")) ownerPersonId = sender.id;
      }
      const to = resolveOwner(w, c.owedToName, false);
      counterpartyPersonId = to.kind === "UNKNOWN" ? (direction === "INTERNAL" ? w.ceo.personId : counterpart) : to.personId;
      if (!ownerPersonId && !companyObligation) forceReview = `Could not tell who at CytoHub owns this${c.owedByName ? ` (“${c.owedByName}”)` : ""}.`;
    }
  }

  const ownerRow = ownerPersonId ? w.refs.people.get(ownerPersonId) : null;
  const companyId = companyByName(w, c.companyName) ?? (direction === "INBOUND" ? ownerRow?.companyId : w.refs.people.get(counterpartyPersonId ?? "")?.companyId) ?? w.resolution.primaryCompanyId;
  const deal = dealFor(w, companyId ?? null);
  const ceoOwes = ownerPersonId === w.ceo.personId && direction !== "INBOUND";
  const task = await buildTaskProposal(
    w,
    { title: c.title, description: c.text, ownerName: c.owedByName, dueDate: c.dueDate, dueText: c.dueText, priorityHint: null, companyName: c.companyName, focusArea: null, confidence: c.confidence, evidence: c.evidence },
    ownerPersonId,
    { ownerIsCeo: ceoOwes, hard: true, personIds: counterpartyPersonId && counterpartyPersonId !== w.ceo.personId ? [counterpartyPersonId] : [] },
  );
  const proposal: CommitmentProposalT = {
    direction,
    title: c.title.slice(0, 300),
    text: c.text.slice(0, 1000),
    ownerPersonId,
    counterpartyPersonId,
    companyId: companyId ?? null,
    threadId: w.threadId,
    meetingId: w.meetingId,
    dealId: deal?.id ?? null,
    goalId: task.goalId,
    projectId: w.resolution.projects[0]?.id ?? null,
    dueDate: c.dueDate,
    dueText: c.dueText,
    followUpDate: null,
    mirrorTask: ceoOwes,
    linkTaskId: null,
    priority: task.priority,
    focusArea: task.focusArea,
    scores: { ...task.scores, ceoUniqueness: ceoOwes ? 5 : task.scores.ceoUniqueness },
    confidence: c.confidence,
    evidence: c.evidence,
  };

  const fingerprint = commitmentFingerprint(direction, proposal.companyId ?? counterpartyPersonId, c.title, w.threadId ?? w.meetingId);
  const dup = await findDuplicateCommitment(w.tx, c.title, direction, { ...scope(w, proposal.companyId, ownerPersonId), fingerprint, counterpartyPersonId: direction === "INBOUND" ? ownerPersonId : counterpartyPersonId });
  if (dup) {
    const r = dup.record;
    w.written.commitments.push({ id: r.id, title: r.title, direction, ownerPersonId: r.ownerPersonId, counterpartyPersonId: r.counterpartyPersonId, dueDate: c.dueDate ? dayFromKey(c.dueDate) : r.dueDate, dueText: c.dueText ?? r.dueText, taskId: r.taskId, created: false, confidence: c.confidence, companyId: r.companyId });
    const firstTouch = !(await hasReferenceFrom(w.tx, "COMMITMENT", r.id, w.item.id));
    if (firstTouch && c.dueDate) {
      const mirrored = r.taskId ? await w.tx.task.findUnique({ where: { id: r.taskId }, select: { priority: true } }) : null;
      await proposeDueDate(w, { type: "COMMITMENT", id: r.id, title: r.title, dueDate: r.dueDate, priority: mirrored?.priority ?? null, ownerId: r.ownerPersonId, companyId: r.companyId, taskId: r.taskId }, c.dueDate, c.evidence, c.confidence);
    }
    await corroborate(w, "COMMITMENT", r.id, { excerpt: c.evidence, confidence: c.confidence });
    return;
  }

  if (ceoOwes) {
    // The CEO may already have a task for this (from the inbound ask): make it the mirror.
    const t = await findDuplicateTask(w.tx, c.title, scope(w, proposal.companyId, ownerPersonId));
    if (t && !t.record.commitment) proposal.linkTaskId = t.record.id;
  }

  const g = gate({ confidence: c.confidence, relevance: w.classification.relevance });
  const outcome = forceReview && g.outcome === "WRITE" ? "REVIEW" : g.outcome;
  if (outcome === "WRITE") {
    const res = await createCommitment(w, proposal);
    if (proposal.linkTaskId && res.taskId === proposal.linkTaskId) {
      await reference(w, "TASK", proposal.linkTaskId, "UPDATED_FROM", { excerpt: c.evidence, confidence: c.confidence });
      if (c.dueDate) {
        const linked = await w.tx.task.findUnique({ where: { id: proposal.linkTaskId }, select: { dueDate: true, priority: true, title: true, ownerId: true, companyId: true } });
        if (linked) await proposeDueDate(w, { type: "TASK", id: proposal.linkTaskId, title: linked.title, dueDate: linked.dueDate, priority: linked.priority, ownerId: linked.ownerId, companyId: linked.companyId }, c.dueDate, c.evidence, c.confidence);
      }
      noteUpdated(w, "TASK", proposal.linkTaskId);
    }
    w.written.commitments.push({ id: res.id, title: proposal.title, direction, ownerPersonId, counterpartyPersonId, dueDate: c.dueDate ? dayFromKey(c.dueDate) : null, dueText: c.dueText, taskId: res.taskId, created: res.created, confidence: c.confidence, companyId: proposal.companyId });
  } else if (outcome === "REVIEW") {
    const party = personName(w, direction === "INBOUND" ? ownerPersonId : counterpartyPersonId);
    await queueReview(w, {
      kind: "COMMITMENT",
      title: `Possible commitment (${direction === "INBOUND" ? "owed to us" : "we owe"}): ${proposal.title}${party ? ` — ${party}` : ""}`,
      reason: forceReview ?? g.reason,
      impact: ceoOwes ? 4 : 3,
      confidenceScore: c.confidence,
      proposal,
      excerpt: c.evidence,
      fingerprint: `review:COMMITMENT:${fingerprint}`,
      sensitivity: w.item.sensitivity,
    });
  }
}

function companyLevel(name: string | null | undefined): boolean {
  return !!name && /^(cytohub(\s+(inc|ltd|llc|gmbh))?\.?|we|us|the company|the team|our team)$/i.test(name.trim());
}

// ─── Decisions ───────────────────────────────────────────────────────────────

interface OpenDecision {
  id: string;
  title: string;
  deadline: Date | null;
  status: string;
}

/**
 * The open Decision this extraction is about. Beyond title similarity, a
 * decision that names the same people or companies as the item matches on
 * weaker wording ("Decide on the offer package" ↔ "Hire Laura Mitchell as VP
 * Sales at the requested package?", whose context lists the package).
 */
async function matchOpenDecision(w: ItemCtx, d: { title: string; decision: string | null; evidence: string }): Promise<OpenDecision | null> {
  const open = await w.tx.decision.findMany({
    where: { status: { in: ["NEEDED", "WAITING_INFO", "DEFERRED"] } },
    select: { id: true, title: true, context: true, deadline: true, status: true, companies: { select: { id: true, name: true } } },
    take: 300,
  });
  const companies = new Set(w.resolution.companies.map((c) => c.id));
  const itemText = stripAccents(`${w.item.title}\n${w.item.text ?? ""}`).toLowerCase();
  const names = w.resolution.people
    .filter((p) => !p.isCeo)
    .flatMap((p) => {
      const n = normalizePersonName(p.label);
      const last = n.split(" ").slice(-1)[0];
      return [n, ...(last && last.length >= 4 ? [last] : [])];
    });
  const asked = `${d.title} ${d.decision ?? ""}`;
  let best: { o: OpenDecision; score: number } | null = null;
  for (const o of open) {
    const hay = `${o.title} ${o.context ?? ""}`;
    const hayNorm = stripAccents(hay).toLowerCase();
    const sharedCompany = o.companies.some((c) => companies.has(c.id) || itemText.includes(companyShortName(c.name).toLowerCase()));
    const titleNames = (o.title.match(/\b[A-Z][a-z]+ [A-Z][a-z]+\b/g) ?? []).map((x) => stripAccents(x).toLowerCase());
    const sharedPerson = names.some((n) => hayNorm.includes(n)) || titleNames.some((n) => itemText.includes(n));
    const score = Math.max(actionSimilarity(asked, o.title), tokenCoverage(d.title, hay) * 0.9, tokenCoverage(d.evidence, hay) * 0.8);
    if (score >= (sharedCompany || sharedPerson ? 0.45 : 0.75) && (!best || score > best.score)) best = { o, score };
  }
  return best?.o ?? null;
}

async function writeDecision(w: ItemCtx, d: ExtractedDecisionT) {
  const open = await matchOpenDecision(w, d);
  const match = open?.id ?? null;
  const goalId = await matchGoal(w, w.resolution.primaryCompanyId);
  const category = w.classification.category;
  const impact = Math.max(Math.round(1 + 4 * w.extraction.strategicRelevance.score), category === "BOARD" || category === "INVESTOR" || category === "FUNDRAISING" ? 4 : 3);
  const proposal = {
    status: d.status,
    title: d.title.slice(0, 300),
    decision: d.decision,
    context: describe(w, d.decision, d.evidence),
    decidedByName: d.decidedByName,
    ownerPersonId: w.ceo.personId,
    deadline: d.deadline,
    options: d.options,
    matchDecisionId: match,
    meetingId: w.meetingId,
    goalId,
    companyIds: w.resolution.primaryCompanyId ? [w.resolution.primaryCompanyId] : [],
    strategicImpact: Math.min(5, impact),
    confidence: d.confidence,
    evidence: d.evidence,
  };

  if (d.status === "MADE") {
    // Recording a decision as made is protected: always a human.
    const g = gate({ confidence: d.confidence, relevance: w.classification.relevance, protectedClass: "DECISION_MADE" });
    if (g.outcome === "DROP") return;
    const id = await queueReview(w, {
      kind: "DECISION",
      title: `Decision made? ${cleanDecisionTitle(d.title)}`,
      reason: `${g.reason}${match ? " It appears to resolve an open decision." : ""}`,
      impact: proposal.strategicImpact,
      confidenceScore: d.confidence,
      proposal,
      targetType: match ? "DECISION" : null,
      targetId: match,
      excerpt: d.evidence,
      fingerprint: `review:DECISION:MADE:${match ?? ctxKey(w)}:${shortHash(actionKey(d.title))}`,
      sensitivity: w.item.sensitivity,
    });
    w.written.decisions.push({ id: match ?? id, title: open?.title ?? d.title, status: "MADE", deadline: null, created: false, queued: true });
    return;
  }

  if (open) {
    // The same open decision raised again: link the source; a different deadline is a protected change.
    if (open.deadline && d.deadline && dayKey(open.deadline) !== d.deadline) {
      const g = gate({ confidence: d.confidence, relevance: w.classification.relevance, protectedClass: "DEADLINE_CHANGE" });
      if (g.outcome === "REVIEW") {
        await queueReview(w, {
          kind: "FIELD_CHANGE",
          title: `Move decision deadline? ${cleanDecisionTitle(open.title)}: ${formatDay(open.deadline)} → ${formatDay(dayFromKey(d.deadline))}`,
          reason: g.reason,
          impact: proposal.strategicImpact,
          confidenceScore: d.confidence,
          proposal: { targetType: "DECISION", targetId: open.id, targetLabel: open.title, field: "deadline", from: dayKey(open.deadline), to: d.deadline, fromLabel: formatDay(open.deadline), toLabel: formatDay(dayFromKey(d.deadline)), changeKind: "deadline_moved", note: null, confidence: d.confidence, evidence: d.evidence },
          targetType: "DECISION",
          targetId: open.id,
          excerpt: d.evidence,
          fingerprint: `field:DECISION:${open.id}:deadline:${d.deadline}`,
          sensitivity: w.item.sensitivity,
        });
      }
      await applyDecision(w, { ...proposal, deadline: null });
    } else {
      await applyDecision(w, proposal);
    }
    const deadline = open.deadline ?? (d.deadline ? dayFromKey(d.deadline) : null);
    w.written.decisions.push({ id: open.id, title: open.title, status: "NEEDED", deadline, created: false, queued: false });
    return;
  }
  const g = gate({ confidence: d.confidence, relevance: w.classification.relevance });
  if (g.outcome === "WRITE") {
    const r = await applyDecision(w, proposal);
    w.written.decisions.push({ id: r.id, title: d.title, status: "NEEDED", deadline: d.deadline ? dayFromKey(d.deadline) : null, created: r.created, queued: false });
  } else if (g.outcome === "REVIEW") {
    const id = await queueReview(w, {
      kind: "DECISION",
      title: `Decision needed? ${cleanDecisionTitle(d.title)}`,
      reason: g.reason,
      impact: proposal.strategicImpact,
      confidenceScore: d.confidence,
      proposal,
      excerpt: d.evidence,
      fingerprint: `review:DECISION:NEEDED:${ctxKey(w)}:${shortHash(actionKey(d.title))}`,
      sensitivity: w.item.sensitivity,
    });
    w.written.decisions.push({ id, title: d.title, status: "NEEDED", deadline: d.deadline ? dayFromKey(d.deadline) : null, created: false, queued: true });
  }
}

// ─── Deadlines ───────────────────────────────────────────────────────────────

async function writeDeadline(w: ItemCtx, d: IntelligenceExtraction["deadlines"][number]) {
  // The extractor repeats the date of an ask it also reported as a task, commitment, decision or
  // risk from the same sentence: that record already carries the date (and its firmness).
  const sentences = sentencesOf(w.item.text ?? "");
  const x = w.extraction;
  const others = [...x.tasks, ...x.commitments, ...x.followUps, ...x.decisions, ...x.risks, ...x.opportunities, ...x.meetingRequests].map((r) => r.evidence);
  const covered =
    others.some((e) => sameSentence(d.evidence, e, sentences)) ||
    [...x.tasks, ...x.commitments].some((r) => titleKey(r.title) === titleKey(d.what) && r.dueDate === d.date);
  const ms = milestoneFor(w, d.what);
  if (covered) {
    if (ms) await milestoneDate(w, ms, d);
    return;
  }

  // 1. Work written from this item.
  const local = [
    ...w.written.tasks.map((t) => ({ type: "TASK" as const, id: t.id, title: t.title, score: actionSimilarity(d.what, t.title) })),
    ...w.written.commitments.map((c) => ({ type: "COMMITMENT" as const, id: c.id, title: c.title, score: actionSimilarity(d.what, c.title) })),
  ].sort((a, b) => b.score - a.score)[0];
  let target: { type: "TASK" | "COMMITMENT"; id: string } | null = local && local.score >= 0.5 ? local : null;

  // 2. Existing open work in the same thread / meeting / company.
  if (!target) {
    const t = await findDuplicateTask(w.tx, d.what, scope(w, null, null));
    if (t) target = { type: "TASK", id: t.record.id };
  }
  if (!target) {
    const c = await findDuplicateCommitment(w.tx, d.what, "INBOUND", { ...scope(w, null, null), fingerprint: "-" });
    const o = c ?? (await findDuplicateCommitment(w.tx, d.what, "OUTBOUND", { ...scope(w, null, null), fingerprint: "-" }));
    if (o) target = { type: "COMMITMENT", id: o.record.id };
  }

  if (target?.type === "TASK") {
    const t = await w.tx.task.findUnique({ where: { id: target.id }, select: { id: true, title: true, dueDate: true, priority: true, ownerId: true, companyId: true, hardDeadline: true } });
    if (t) {
      if (!t.dueDate || dayKey(t.dueDate) !== d.date) {
        if (!(t.dueDate && w.written.tasks.some((x) => x.id === t.id && x.created))) await proposeDueDate(w, { type: "TASK", id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority, ownerId: t.ownerId, companyId: t.companyId }, d.date, d.evidence, d.confidence);
      }
      if (d.hard && !t.hardDeadline) await w.tx.task.update({ where: { id: t.id }, data: { hardDeadline: true } });
      return;
    }
  }
  if (target?.type === "COMMITMENT") {
    const c = await w.tx.commitment.findUnique({ where: { id: target.id }, select: { id: true, title: true, dueDate: true, ownerPersonId: true, companyId: true, taskId: true, task: { select: { priority: true } } } });
    if (c) {
      if (!c.dueDate || dayKey(c.dueDate) !== d.date) {
        if (!(c.dueDate && w.written.commitments.some((x) => x.id === c.id && x.created))) await proposeDueDate(w, { type: "COMMITMENT", id: c.id, title: c.title, dueDate: c.dueDate, priority: c.task?.priority ?? null, ownerId: c.ownerPersonId, companyId: c.companyId, taskId: c.taskId }, d.date, d.evidence, d.confidence);
      }
      return;
    }
  }

  // 3. A milestone date: later than planned means it is slipping (protected).
  if (ms) return milestoneDate(w, ms, d);

  // 4. Nothing to attach to: a reviewer only sees firm dates the CEO owns or was asked about, on important sources.
  const ceoNames = [w.ceo.name, w.ceo.name.split(" ")[0], "CEO"];
  const concernsCeo = ceoIsDirect(w) && !thirdPartyActor(d.evidence, ceoNames) && !thirdPartyActor(d.what, ceoNames);
  if (!concernsCeo || !isLoud(w) || !d.hard) return;
  const g = gate({ confidence: d.confidence, relevance: w.classification.relevance });
  if (g.outcome === "DROP") return;
  const companyId = w.resolution.primaryCompanyId;
  await queueReview(w, {
    kind: "DEADLINE",
    title: `Deadline: ${cleanTitle(d.what)} — ${formatDay(dayFromKey(d.date))}`,
    reason: "A firm date for the CEO that is not attached to any task yet.",
    impact: 4,
    confidenceScore: d.confidence,
    proposal: {
      what: cleanTitle(d.what, 300),
      date: d.date,
      hard: d.hard,
      targetType: null,
      targetId: null,
      ownerPersonId: w.ceo.personId,
      companyId,
      goalId: await matchGoal(w, companyId),
      meetingId: w.meetingId,
      priority: defaultPriority(w.classification.relevance),
      focusArea: focusAreaFor(w.classification.category),
      confidence: d.confidence,
      evidence: d.evidence,
    },
    excerpt: d.evidence,
    fingerprint: `review:DEADLINE:${ctxKey(w)}:${d.date}:${shortHash(actionKey(d.what))}`,
    sensitivity: w.item.sensitivity,
  });
}

function milestoneFor(w: ItemCtx, what: string) {
  return w.refs.milestones
    .map((m) => ({ m, score: Math.max(actionSimilarity(what, m.title), tokenCoverage(m.title, what) * 0.9) }))
    .filter((x) => x.score >= 0.6)
    .sort((a, b) => b.score - a.score)[0]?.m;
}

/** A dated statement about a milestone: a later date means it is slipping (protected change + insight). */
async function milestoneDate(w: ItemCtx, ms: ItemCtx["refs"]["milestones"][number], d: IntelligenceExtraction["deadlines"][number]) {
  const next = dayFromKey(d.date);
  if (next.getTime() === ms.dueDate.getTime()) return;
  const slipped = next > ms.dueDate;
  const gateResult = gate({ confidence: d.confidence, relevance: w.classification.relevance, protectedClass: "MILESTONE_DATE_CHANGE" });
  if (gateResult.outcome === "DROP") return;
  await queueReview(w, {
    kind: "FIELD_CHANGE",
    title: `${slipped ? "Milestone slipping" : "Milestone date change"}? ${ms.title}: ${formatDay(ms.dueDate)} → ${formatDay(next)}`,
    reason: PROTECTED_REASONS.MILESTONE_DATE_CHANGE,
    impact: 4,
    confidenceScore: d.confidence,
    proposal: { targetType: "MILESTONE", targetId: ms.id, targetLabel: ms.title, field: "dueDate", from: dayKey(ms.dueDate), to: d.date, fromLabel: formatDay(ms.dueDate), toLabel: formatDay(next), changeKind: slipped ? "milestone_slipped" : "milestone_date_changed", note: null, confidence: d.confidence, evidence: d.evidence },
    targetType: "MILESTONE",
    targetId: ms.id,
    excerpt: d.evidence,
    fingerprint: `field:MILESTONE:${ms.id}:dueDate:${d.date}`,
    sensitivity: w.item.sensitivity,
  });
  if (slipped) {
    await raiseChange(w, {
      changeKind: "milestone_slipped",
      fingerprint: `change:milestone_slipped:${ms.id}:${d.date}`,
      title: `Important change: “${ms.title}” is slipping — ${formatDay(ms.dueDate)} → ${formatDay(next)}`,
      summary: `${w.item.title} puts this milestone ${daysBetween(ms.dueDate, next)} days late. Impact: the goal it supports and any dependent board or customer commitments.`,
      recommendation: "Confirm the new date with the owner, then approve the date change in the Review Queue or push back.",
      importance: 4,
      requiresCeo: true,
      links: { milestoneId: ms.id, goalId: ms.goalId },
      excerpt: d.evidence,
      confidence: d.confidence,
    });
  }
}

// ─── Risks & opportunities ───────────────────────────────────────────────────

async function writeRisk(w: ItemCtx, r: ExtractedRiskT) {
  const companyId = companyByName(w, r.companyName) ?? w.resolution.primaryCompanyId;
  const open = await w.tx.risk.findMany({ where: { status: { in: ["OPEN", "MONITORING"] }, companyId: companyId ?? null }, select: { id: true, title: true, category: true }, take: 200 });
  const match = open
    .map((x) => ({ x, score: actionSimilarity(r.title, x.title) + (x.category === r.category ? 0.1 : 0) }))
    .filter((m) => m.score >= 0.5)
    .sort((a, b) => b.score - a.score)[0]?.x;
  const deal = dealFor(w, companyId);
  const milestone = w.refs.milestones.map((m) => ({ m, s: tokenCoverage(m.title, `${r.title} ${r.description ?? ""}`) })).filter((x) => x.s >= 0.7).sort((a, b) => b.s - a.s)[0]?.m;
  const proposal = {
    title: r.title,
    description: describe(w, r.description, r.evidence),
    category: r.category,
    severity: r.severity,
    likelihood: null,
    companyId,
    dealId: deal?.id ?? null,
    goalId: (await matchGoal(w, companyId)) ?? milestone?.goalId ?? null,
    milestoneId: milestone?.id ?? null,
    projectId: w.resolution.projects[0]?.id ?? null,
    ownerPersonId: null,
    confidence: r.confidence,
    evidence: r.evidence,
  };
  if (match) {
    const res = await createRisk(w, proposal, { matchRiskId: match.id });
    w.written.risks.push({ id: res.id, title: match.title, severity: res.severity, created: false, companyId });
    return;
  }
  const g = gate({ confidence: r.confidence, relevance: w.classification.relevance });
  if (g.outcome === "WRITE") {
    const res = await createRisk(w, proposal);
    w.written.risks.push({ id: res.id, title: r.title, severity: res.severity, created: res.created, companyId });
  } else if (g.outcome === "REVIEW") {
    await queueReview(w, {
      kind: "RISK",
      title: `Potential risk: ${r.title}`,
      reason: g.reason,
      impact: r.severity,
      confidenceScore: r.confidence,
      proposal,
      excerpt: r.evidence,
      fingerprint: `review:RISK:${riskFingerprint(companyId, r.category, r.title)}`,
      sensitivity: w.item.sensitivity,
    });
  }
}

async function writeOpportunity(w: ItemCtx, o: ExtractedOpportunityT) {
  const companyId = companyByName(w, o.companyName) ?? w.resolution.primaryCompanyId;
  const open = await w.tx.opportunity.findMany({ where: { status: { in: ["OPEN", "PURSUING"] }, companyId: companyId ?? null }, select: { id: true, title: true, kind: true }, take: 200 });
  const match = open
    .map((x) => ({ x, score: actionSimilarity(o.title, x.title) + (x.kind === o.kind ? 0.1 : 0) }))
    .filter((m) => m.score >= 0.5)
    .sort((a, b) => b.score - a.score)[0]?.x;
  const deal = dealFor(w, companyId);
  const proposal = {
    title: o.title,
    description: describe(w, o.description, o.evidence),
    kind: o.kind,
    estimatedValue: o.estimatedValue,
    nextStep: w.extraction.recommendedActions[0]?.action ?? null,
    companyId,
    personId: w.resolution.counterpartPersonIds[0] ?? null,
    dealId: deal?.id ?? null,
    goalId: await matchGoal(w, companyId),
    projectId: w.resolution.projects[0]?.id ?? null,
    confidence: o.confidence,
    evidence: o.evidence,
  };
  if (match) {
    const res = await createOpportunity(w, proposal, { matchOpportunityId: match.id });
    w.written.opportunities.push({ id: res.id, title: match.title, value: o.estimatedValue, created: false, companyId });
    return;
  }
  const g = gate({ confidence: o.confidence, relevance: w.classification.relevance });
  if (g.outcome === "WRITE") {
    const res = await createOpportunity(w, proposal);
    w.written.opportunities.push({ id: res.id, title: o.title, value: o.estimatedValue, created: res.created, companyId });
  } else if (g.outcome === "REVIEW") {
    await queueReview(w, {
      kind: "OPPORTUNITY",
      title: `Potential opportunity: ${o.title}${o.estimatedValue ? ` (${formatMoney(o.estimatedValue)})` : ""}`,
      reason: g.reason,
      impact: (o.estimatedValue ?? 0) >= 500_000 ? 4 : 3,
      confidenceScore: o.confidence,
      proposal,
      excerpt: o.evidence,
      fingerprint: `review:OPPORTUNITY:${opportunityFingerprint(companyId, o.kind, o.title)}`,
      sensitivity: w.item.sensitivity,
    });
  }
}

// ─── Facts & documents ───────────────────────────────────────────────────────

const DEAL_VALUE_LABEL = /\b(proposal|contract|deal|msa|sow|total|value|price|pricing|fee|fees|annual|renewal|licen[cs]e|quote|budget|tcv|acv)\b/i;

async function writeFacts(w: ItemCtx) {
  const facts = w.extraction.facts;
  if (w.item.document && (facts.length || w.extraction.summary)) {
    await w.tx.document.update({
      where: { id: w.item.document.id },
      data: {
        ...(facts.length ? { keyFacts: facts.map((f) => ({ label: f.label, value: f.value, kind: f.kind, numericValue: f.numericValue })) as Prisma.InputJsonValue } : {}),
        ...(w.extraction.summary ? { summary: w.extraction.summary.slice(0, 2000) } : {}),
      },
    });
  }

  // A stated value for the open commercial deal that differs from the pipeline: protected change + insight.
  const deal = dealFor(w, w.resolution.primaryCompanyId);
  if (!deal || deal.type === "FUNDRAISING" || deal.value == null) return;
  const fact = facts.find((f) => f.kind === "MONEY" && f.numericValue != null && f.numericValue >= 10_000 && DEAL_VALUE_LABEL.test(f.label));
  if (!fact || fact.numericValue == null) return;
  const to = fact.numericValue;
  if (Math.abs(to - deal.value) / Math.max(1, deal.value) <= 0.01) return;
  const g = gate({ confidence: 0.85, relevance: w.classification.relevance, protectedClass: "DEAL_VALUE_CHANGE" });
  if (g.outcome === "DROP") return;
  await queueReview(w, {
    kind: "FIELD_CHANGE",
    title: `Update deal value? ${deal.name}: ${formatMoney(deal.value)} → ${formatMoney(to)}`,
    reason: PROTECTED_REASONS.DEAL_VALUE_CHANGE,
    impact: 4,
    confidenceScore: 0.85,
    proposal: { targetType: "DEAL", targetId: deal.id, targetLabel: deal.name, field: "value", from: deal.value, to, fromLabel: formatMoney(deal.value), toLabel: formatMoney(to), changeKind: "proposal_value_changed", note: `${fact.label}: ${fact.value}`, confidence: 0.85, evidence: fact.evidence },
    targetType: "DEAL",
    targetId: deal.id,
    excerpt: fact.evidence,
    fingerprint: `field:DEAL:${deal.id}:value:${to}`,
    sensitivity: w.item.sensitivity,
  });
  const company = deal.companyId ? w.refs.companies.get(deal.companyId) : null;
  const up = to > deal.value;
  await raiseChange(w, {
    changeKind: "proposal_value_changed",
    fingerprint: `change:proposal_value_changed:${deal.id}:${to}`,
    title: `Important change: ${company ? companyShortName(company.name) : deal.name} proposal value changed from ${formatMoney(deal.value)} to ${formatMoney(to)}`,
    summary: `${fact.label}: ${fact.value} (pipeline shows ${formatMoney(deal.value)}). Impact: ${up ? "upside to" : "pressure on"} the revenue plan and the deal's ${deal.stage} stage.`,
    recommendation: up ? "Confirm the scope behind the higher value and update the forecast." : "Find out what drove the reduction before the next negotiation.",
    importance: Math.abs(to - deal.value) >= 250_000 ? 5 : 4,
    requiresCeo: deal.ownerId === w.ceo.personId || Math.abs(to - deal.value) >= 250_000,
    links: { dealId: deal.id, companyId: deal.companyId },
    excerpt: fact.evidence,
    confidence: 0.85,
  });
}

const RESOURCE_TYPE: Partial<Record<string, ResourceType>> = {
  INVESTOR_DECK: "PRESENTATION",
  SALES_MATERIAL: "PRESENTATION",
  FUNDRAISING_MATERIAL: "PRESENTATION",
  FINANCIAL_MODEL: "FINANCIAL_MODEL",
  CUSTOMER_CONTRACT: "CONTRACT",
  NDA: "CONTRACT",
  LEGAL_DOCUMENT: "CONTRACT",
  PARTNERSHIP_AGREEMENT: "CONTRACT",
  MEETING_NOTES: "MEETING_NOTES",
  PUBLICATION: "SCIENTIFIC_PAPER",
  SCIENTIFIC_REPORT: "SCIENTIFIC_PAPER",
  EXPERIMENT_REPORT: "SCIENTIFIC_PAPER",
  SCIENTIFIC_DATA_SUMMARY: "DATASET",
};

/** Mirror the document into the Resource Center with the Brain's summary and links. */
async function writeDocument(w: ItemCtx) {
  const doc = await w.tx.document.findUnique({ where: { id: w.item.document!.id }, select: { id: true, title: true, docType: true, url: true, resourceId: true, companyId: true, projectId: true } });
  if (!doc) return;
  const companies = w.resolution.companies.filter((c) => c.confidence >= 0.8).map((c) => ({ id: c.id }));
  const people = w.resolution.people.filter((p) => p.confidence >= 0.85 && !p.isCeo).map((p) => ({ id: p.id }));
  const goalId = await matchGoal(w, w.resolution.primaryCompanyId);
  const links = {
    ...(companies.length ? { companies: { connect: companies } } : {}),
    ...(people.length ? { people: { connect: people.slice(0, 20) } } : {}),
    ...(goalId ? { goals: { connect: [{ id: goalId }] } } : {}),
  };
  const summary = w.extraction.summary?.slice(0, 2000) || null;
  let resourceId = doc.resourceId;
  if (resourceId && (await w.tx.resource.count({ where: { id: resourceId } }))) {
    await w.tx.resource.update({ where: { id: resourceId }, data: { ...(summary ? { summary } : {}), ...links } });
    if (!(await hasReferenceFrom(w.tx, "RESOURCE", resourceId, w.item.id))) await reference(w, "RESOURCE", resourceId, "UPDATED_FROM", { excerpt: summary });
    noteUpdated(w, "RESOURCE", resourceId);
  } else {
    const r = await w.tx.resource.create({
      data: { title: doc.title, type: RESOURCE_TYPE[doc.docType] ?? "DOCUMENT", url: doc.url, summary, source: "DOCUMENT", tags: [doc.docType.toLowerCase()], ...links, createdAt: w.now },
    });
    resourceId = r.id;
    await w.tx.document.update({ where: { id: doc.id }, data: { resourceId } });
    await recordActivity(w, "RESOURCE_ADDED", `Document added to the Resource Center: ${doc.title}`, { documentId: doc.id, companyId: w.resolution.primaryCompanyId, goalId });
    await reference(w, "RESOURCE", resourceId, "CREATED_FROM", { excerpt: summary });
    noteCreated(w, "RESOURCE", resourceId);
  }
  const project = w.resolution.projects.find((p) => p.confidence >= 0.8);
  const patch: Prisma.DocumentUncheckedUpdateInput = {};
  if (!doc.companyId && w.resolution.primaryCompanyId) patch.companyId = w.resolution.primaryCompanyId;
  if (!doc.projectId && project) patch.projectId = project.id;
  if (Object.keys(patch).length) await w.tx.document.update({ where: { id: doc.id }, data: patch });
}

// ─── Relationships stated in the content ─────────────────────────────────────

async function writeExtractedRelationships(w: ItemCtx) {
  const idFor = (type: string, name: string): { type: "PERSON" | "COMPANY" | "PROJECT"; id: string } | null => {
    if (type === "PERSON") {
      const n = normalizePersonName(name);
      const p = w.resolution.people.find((x) => normalizePersonName(x.label) === n);
      return p ? { type: "PERSON", id: p.id } : null;
    }
    if (type === "COMPANY") {
      const id = companyByName(w, name);
      return id ? { type: "COMPANY", id } : null;
    }
    const pr = w.resolution.projects.find((x) => x.label.toLowerCase() === name.toLowerCase());
    return pr ? { type: "PROJECT", id: pr.id } : null;
  };
  for (const r of w.extraction.relationships) {
    if (r.confidence < 0.8) continue;
    const from = idFor(r.fromType, r.fromName);
    const to = idFor(r.toType, r.toName);
    if (!from || !to) continue;
    await upsertRelationship(w.tx, { fromType: from.type, fromId: from.id, relation: r.relation, toType: to.type, toId: to.id, confidence: r.confidence * 0.9, sourceItemId: w.item.id, at: w.item.occurredAt < w.now ? w.item.occurredAt : w.now, metadata: { basis: "extraction" } });
  }
}

// ─── Risk resolution ─────────────────────────────────────────────────────────

const RESOLVED_CUE = /\b(resolved|fixed|no longer (a |an )?(issue|concern|problem|risk)|back on track|cleared|closed out|sorted out|unblocked|agreed|we have agreement|signed off|mitigated|addressed)\b/i;

/** "The turnaround issue is resolved" → close the matching open risk (HIGH) or ask (FIELD_CHANGE review). */
async function detectRiskResolution(w: ItemCtx) {
  const text = w.item.text ?? "";
  if (!text || !RESOLVED_CUE.test(text)) return;
  const companyId = w.resolution.primaryCompanyId;
  const risks = await w.tx.risk.findMany({ where: { status: { in: ["OPEN", "MONITORING"] }, ...(companyId ? { companyId } : {}) }, select: { id: true, title: true, createdAt: true }, take: 100 });
  if (!risks.length) return;
  const sentences = text
    .replace(/([.!?])\s+/g, "$1\n")
    .split(/\n+/)
    .filter((s) => RESOLVED_CUE.test(s));
  for (const r of risks) {
    if (w.written.risks.some((x) => x.id === r.id)) continue;
    const best = Math.max(0, ...sentences.map((s) => tokenCoverage(r.title, s)));
    if (best < 0.4) continue;
    const sentence = sentences.find((s) => tokenCoverage(r.title, s) === best) ?? null;
    const proposal = { targetType: "RISK" as const, targetId: r.id, targetLabel: r.title, field: "status" as const, from: "OPEN", to: "RESOLVED", fromLabel: "Open", toLabel: "Resolved", changeKind: "risk_resolved", note: sentence, confidence: Math.min(0.95, 0.5 + best / 2), evidence: sentence };
    if (best >= 0.6 && companyId) {
      await applyFieldChange(w, proposal);
    } else {
      await queueReview(w, {
        kind: "FIELD_CHANGE",
        title: `Risk resolved? ${r.title}`,
        reason: "The source suggests this risk is resolved, but the match is not certain.",
        impact: 3,
        confidenceScore: proposal.confidence,
        proposal,
        targetType: "RISK",
        targetId: r.id,
        excerpt: sentence,
        fingerprint: `field:RISK:${r.id}:status:RESOLVED`,
        sensitivity: w.item.sensitivity,
      });
    }
  }
}
