"use server";

import { z } from "zod";
import { DecisionStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { parseDayInput } from "@/lib/dates";
import { getCeoContext } from "@/server/context";
import { logActivity, revalidateAll } from "@/server/mutations";
import { attempt, dayString, fail, ok, type ActionResult } from "./result";

const optionSchema = z.object({
  id: z.string().optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2000).nullable().optional(),
  pros: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  cons: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  risks: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  recommended: z.boolean().default(false),
});

const decisionSchema = z.object({
  title: z.string().trim().min(1, "Decision is required").max(300),
  context: z.string().trim().max(10000).nullable().optional(),
  status: z.enum(DecisionStatus).optional(),
  deadline: dayString,
  strategicImpact: z.coerce.number().int().min(1).max(5).optional(),
  supportingInfo: z.string().trim().max(10000).nullable().optional(),
  recommendation: z.string().trim().max(5000).nullable().optional(),
  waitingOn: z.string().trim().max(2000).nullable().optional(),
  goalId: z.string().nullable().optional(),
  pillarId: z.string().nullable().optional(),
  options: z.array(optionSchema).max(8).optional(),
});

export type DecisionInput = z.input<typeof decisionSchema>;

export async function createDecision(input: DecisionInput): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const data = decisionSchema.parse(input);
    const ceo = await getCeoContext();
    const { options, deadline, ...rest } = data;
    const goal = data.goalId ? await db.goal.findUnique({ where: { id: data.goalId }, select: { pillarId: true } }) : null;
    const d = await db.decision.create({
      data: {
        ...rest,
        deadline: parseDayInput(deadline),
        pillarId: data.pillarId ?? goal?.pillarId ?? null,
        ownerId: ceo.personId,
        options: options?.length ? { create: options.map((o, i) => ({ ...o, id: undefined, order: i })) } : undefined,
      },
    });
    await logActivity(db, { type: "DECISION_CREATED", summary: `Decision raised: ${d.title}`, decisionId: d.id, goalId: d.goalId });
    revalidateAll();
    return ok({ id: d.id }, "Decision recorded");
  });
}

export async function updateDecision(decisionId: string, input: Partial<DecisionInput>): Promise<ActionResult> {
  return attempt(async () => {
    const data = decisionSchema.partial().parse(input);
    const current = await db.decision.findUnique({ where: { id: decisionId } });
    if (!current) return fail("Decision not found");
    const { options, deadline, ...rest } = data;
    await db.$transaction(async (tx) => {
      await tx.decision.update({ where: { id: decisionId }, data: { ...rest, ...(deadline !== undefined ? { deadline: parseDayInput(deadline) } : {}) } });
      if (options) {
        await tx.decisionOption.deleteMany({ where: { decisionId } });
        await tx.decisionOption.createMany({ data: options.map((o, i) => ({ ...o, id: undefined, decisionId, order: i })) });
      }
      await logActivity(tx, { type: "DECISION_UPDATED", summary: `Updated decision: ${current.title}`, decisionId });
    });
    revalidateAll();
    return ok(undefined, "Decision updated");
  });
}

const recordSchema = z.object({
  finalDecision: z.string().trim().min(1, "Describe the decision").max(5000),
  chosenOptionId: z.string().nullable().optional(),
  rationale: z.string().trim().max(5000).nullable().optional(),
});

/** Make the call: records the final decision, closes related inbox items. */
export async function recordDecision(decisionId: string, input: z.input<typeof recordSchema>): Promise<ActionResult> {
  return attempt(async () => {
    const data = recordSchema.parse(input);
    const current = await db.decision.findUnique({ where: { id: decisionId } });
    if (!current) return fail("Decision not found");
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.decision.update({
        where: { id: decisionId },
        data: {
          status: "DECIDED",
          finalDecision: data.finalDecision,
          decidedAt: now,
          supportingInfo: data.rationale ? [current.supportingInfo, `Rationale: ${data.rationale}`].filter(Boolean).join("\n\n") : current.supportingInfo,
        },
      });
      if (data.chosenOptionId) {
        await tx.decisionOption.updateMany({ where: { decisionId }, data: { recommended: false } });
        await tx.decisionOption.update({ where: { id: data.chosenOptionId }, data: { recommended: true } });
      }
      await tx.inboxItem.updateMany({
        where: { decisionId, status: { in: ["OPEN", "SNOOZED"] } },
        data: { status: "DONE", resolvedAt: now, resolution: `Decided: ${data.finalDecision}` },
      });
      await tx.brainInsight.updateMany({ where: { decisionId, status: { in: ["NEW", "ACKNOWLEDGED"] } }, data: { status: "ACTIONED" } });
      // Tasks that existed only to make this decision are done.
      await tx.task.updateMany({
        where: { decisionId, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED"] }, title: { startsWith: "Decide", mode: "insensitive" } },
        data: { status: "DONE", completedAt: now },
      });
      await logActivity(tx, { type: "DECISION_MADE", summary: `Decided: ${data.finalDecision}`, decisionId, goalId: current.goalId });
    });
    revalidateAll();
    return ok(undefined, "Decision recorded");
  });
}

export async function recordOutcome(decisionId: string, input: { outcome?: string | null; lessonsLearned?: string | null }): Promise<ActionResult> {
  return attempt(async () => {
    const data = z.object({ outcome: z.string().trim().max(5000).nullable().optional(), lessonsLearned: z.string().trim().max(5000).nullable().optional() }).parse(input);
    await db.decision.update({ where: { id: decisionId }, data });
    await logActivity(db, { type: "DECISION_UPDATED", summary: "Outcome and lessons recorded", decisionId });
    revalidateAll();
    return ok(undefined, "Saved");
  });
}

export async function setDecisionStatus(decisionId: string, status: DecisionStatus, waitingOn?: string | null): Promise<ActionResult> {
  return attempt(async () => {
    z.enum(DecisionStatus).parse(status);
    await db.decision.update({ where: { id: decisionId }, data: { status, ...(waitingOn !== undefined ? { waitingOn } : {}) } });
    await logActivity(db, { type: "DECISION_UPDATED", summary: `Status set to ${status.replace("_", " ").toLowerCase()}`, decisionId });
    revalidateAll();
    return ok(undefined);
  });
}
