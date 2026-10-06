"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { addDays, parseDayInput } from "@/lib/dates";
import { getCeoContext } from "@/server/context";
import { logActivity, rescore, revalidateAll } from "@/server/mutations";
import { attempt, dayString, fail, ok, type ActionResult } from "./result";

const updateSchema = z.object({ note: z.string().trim().min(1, "Add an update").max(2000), dueDate: dayString });

/** Record a status update from the delegate (as reported to the CEO). */
export async function logDelegationUpdate(delegationId: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  return attempt(async () => {
    const data = updateSchema.parse(input);
    const d = await db.delegation.findUnique({ where: { id: delegationId }, include: { task: { select: { id: true, title: true } }, delegate: { select: { name: true } } } });
    if (!d) return fail("Delegation not found");
    const due = parseDayInput(data.dueDate);
    await db.delegation.update({
      where: { id: delegationId },
      data: { lastUpdateAt: new Date(), lastUpdateNote: data.note, status: "ACTIVE", ...(due ? { dueDate: due } : {}) },
    });
    if (due) await db.task.update({ where: { id: d.taskId }, data: { dueDate: due } });
    await logActivity(db, { type: "DELEGATION_UPDATED", summary: data.note, actor: d.delegate.name, taskId: d.taskId, delegationId });
    revalidateAll();
    return ok(undefined, "Update logged");
  });
}

/** CEO pinged the delegate; schedule the next check. */
export async function followUpDelegation(delegationId: string, note?: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const ceo = await getCeoContext();
    const d = await db.delegation.findUnique({ where: { id: delegationId }, include: { task: { select: { title: true } }, delegate: { select: { name: true, id: true } } } });
    if (!d) return fail("Delegation not found");
    await db.delegation.update({ where: { id: delegationId }, data: { followUpAt: addDays(ceo.today, 2) } });
    await logActivity(db, {
      type: "DELEGATION_UPDATED",
      summary: `Followed up with ${d.delegate.name} on “${d.task.title}”${note ? `: ${note}` : ""}`,
      taskId: d.taskId,
      personId: d.delegate.id,
      delegationId,
    });
    await db.person.update({ where: { id: d.delegate.id }, data: { lastContactAt: new Date() } });
    revalidateAll();
    return ok(undefined, `Follow-up logged — check back in 2 days`);
  });
}

/** Take the work back. */
export async function recallDelegation(delegationId: string): Promise<ActionResult> {
  return attempt(async () => {
    const ceo = await getCeoContext();
    const d = await db.delegation.findUnique({ where: { id: delegationId }, include: { task: { select: { title: true } }, delegate: { select: { name: true } } } });
    if (!d) return fail("Delegation not found");
    await db.delegation.update({ where: { id: delegationId }, data: { status: "RECALLED" } });
    await db.task.update({ where: { id: d.taskId }, data: { ownerId: ceo.personId } });
    await logActivity(db, { type: "DELEGATION_UPDATED", summary: `Recalled “${d.task.title}” from ${d.delegate.name}`, taskId: d.taskId, delegationId });
    await rescore([d.taskId]);
    revalidateAll();
    return ok(undefined, "Recalled — back on your list");
  });
}

/** Tell the Brain this genuinely needs the CEO (stops the delegation nudge). */
export async function keepWithCeo(taskId: string): Promise<ActionResult> {
  return attempt(async () => {
    const task = await db.task.findUnique({ where: { id: taskId }, select: { title: true, ceoUniqueness: true } });
    if (!task) return fail("Task not found");
    await db.task.update({ where: { id: taskId }, data: { ceoUniqueness: Math.max(3, task.ceoUniqueness), delegationRecommended: false, suggestedDelegateId: null } });
    await logActivity(db, { type: "TASK_UPDATED", summary: `Kept “${task.title}” with the CEO`, taskId });
    await rescore([taskId]);
    revalidateAll();
    return ok(undefined, "Kept on your plate");
  });
}
