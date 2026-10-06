"use server";

import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addDays, formatDay, parseDayInput } from "@/lib/dates";
import { getCeoContext } from "@/server/context";
import { rescore, revalidateAll } from "@/server/mutations";
import { requireCapability, type Viewer } from "@/server/security/session";
import { attempt, dayString, fail, id, ok, type ActionResult } from "./result";

const note = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((v) => v || null);

const OPEN_TASK = ["TODO", "IN_PROGRESS", "WAITING", "BLOCKED", "SOMEDAY"] as const;

function actorOf(viewer: Viewer) {
  return viewer.role === "CEO" ? "CEO" : viewer.name;
}

async function activity(data: Prisma.ActivityUncheckedCreateInput) {
  await db.activity.create({ data });
}

/** Mark a commitment fulfilled; completes its mirrored task and closes its inbox items. */
export async function fulfillCommitment(commitmentId: string, resolution?: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireCapability("workspace.edit");
    const cid = id.parse(commitmentId);
    const text = note.parse(resolution);
    const c = await db.commitment.findUnique({ where: { id: cid } });
    if (!c) return fail("Commitment not found");
    if (c.status === "FULFILLED") return ok(undefined, "Already fulfilled");
    const now = new Date();
    await db.$transaction([
      db.commitment.update({ where: { id: cid }, data: { status: "FULFILLED", fulfilledAt: now, resolutionNote: text } }),
      ...(c.taskId ? [db.task.updateMany({ where: { id: c.taskId, status: { in: [...OPEN_TASK] } }, data: { status: "DONE", completedAt: now } })] : []),
      db.inboxItem.updateMany({ where: { commitmentId: cid, status: { in: ["OPEN", "SNOOZED"] } }, data: { status: "DONE", resolvedAt: now, resolution: "Commitment fulfilled" } }),
      db.activity.create({
        data: { type: "COMMITMENT_FULFILLED", summary: `Fulfilled: ${c.title}`, actor: actorOf(viewer), commitmentId: cid, taskId: c.taskId, companyId: c.companyId, metadata: text ? { note: text } : undefined },
      }),
    ]);
    revalidateAll();
    return ok(undefined, "Marked fulfilled");
  });
}

/** Cancel a commitment (no longer owed); cancels its mirrored task. */
export async function cancelCommitment(commitmentId: string, resolution?: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireCapability("workspace.edit");
    const cid = id.parse(commitmentId);
    const text = note.parse(resolution);
    const c = await db.commitment.findUnique({ where: { id: cid } });
    if (!c) return fail("Commitment not found");
    if (c.status !== "OPEN") return fail("Only open commitments can be cancelled");
    const now = new Date();
    await db.$transaction([
      db.commitment.update({ where: { id: cid }, data: { status: "CANCELLED", resolutionNote: text } }),
      ...(c.taskId ? [db.task.updateMany({ where: { id: c.taskId, status: { in: [...OPEN_TASK] } }, data: { status: "CANCELLED" } })] : []),
      db.inboxItem.updateMany({ where: { commitmentId: cid, status: { in: ["OPEN", "SNOOZED"] } }, data: { status: "DISMISSED", resolvedAt: now, resolution: "Commitment cancelled" } }),
      db.activity.create({
        data: { type: "COMMITMENT_UPDATED", summary: `Cancelled: ${c.title}`, actor: actorOf(viewer), commitmentId: cid, taskId: c.taskId, companyId: c.companyId, metadata: { status: "CANCELLED", ...(text ? { note: text } : {}) } },
      }),
    ]);
    revalidateAll();
    return ok(undefined, "Commitment cancelled");
  });
}

/** Undo fulfil/cancel: back to open (and reopen the mirrored task). */
export async function reopenCommitment(commitmentId: string): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireCapability("workspace.edit");
    const cid = id.parse(commitmentId);
    const c = await db.commitment.findUnique({ where: { id: cid } });
    if (!c) return fail("Commitment not found");
    if (c.status === "OPEN") return ok(undefined, "Already open");
    await db.$transaction([
      db.commitment.update({ where: { id: cid }, data: { status: "OPEN", fulfilledAt: null, resolutionNote: null } }),
      ...(c.taskId ? [db.task.updateMany({ where: { id: c.taskId, status: { in: ["DONE", "CANCELLED"] } }, data: { status: "TODO", completedAt: null } })] : []),
      db.activity.create({ data: { type: "COMMITMENT_UPDATED", summary: `Reopened: ${c.title}`, actor: actorOf(viewer), commitmentId: cid, taskId: c.taskId, companyId: c.companyId, metadata: { status: "OPEN" } } }),
    ]);
    if (c.taskId) await rescore([c.taskId]);
    revalidateAll();
    return ok(undefined, "Reopened");
  });
}

