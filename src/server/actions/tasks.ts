"use server";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { FocusArea, Priority, TaskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { dayKey, parseDayInput } from "@/lib/dates";
import { PRIORITY, TASK_STATUS } from "@/lib/domain";
import { recommendTopFive } from "@/server/brain/priorities";
import { getCeoContext } from "@/server/context";
import { logActivity, rescore, revalidateAll } from "@/server/mutations";
import { getTaskDetail as loadTaskDetail, type TaskDetail } from "@/server/queries/tasks";
import { attempt, dayString, fail, id, ok, rating, type ActionResult } from "./result";

const taskFields = {
  title: z.string().trim().min(1, "Title is required").max(240),
  description: z.string().trim().max(5000).nullable().optional(),
  status: z.enum(TaskStatus).optional(),
  priority: z.enum(Priority).optional(),
  focusArea: z.enum(FocusArea).optional(),
  dueDate: dayString,
  hardDeadline: z.boolean().optional(),
  goalId: z.string().nullable().optional(),
  milestoneId: z.string().nullable().optional(),
  pillarId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  companyId: z.string().nullable().optional(),
  decisionId: z.string().nullable().optional(),
  estimatedMinutes: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  actualMinutes: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  blocker: z.string().trim().max(1000).nullable().optional(),
  notesText: z.string().max(10_000).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  strategicImpact: rating.optional(),
  revenueImpact: rating.optional(),
  fundraisingImpact: rating.optional(),
  customerImpact: rating.optional(),
  scientificImpact: rating.optional(),
  riskLevel: rating.optional(),
  ceoUniqueness: rating.optional(),
  opportunityCost: rating.optional(),
  peopleIds: z.array(z.string()).max(30).optional(),
};

const createSchema = z.object(taskFields);
const updateSchema = z.object({ ...taskFields, title: taskFields.title.optional() });

export type CreateTaskInput = z.input<typeof createSchema>;
export type UpdateTaskInput = z.input<typeof updateSchema>;

async function pillarForGoal(goalId: string | null | undefined) {
  if (!goalId) return null;
  const goal = await db.goal.findUnique({ where: { id: goalId }, select: { pillarId: true } });
  return goal?.pillarId ?? null;
}

export async function createTask(input: CreateTaskInput): Promise<ActionResult<{ id: string }>> {
  return attempt(async () => {
    const data = createSchema.parse(input);
    const ceo = await getCeoContext();
    const due = parseDayInput(data.dueDate);
    const { peopleIds, ...rest } = data;
    const task = await db.task.create({
      data: {
        ...rest,
        dueDate: due,
        originalDueDate: due,
        ownerId: data.ownerId === undefined ? ceo.personId : data.ownerId,
        pillarId: data.pillarId ?? (await pillarForGoal(data.goalId)),
        people: peopleIds?.length ? { connect: peopleIds.map((p) => ({ id: p })) } : undefined,
      },
    });
    await logActivity(db, { type: "TASK_CREATED", summary: `Created “${task.title}”`, taskId: task.id, goalId: task.goalId });
    await rescore([task.id]);
    revalidateAll();
    return ok({ id: task.id }, "Task created");
  });
}

export async function updateTask(taskId: string, input: UpdateTaskInput): Promise<ActionResult> {
  return attempt(async () => {
    id.parse(taskId);
    const data = updateSchema.parse(input);
    const current = await db.task.findUnique({ where: { id: taskId } });
    if (!current) return fail("Task not found");

    const { peopleIds, dueDate, ...rest } = data;
    const patch: Prisma.TaskUpdateInput = { ...rest } as Prisma.TaskUpdateInput;
    const activities: Parameters<typeof logActivity>[1][] = [];

    if (dueDate !== undefined) {
      const next = parseDayInput(dueDate);
      patch.dueDate = next;
      if (!current.originalDueDate && next) patch.originalDueDate = next;
      if (current.dueDate && next && next > current.dueDate) {
        patch.postponeCount = { increment: 1 };
        activities.push({
          type: "TASK_RESCHEDULED",
          summary: `Rescheduled “${current.title}” to ${dayKey(next)}`,
          taskId,
          metadata: { from: dayKey(current.dueDate), to: dayKey(next) },
        });
      } else if (String(current.dueDate?.getTime()) !== String(next?.getTime())) {
        activities.push({ type: "TASK_UPDATED", summary: `Due date set to ${next ? dayKey(next) : "none"}`, taskId });
      }
    }
    if (data.priority && data.priority !== current.priority) {
      activities.push({
        type: "TASK_PRIORITY_CHANGED",
        summary: `Priority ${current.priority} → ${data.priority} (${PRIORITY[data.priority].label})`,
        taskId,
        metadata: { from: current.priority, to: data.priority },
      });
    }
    if (data.status && data.status !== current.status) {
      if (data.status === "DONE") {
        patch.completedAt = new Date();
        activities.push({ type: "TASK_COMPLETED", summary: `Completed “${current.title}”`, taskId, goalId: current.goalId });
      } else {
        if (current.status === "DONE") {
          patch.completedAt = null;
          activities.push({ type: "TASK_REOPENED", summary: `Reopened “${current.title}”`, taskId });
        } else {
          activities.push({ type: "TASK_UPDATED", summary: `Status ${TASK_STATUS[current.status].label} → ${TASK_STATUS[data.status].label}`, taskId, metadata: { from: current.status, to: data.status } });
        }
      }
    }
    const relations: Record<string, string | null | undefined> = {
      goalId: data.goalId,
      milestoneId: data.milestoneId,
      pillarId: data.pillarId ?? (data.goalId !== undefined ? await pillarForGoal(data.goalId) : undefined),
      ownerId: data.ownerId,
      companyId: data.companyId,
      decisionId: data.decisionId,
    };
    if (peopleIds) patch.people = { set: peopleIds.map((p) => ({ id: p })) };

    // Relations must go through connect/disconnect in a checked update.
    for (const [field, rel] of [
      ["goalId", "goal"],
      ["milestoneId", "milestone"],
      ["pillarId", "pillar"],
      ["ownerId", "owner"],
      ["companyId", "company"],
      ["decisionId", "decision"],
    ] as const) {
      const value = relations[field];
      delete (patch as Record<string, unknown>)[field];
      if (value === undefined) continue;
      (patch as Record<string, unknown>)[rel] = value ? { connect: { id: value } } : { disconnect: true };
    }

    await db.task.update({ where: { id: taskId }, data: patch });
    for (const a of activities) await logActivity(db, a);
    if (!activities.length) await logActivity(db, { type: "TASK_UPDATED", summary: `Updated “${current.title}”`, taskId });
    await rescore([taskId]);
    revalidateAll();
    return ok(undefined, "Task updated");
  });
}

export async function completeTask(taskId: string, actualMinutes?: number | null): Promise<ActionResult> {
  return attempt(async () => {
    const ceo = await getCeoContext();
    const task = await db.task.findUnique({ where: { id: taskId }, include: { delegation: true } });
    if (!task) return fail("Task not found");
    if (task.status === "DONE") return ok(undefined);
    const minutes = actualMinutes ?? task.actualMinutes ?? task.estimatedMinutes ?? null;
    await db.$transaction(async (tx) => {
      await tx.task.update({ where: { id: taskId }, data: { status: "DONE", completedAt: new Date(), actualMinutes: minutes } });
      if (task.delegation && task.delegation.status !== "COMPLETED") {
        await tx.delegation.update({ where: { id: task.delegation.id }, data: { status: "COMPLETED", completedAt: new Date() } });
      }
      await tx.inboxItem.updateMany({
        where: { taskId, status: { in: ["OPEN", "SNOOZED"] } },
        data: { status: "DONE", resolvedAt: new Date(), resolution: "Task completed" },
      });
      // Feed CEO time allocation with effort spent on CEO-owned work.
      if (task.ownerId === ceo.personId && minutes) {
        await tx.timeEntry.create({ data: { date: ceo.today, minutes, focusArea: task.focusArea, source: "TASK", taskId, description: task.title } });
      }
      await logActivity(tx, { type: "TASK_COMPLETED", summary: `Completed “${task.title}”`, taskId, goalId: task.goalId, milestoneId: task.milestoneId });
    });
    revalidateAll();
    return ok(undefined, "Completed");
  });
}

export async function reopenTask(taskId: string): Promise<ActionResult> {
  return updateTask(taskId, { status: "TODO" });
}

export async function rescheduleTask(taskId: string, dueDate: string, reason?: string): Promise<ActionResult> {
  return attempt(async () => {
    const res = await updateTask(taskId, { dueDate });
    if (res.ok && reason?.trim()) {
      await db.note.create({ data: { body: `Rescheduled: ${reason.trim()}`, taskId } });
    }
    return res;
  });
}

export async function setTaskPriority(taskId: string, priority: Priority): Promise<ActionResult> {
  return updateTask(taskId, { priority });
}

const delegateSchema = z.object({
  delegateId: id,
  dueDate: dayString,
  expectations: z.string().trim().max(2000).nullable().optional(),
});

export async function delegateTask(taskId: string, input: z.input<typeof delegateSchema>): Promise<ActionResult> {
  return attempt(async () => {
    const data = delegateSchema.parse(input);
    const ceo = await getCeoContext();
    const [task, delegate] = await Promise.all([
      db.task.findUnique({ where: { id: taskId }, include: { delegation: true } }),
      db.person.findUnique({ where: { id: data.delegateId } }),
    ]);
    if (!task) return fail("Task not found");
    if (!delegate) return fail("Delegate not found");
    const due = parseDayInput(data.dueDate) ?? task.dueDate;

    await db.$transaction(async (tx) => {
      const delegation = task.delegation
        ? await tx.delegation.update({
            where: { id: task.delegation.id },
            data: { delegateId: delegate.id, status: "ACTIVE", dueDate: due, expectations: data.expectations ?? task.delegation.expectations, delegatedAt: new Date(), completedAt: null },
          })
        : await tx.delegation.create({
            data: { taskId, delegateId: delegate.id, dueDate: due, expectations: data.expectations ?? null },
          });
      await tx.task.update({
        where: { id: taskId },
        data: { ownerId: delegate.id, dueDate: due, delegationRecommended: false, suggestedDelegateId: null },
      });
      await logActivity(tx, {
        type: "TASK_DELEGATED",
        summary: `Delegated “${task.title}” to ${delegate.name}`,
        taskId,
        personId: delegate.id,
        delegationId: delegation.id,
      });
      // Delegated work leaves today's Top 5.
      const plan = await tx.dayPlan.findUnique({ where: { date: ceo.today } });
      if (plan) {
        await tx.dailyPriority.deleteMany({ where: { dayPlanId: plan.id, taskId } });
        if (!plan.top5ConfirmedAt) await recommendTopFive(tx, { today: ceo.today, ceoPersonId: ceo.personId });
      }
    });
    revalidateAll();
    return ok(undefined, `Delegated to ${delegate.name}`);
  });
}

export async function addTaskNote(taskId: string, body: string): Promise<ActionResult> {
  return attempt(async () => {
    const text = z.string().trim().min(1, "Note is empty").max(5000).parse(body);
    const task = await db.task.findUnique({ where: { id: taskId }, select: { title: true } });
    if (!task) return fail("Task not found");
    await db.note.create({ data: { body: text, taskId } });
    await logActivity(db, { type: "NOTE_ADDED", summary: `Note on “${task.title}”`, taskId });
    revalidateAll();
    return ok(undefined, "Note added");
  });
}

/** Read-only: task detail for the task sheet (Dates survive the action boundary). */
export async function fetchTaskDetail(taskId: string): Promise<TaskDetail | null> {
  id.parse(taskId);
  return loadTaskDetail(taskId);
}

/** Open CEO tasks for pickers (command bar complete/delegate). */
export async function listPickerTasks(): Promise<{ id: string; title: string; subtitle: string }[]> {
  const ceo = await getCeoContext();
  const tasks = await db.task.findMany({
    where: { ownerId: ceo.personId, status: { in: ["TODO", "IN_PROGRESS", "BLOCKED", "WAITING"] } },
    orderBy: [{ priorityScore: "desc" }],
    take: 40,
    select: { id: true, title: true, priorityScore: true, dueDate: true, delegationRecommended: true },
  });
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    subtitle: [`Score ${Math.round(t.priorityScore)}`, t.dueDate ? `due ${dayKey(t.dueDate)}` : null, t.delegationRecommended ? "Brain suggests delegating" : null]
      .filter(Boolean)
      .join(" · "),
  }));
}
