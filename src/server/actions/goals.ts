"use server";

import { z } from "zod";
import { GoalStatus, GoalType, MilestoneStatus, MilestoneType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { parseDayInput } from "@/lib/dates";
import { GOAL_STATUS, MILESTONE_STATUS } from "@/lib/domain";
import { getCeoContext } from "@/server/context";
import { logActivity, rescore, revalidateAll } from "@/server/mutations";
import { getMilestoneDetail, type MilestoneDetail } from "@/server/queries/milestones";
import { attempt, dayString, fail, ok, type ActionResult } from "./result";

// ─── Goals ───────────────────────────────────────────────────────────────────

const goalSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(240),
  description: z.string().trim().max(5000).nullable().optional(),
  type: z.enum(GoalType),
  status: z.enum(GoalStatus).optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  confidence: z.coerce.number().int().min(0).max(100).optional(),
  department: z.string().trim().max(120).nullable().optional(),
  period: z.string().trim().max(40).nullable().optional(),
  startDate: dayString,
  targetDate: dayString,
  risks: z.string().trim().max(5000).nullable().optional(),
  notesText: z.string().trim().max(10000).nullable().optional(),
  pillarId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
});

export type GoalInput = z.input<typeof goalSchema>;

export async function createGoal(input: GoalInput): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const data = goalSchema.parse(input);
    const ceo = await getCeoContext();
    const goal = await db.goal.create({
      data: {
        ...data,
        startDate: parseDayInput(data.startDate),
        targetDate: parseDayInput(data.targetDate),
        ownerId: data.ownerId === undefined ? ceo.personId : data.ownerId,
      },
    });
    await logActivity(db, { type: "GOAL_CREATED", summary: `Goal created: ${goal.title}`, goalId: goal.id });
    revalidateAll();
    return ok({ id: goal.id }, "Goal created");
  });
}

export async function updateGoal(goalId: string, input: Partial<GoalInput>): Promise<ActionResult> {
  return attempt(async () => {
    const data = goalSchema.partial().parse(input);
    const current = await db.goal.findUnique({ where: { id: goalId } });
    if (!current) return fail("Goal not found");
    const { startDate, targetDate, ...rest } = data;
    await db.goal.update({
      where: { id: goalId },
      data: {
        ...rest,
        ...(startDate !== undefined ? { startDate: parseDayInput(startDate) } : {}),
        ...(targetDate !== undefined ? { targetDate: parseDayInput(targetDate) } : {}),
        ...(data.status === "COMPLETED" && current.status !== "COMPLETED" ? { completedAt: new Date(), progress: 100 } : {}),
      },
    });
    if (data.progress !== undefined && data.progress !== current.progress) {
      await logActivity(db, { type: "GOAL_UPDATED", summary: `Progress ${current.progress}% → ${data.progress}%`, goalId, metadata: { field: "progress", from: current.progress, to: data.progress } });
    }
    if (data.status && data.status !== current.status) {
      await logActivity(db, {
        type: "GOAL_UPDATED",
        summary: `Status ${GOAL_STATUS[current.status].label} → ${GOAL_STATUS[data.status].label}`,
        goalId,
        metadata: { field: "status", from: current.status, to: data.status },
      });
      // Goal health feeds the priority score of linked work.
      const linked = await db.task.findMany({ where: { goalId }, select: { id: true } });
      if (linked.length) await rescore(linked.map((t) => t.id));
    }
    if (data.confidence !== undefined && data.confidence !== current.confidence) {
      await logActivity(db, { type: "GOAL_UPDATED", summary: `Confidence ${current.confidence}% → ${data.confidence}%`, goalId, metadata: { field: "confidence", from: current.confidence, to: data.confidence } });
    }
    revalidateAll();
    return ok(undefined, "Goal updated");
  });
}

export async function addGoalNote(goalId: string, body: string): Promise<ActionResult> {
  return attempt(async () => {
    const text = z.string().trim().min(1).max(5000).parse(body);
    await db.note.create({ data: { body: text, goalId } });
    await logActivity(db, { type: "NOTE_ADDED", summary: "Note added", goalId });
    revalidateAll();
    return ok(undefined, "Note added");
  });
}

// ─── Milestones ──────────────────────────────────────────────────────────────

const milestoneSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(240),
  description: z.string().trim().max(5000).nullable().optional(),
  type: z.enum(MilestoneType),
  status: z.enum(MilestoneStatus).optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Due date is required"),
  blocker: z.string().trim().max(2000).nullable().optional(),
  successMetric: z.string().trim().max(500).nullable().optional(),
  goalId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
});

export type MilestoneInput = z.input<typeof milestoneSchema>;

export async function createMilestone(input: MilestoneInput): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const data = milestoneSchema.parse(input);
    const ceo = await getCeoContext();
    const goal = data.goalId ? await db.goal.findUnique({ where: { id: data.goalId }, select: { pillarId: true } }) : null;
    const m = await db.milestone.create({
      data: { ...data, dueDate: parseDayInput(data.dueDate)!, ownerId: data.ownerId === undefined ? ceo.personId : data.ownerId, pillarId: goal?.pillarId ?? null },
    });
    await logActivity(db, { type: "MILESTONE_CREATED", summary: `Milestone created: ${m.title}`, milestoneId: m.id, goalId: m.goalId });
    revalidateAll();
    return ok({ id: m.id }, "Milestone created");
  });
}

export async function updateMilestone(milestoneId: string, input: Partial<MilestoneInput>): Promise<ActionResult> {
  return attempt(async () => {
    const data = milestoneSchema.partial().parse(input);
    const current = await db.milestone.findUnique({ where: { id: milestoneId } });
    if (!current) return fail("Milestone not found");
    const completing = data.status === "COMPLETED" && current.status !== "COMPLETED";
    await db.milestone.update({
      where: { id: milestoneId },
      data: {
        ...data,
        ...(data.dueDate ? { dueDate: parseDayInput(data.dueDate)! } : {}),
        ...(completing ? { completedAt: new Date(), progress: 100 } : {}),
        ...(data.status && data.status !== "COMPLETED" && current.status === "COMPLETED" ? { completedAt: null } : {}),
      },
    });
    if (completing) {
      await logActivity(db, { type: "MILESTONE_COMPLETED", summary: `Milestone reached: ${current.title}`, milestoneId, goalId: current.goalId });
    } else if (data.status && data.status !== current.status) {
      await logActivity(db, {
        type: "MILESTONE_UPDATED",
        summary: `Status ${MILESTONE_STATUS[current.status].label} → ${MILESTONE_STATUS[data.status].label}`,
        milestoneId,
        metadata: { from: current.status, to: data.status },
      });
    } else {
      await logActivity(db, { type: "MILESTONE_UPDATED", summary: `Updated ${current.title}`, milestoneId });
    }
    const linked = await db.task.findMany({ where: { milestoneId }, select: { id: true } });
    if (linked.length) await rescore(linked.map((t) => t.id));
    revalidateAll();
    return ok(undefined, completing ? "Milestone completed" : "Milestone updated");
  });
}

export async function fetchMilestoneDetail(milestoneId: string): Promise<MilestoneDetail | null> {
  return getMilestoneDetail(milestoneId);
}
