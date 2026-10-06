/**
 * Signal understanding: turns ingested BrainSignals into insights, inbox items
 * and (for commitments) tasks.
 *
 * Connectors may attach a structured `metadata.signalType` (CRM stage changes
 * are structured at the source; an LLM extraction step can label email).
 * When absent, a conservative keyword classifier is used.
 */
import type { FocusArea, InboxType, InsightType, Priority } from "@/generated/prisma/enums";
import type { BrainSignal } from "@/generated/prisma/client";
import { addDays, dayKey, parseDayInput } from "@/lib/dates";
import type { BrainContext, InsightDraft } from "../types";

export type SignalType =
  | "deal_stage_change"
  | "deal_won"
  | "deal_lost"
  | "commitment"
  | "response_needed"
  | "customer_issue"
  | "escalation"
  | "decision_request"
  | "approval_request"
  | "hiring_decision"
  | "investor_request"
  | "opportunity"
  | "risk"
  | "development"
  | "deadline"
  | "milestone_reached";

export interface SignalMetadata {
  signalType?: SignalType;
  importance?: number;
  requiresCeo?: boolean;
  summary?: string;
  recommendation?: string;
  whyCeo?: string;
  recommendedAction?: string;
  urgency?: number;
  dueDate?: string;
  stageFrom?: string;
  stageTo?: string;
  links?: { goalId?: string; milestoneId?: string; taskId?: string; decisionId?: string };
  commitment?: {
    title: string;
    dueDate?: string;
    focusArea?: FocusArea;
    priority?: Priority;
    strategicImpact?: number;
    revenueImpact?: number;
    fundraisingImpact?: number;
    customerImpact?: number;
    ceoUniqueness?: number;
    estimatedMinutes?: number;
  };
}

const INSIGHT_FOR: Record<SignalType, InsightType> = {
  deal_stage_change: "DEAL_PROGRESS",
  deal_won: "DEVELOPMENT",
  deal_lost: "RISK",
  commitment: "COMMITMENT",
  response_needed: "COMMUNICATION",
  customer_issue: "RISK",
  escalation: "RISK",
  decision_request: "DECISION_NEEDED",
  approval_request: "COMMUNICATION",
  hiring_decision: "DECISION_NEEDED",
  investor_request: "FOLLOW_UP",
  opportunity: "OPPORTUNITY",
  risk: "RISK",
  development: "DEVELOPMENT",
  deadline: "DEADLINE",
  milestone_reached: "MILESTONE_REACHED",
};

const INBOX_FOR: Partial<Record<SignalType, InboxType>> = {
  response_needed: "RESPONSE",
  customer_issue: "CUSTOMER_ISSUE",
  escalation: "ESCALATION",
  decision_request: "DECISION",
  approval_request: "APPROVAL",
  hiring_decision: "HIRING_DECISION",
  investor_request: "INVESTOR_FOLLOW_UP",
};

