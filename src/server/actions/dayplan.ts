"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { addDays, dayKey } from "@/lib/dates";
import { ensureDayPlan, recommendTopFive } from "@/server/brain/priorities";
import { getCeoContext } from "@/server/context";
import { logActivity, revalidateAll } from "@/server/mutations";
import { attempt, fail, ok, type ActionResult } from "./result";

async function renumber(dayPlanId: string) {
  const items = await db.dailyPriority.findMany({ where: { dayPlanId }, orderBy: { rank: "asc" } });
  for (const [i, it] of items.entries()) {
    if (it.rank !== i + 1) await db.dailyPriority.update({ where: { id: it.id }, data: { rank: i + 1 } });
  }
}

/** CEO adds a task to today's Top 5 (replacing the lowest Brain pick if full). */
export async function pinToTop5(taskId: string): Promise<ActionResult> {
  return attempt(async () => {
    const ceo = await getCeoContext();
    const plan = await ensureDayPlan(db, ceo.today);
    const task = await db.task.findUnique({ where: { id: taskId } });
    if (!task) return fail("Task not found");
    const items = await db.dailyPriority.findMany({ where: { dayPlanId: plan.id }, orderBy: { rank: "asc" } });
    if (items.some((i) => i.taskId === taskId)) return ok(undefined, "Already in Today’s Top 5");
    if (items.length >= 5) {
      const replaceable = [...items].reverse().find((i) => i.source === "BRAIN" && !i.pinned) ?? items[items.length - 1];
      await db.dailyPriority.delete({ where: { id: replaceable.id } });
    }
    await db.dailyPriority.create({
      data: { dayPlanId: plan.id, taskId, rank: 99, score: task.priorityScore, rationale: task.aiRecommendation, source: "CEO", pinned: true },
    });
    await renumber(plan.id);
    await logActivity(db, { type: "TASK_PRIORITY_CHANGED", summary: `Added “${task.title}” to Today’s Top 5`, taskId });
    revalidateAll();
    return ok(undefined, "Added to Today’s Top 5");
  });
}

export async function removeFromTop5(taskId: string): Promise<ActionResult> {
  return attempt(async () => {
    const ceo = await getCeoContext();
    const plan = await db.dayPlan.findUnique({ where: { date: ceo.today } });
    if (!plan) return fail("No plan for today");
    const task = await db.task.findUnique({ where: { id: taskId }, select: { title: true } });
    await db.dailyPriority.deleteMany({ where: { dayPlanId: plan.id, taskId } });
    await renumber(plan.id);
    await logActivity(db, { type: "TASK_PRIORITY_CHANGED", summary: `Removed “${task?.title ?? "task"}” from Today’s Top 5`, taskId });
    revalidateAll();
    return ok(undefined, "Removed from Today’s Top 5");
  });
}

export async function moveInTop5(taskId: string, direction: "up" | "down"): Promise<ActionResult> {
  return attempt(async () => {
    const ceo = await getCeoContext();
    const plan = await db.dayPlan.findUnique({ where: { date: ceo.today }, include: { priorities: { orderBy: { rank: "asc" } } } });
    if (!plan) return fail("No plan for today");
    const idx = plan.priorities.findIndex((p) => p.taskId === taskId);
    const swap = direction === "up" ? idx - 1 : idx + 1;
    if (idx < 0 || swap < 0 || swap >= plan.priorities.length) return ok(undefined);
    const a = plan.priorities[idx];
    const b = plan.priorities[swap];
    await db.$transaction([
      db.dailyPriority.update({ where: { id: a.id }, data: { rank: b.rank, source: "CEO" } }),
      db.dailyPriority.update({ where: { id: b.id }, data: { rank: a.rank } }),
    ]);
    revalidateAll();
    return ok(undefined, "Reordered");
  });
}

/** Ask the Brain to re-recommend (only while the list is unconfirmed). */
export async function regenerateTop5(): Promise<ActionResult> {
  return attempt(async () => {
    const ceo = await getCeoContext();
    const plan = await ensureDayPlan(db, ceo.today);
    if (plan.top5ConfirmedAt) await db.dayPlan.update({ where: { id: plan.id }, data: { top5ConfirmedAt: null } });
    await recommendTopFive(db, { today: ceo.today, ceoPersonId: ceo.personId });
    revalidateAll();
    return ok(undefined, "Top 5 re-recommended");
  });
}

export async function confirmTop5(intention?: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const ceo = await getCeoContext();
    const plan = await ensureDayPlan(db, ceo.today);
    await db.dayPlan.update({ where: { id: plan.id }, data: { top5ConfirmedAt: new Date(), intention: intention ?? plan.intention } });
    await logActivity(db, { type: "TOP5_CONFIRMED", summary: "Confirmed Today’s Top 5" });
    revalidateAll();
    return ok(undefined, "Top 5 locked in — go execute");
  });
}

const eodSchema = z.object({
  notes: z.string().trim().max(5000).nullable().optional(),
  /** Unfinished Top 5 tasks to roll over to tomorrow. */
  rollOver: z.array(z.string()).max(10).default([]),
});

/** End-of-day review: record reflections and roll unfinished priorities forward. */
export async function completeEndOfDay(input: z.input<typeof eodSchema>): Promise<ActionResult> {
  return attempt(async () => {
    const data = eodSchema.parse(input);
    const ceo = await getCeoContext();
    const plan = await ensureDayPlan(db, ceo.today);
    const tomorrow = addDays(ceo.today, 1);
    for (const taskId of data.rollOver) {
      const t = await db.task.findUnique({ where: { id: taskId } });
      if (!t || t.status === "DONE") continue;
      const moved = !t.dueDate || t.dueDate < tomorrow;
      await db.task.update({
        where: { id: taskId },
        data: { dueDate: moved ? tomorrow : t.dueDate, postponeCount: moved && t.dueDate ? { increment: 1 } : undefined },
      });
      if (moved) {
        await logActivity(db, {
          type: "TASK_RESCHEDULED",
          summary: `Rolled “${t.title}” to tomorrow`,
          taskId,
          metadata: { from: t.dueDate ? dayKey(t.dueDate) : null, to: dayKey(tomorrow) },
        });
      }
    }
    await db.dayPlan.update({ where: { id: plan.id }, data: { endOfDayAt: new Date(), endOfDayNotes: data.notes ?? null } });
    await logActivity(db, { type: "END_OF_DAY", summary: "End-of-day review completed", metadata: { rolledOver: data.rollOver.length } });
    revalidateAll();
    return ok(undefined, "Day closed. History saved to CytoHub Brain.");
  });
}