/** Move (or clear) the due date; the mirrored task follows. */
export async function setCommitmentDue(commitmentId: string, due: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireCapability("workspace.edit");
    const cid = id.parse(commitmentId);
    const raw = dayString.parse(due);
    const day = raw ? parseDayInput(raw) : null;
    if (raw && !day) return fail("Pick a valid date");
    const c = await db.commitment.findUnique({ where: { id: cid }, include: { task: { select: { id: true, dueDate: true, postponeCount: true, originalDueDate: true } } } });
    if (!c) return fail("Commitment not found");
    if ((c.dueDate?.getTime() ?? null) === (day?.getTime() ?? null)) return ok(undefined, "No change");
    const later = Boolean(day && c.dueDate && day > c.dueDate);
    await db.$transaction([
      db.commitment.update({ where: { id: cid }, data: { dueDate: day, dueText: null } }),
      ...(c.task
        ? [
            db.task.update({
              where: { id: c.task.id },
              data: { dueDate: day, originalDueDate: c.task.originalDueDate ?? c.task.dueDate ?? day, postponeCount: later ? c.task.postponeCount + 1 : c.task.postponeCount },
            }),
          ]
        : []),
      db.activity.create({
        data: {
          type: "COMMITMENT_UPDATED",
          summary: `Due date ${c.dueDate ? `moved from ${formatDay(c.dueDate)} ` : "set "}to ${day ? formatDay(day) : "none"}: ${c.title}`,
          actor: actorOf(viewer),
          commitmentId: cid,
          taskId: c.taskId,
          companyId: c.companyId,
          metadata: { field: "dueDate", from: c.dueDate?.toISOString().slice(0, 10) ?? null, to: raw ?? null },
        },
      }),
    ]);
    if (c.task) await rescore([c.task.id]);
    revalidateAll();
    return ok(undefined, "Due date updated");
  });
}

/** For something owed to us: a CEO task to chase it. Idempotent per commitment. */
export async function createFollowUpTask(commitmentId: string): Promise<ActionResult<{ taskId: string }>> {
  return attempt(async () => {
    const viewer = await requireCapability("workspace.edit");
    const cid = id.parse(commitmentId);
    const c = await db.commitment.findUnique({ where: { id: cid }, include: { owner: { select: { id: true, name: true } }, company: { select: { name: true } } } });
    if (!c) return fail("Commitment not found");
    if (c.status !== "OPEN") return fail("This commitment is closed");
    const ref = `commitment-follow-up:${cid}`;
    const existing = await db.task.findFirst({ where: { sourceRef: ref, status: { in: [...OPEN_TASK] } }, select: { id: true } });
    if (existing) return ok({ taskId: existing.id }, "A follow-up task already exists");

    const ceo = await getCeoContext();
    const who = c.owner?.name ?? c.company?.name ?? "them";
    const due = c.dueDate && c.dueDate < ceo.today ? ceo.today : (c.followUpDate ?? (c.dueDate ? addDays(c.dueDate, 1) : addDays(ceo.today, 2)));
    const task = await db.task.create({
      data: {
        title: `Follow up with ${who}: ${c.title}`,
        description: `${c.direction === "INBOUND" ? "Owed to us" : "Commitment"}${c.dueDate ? ` — due ${formatDay(c.dueDate)}` : ""}.\n“${c.text}”`,
        status: "TODO",
        priority: c.dueDate && c.dueDate < ceo.today ? "P1" : "P2",
        focusArea: "OPERATIONS",
        dueDate: due,
        originalDueDate: due,
        source: "MANUAL",
        sourceRef: ref,
        ownerId: ceo.personId,
        companyId: c.companyId,
        goalId: c.goalId,
        people: c.owner ? { connect: [{ id: c.owner.id }] } : undefined,
        strategicImpact: 3,
        ceoUniqueness: 3,
        estimatedMinutes: 15,
      },
    });
    await activity({ type: "TASK_CREATED", summary: `Follow-up task created: ${task.title}`, actor: actorOf(viewer), taskId: task.id, commitmentId: cid, companyId: c.companyId });
    await rescore([task.id]);
    revalidateAll();
    return ok({ taskId: task.id }, "Follow-up task created");
  });
}