const KEYWORDS: [RegExp, SignalType][] = [
  [/\b(escalat|urgent|unacceptable|breach)\w*/i, "escalation"],
  [/\b(approv)\w*/i, "approval_request"],
  [/\b(offer|candidate|competing offer)\b/i, "hiring_decision"],
  [/\b(term sheet|diligence|data room|investment committee)\b/i, "investor_request"],
  [/\b(decide|decision|go\/no-go)\b/i, "decision_request"],
  [/\b(we will|i will|i'll|commit(ted)? to|by (monday|tuesday|wednesday|thursday|friday))\b/i, "commitment"],
  [/\b(please (reply|confirm|advise)|can you|let me know|need your)\b/i, "response_needed"],
  [/\b(risk|delay|slip|concern|churn)\w*/i, "risk"],
  [/\b(opportunit|interested in|would like to partner|credits)\w*/i, "opportunity"],
];

export function classifySignal(signal: Pick<BrainSignal, "kind" | "title" | "body">): SignalType {
  const text = `${signal.title}\n${signal.body ?? ""}`;
  for (const [re, type] of KEYWORDS) if (re.test(text)) return type;
  return signal.kind === "CRM_UPDATE" ? "deal_stage_change" : "development";
}

export interface SignalStageResult {
  drafts: InsightDraft[];
  processed: number;
  tasksCreated: number;
}

export async function analyzeSignals(ctx: BrainContext): Promise<SignalStageResult> {
  const signals = await ctx.tx.brainSignal.findMany({
    where: { processedAt: null, occurredAt: { lte: ctx.now } },
    include: { source: { select: { name: true } }, person: { select: { name: true } }, company: { select: { name: true } } },
    orderBy: { occurredAt: "asc" },
  });

  const drafts: InsightDraft[] = [];
  let tasksCreated = 0;

  for (const s of signals) {
    const meta = (s.metadata ?? {}) as SignalMetadata;
    const type = meta.signalType ?? classifySignal(s);
    const links = meta.links ?? {};
    const importance = meta.importance ?? 3;
    const from = s.person?.name ?? s.company?.name ?? s.source.name;

    let fingerprint = `signal:${s.id}`;
    if (type === "deal_stage_change" && s.dealId && meta.stageTo) fingerprint = `deal-stage:${s.dealId}:${meta.stageTo}`;
    if (type === "deal_won" && s.dealId) fingerprint = `deal-won:${s.dealId}`;
    if (type === "milestone_reached" && links.milestoneId) fingerprint = `ms-done:${links.milestoneId}`;
    // Decision-type signals share the analyzer's fingerprint so one decision
    // yields one insight and one inbox item, whichever stage sees it first.
    if ((type === "decision_request" || type === "hiring_decision") && links.decisionId) {
      fingerprint = `decision:${links.decisionId}`;
    }

    let taskId = links.taskId ?? null;
    if (type === "commitment" && meta.commitment) {
      const existing = await ctx.tx.task.findFirst({ where: { sourceRef: `signal:${s.id}` }, select: { id: true } });
      if (existing) {
        taskId = existing.id;
      } else {
        const c = meta.commitment;
        const due = parseDayInput(c.dueDate) ?? addDays(ctx.today, 3);
        const task = await ctx.tx.task.create({
          data: {
            title: c.title,
            description: `Commitment captured from ${s.source.name}: “${s.title}”`,
            status: "TODO",
            priority: c.priority ?? "P1",
            focusArea: c.focusArea ?? "OPERATIONS",
            dueDate: due,
            originalDueDate: due,
            hardDeadline: true,
            estimatedMinutes: c.estimatedMinutes ?? 60,
            source: s.kind === "EMAIL" ? "EMAIL" : s.kind === "MEETING_NOTE" ? "MEETING" : "BRAIN",
            sourceRef: `signal:${s.id}`,
            strategicImpact: c.strategicImpact ?? 3,
            revenueImpact: c.revenueImpact ?? 0,
            fundraisingImpact: c.fundraisingImpact ?? 0,
            customerImpact: c.customerImpact ?? 0,
            ceoUniqueness: c.ceoUniqueness ?? 4,
            riskLevel: 3,
            opportunityCost: 3,
            ownerId: ctx.ceoPersonId,
            companyId: s.companyId,
            goalId: links.goalId ?? null,
            milestoneId: links.milestoneId ?? null,
            ...(s.personId ? { people: { connect: [{ id: s.personId }] } } : {}),
            createdAt: ctx.now,
          },
        });
        await ctx.tx.activity.create({
          data: {
            type: "TASK_CREATED",
            summary: `Brain captured commitment: ${c.title}`,
            actor: "CytoHub Brain",
            taskId: task.id,
            companyId: s.companyId,
            personId: s.personId,
            createdAt: ctx.now,
          },
        });
        taskId = task.id;
        tasksCreated++;
      }
    }

    const inboxType = INBOX_FOR[type];
    const requiresCeo = meta.requiresCeo ?? (Boolean(inboxType) || importance >= 4);
    const draft: InsightDraft = {
      type: INSIGHT_FOR[type],
      fingerprint,
      title: s.title,
      summary: meta.summary ?? s.body?.slice(0, 400) ?? undefined,
      importance,
      requiresCeo,
      recommendation: meta.recommendation,
      signalId: s.id,
      occurredAt: s.occurredAt,
      personId: s.personId,
      companyId: s.companyId,
      dealId: s.dealId,
      goalId: links.goalId,
      milestoneId: links.milestoneId,
      decisionId: links.decisionId,
      taskId,
    };

    const wantsInbox = inboxType ?? (type === "opportunity" && importance >= 4 ? "OPPORTUNITY" : undefined);
    if (wantsInbox) {
      draft.inbox = {
        type: wantsInbox,
        whyCeo: meta.whyCeo ?? `${from} is asking for a CEO-level response.`,
        recommendedAction: meta.recommendedAction ?? meta.recommendation ?? "Review and respond today.",
        urgency: meta.urgency ?? importance,
        dueDate: parseDayInput(meta.dueDate),
      };
    }
    drafts.push(draft);

    await ctx.tx.brainSignal.update({ where: { id: s.id }, data: { processedAt: ctx.now } });
  }

  ctx.log("signals", `${signals.length} signals processed, ${tasksCreated} commitments captured as tasks`);
  if (signals.length) {
    const latest = signals.at(-1)!;
    ctx.log("signals", `Latest signal: ${dayKey(latest.occurredAt)} — ${latest.title}`);
  }
  return { drafts, processed: signals.length, tasksCreated };
}
