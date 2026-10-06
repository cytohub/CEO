"use server";

import { z } from "zod";
import type { FocusArea } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, parseDayInput } from "@/lib/dates";
import { getCeoContext } from "@/server/context";
import { logActivity, rescore, revalidateAll } from "@/server/mutations";
import { attemptAs, fail, ok, type ActionResult } from "./result";

export async function resolveInboxItem(itemId: string, resolution?: string | null): Promise<ActionResult> {
  return attemptAs("cockpit.view", async () => {
    const note = z.string().trim().max(2000).nullish().parse(resolution);
    const item = await db.inboxItem.update({ where: { id: itemId }, data: { status: "DONE", resolvedAt: new Date(), resolution: note || "Handled" } });
    if (item.insightId) await db.brainInsight.update({ where: { id: item.insightId }, data: { status: "ACTIONED" } });
    await logActivity(db, { type: "INBOX_RESOLVED", summary: `Handled: ${item.title}`, decisionId: item.decisionId, taskId: item.taskId, companyId: item.companyId, personId: item.personId });
    revalidateAll();
    return ok(undefined, "Marked done");
  });
}

export async function snoozeInboxItem(itemId: string, until: string): Promise<ActionResult> {
  return attemptAs("cockpit.view", async () => {
    const day = parseDayInput(until);
    if (!day) return fail("Pick a date");
    const ceo = await getCeoContext();
    if (day <= ceo.today) return fail("Snooze until a future day");
    // Wake at 7:00 local on the chosen day (next refresh picks it up).
    await db.inboxItem.update({ where: { id: itemId }, data: { status: "SNOOZED", snoozedUntil: new Date(day.getTime() + 7 * 3_600_000) } });
    revalidateAll();
    return ok(undefined, "Snoozed");
  });
}

export async function dismissInboxItem(itemId: string): Promise<ActionResult> {
  return attemptAs("cockpit.view", async () => {
    const item = await db.inboxItem.update({ where: { id: itemId }, data: { status: "DISMISSED", resolvedAt: new Date(), resolution: "Dismissed — not CEO-relevant" } });
    if (item.insightId) await db.brainInsight.update({ where: { id: item.insightId }, data: { status: "DISMISSED" } });
    await logActivity(db, { type: "INBOX_RESOLVED", summary: `Dismissed: ${item.title}` });
    revalidateAll();
    return ok(undefined, "Dismissed — the Brain will learn from this");
  });
}

export async function reopenInboxItem(itemId: string): Promise<ActionResult> {
  return attemptAs("cockpit.view", async () => {
    await db.inboxItem.update({ where: { id: itemId }, data: { status: "OPEN", resolvedAt: null, resolution: null, snoozedUntil: null } });
    revalidateAll();
    return ok(undefined, "Moved back to inbox");
  });
}

const TYPE_FOCUS: Record<string, FocusArea> = {
  INVESTOR_FOLLOW_UP: "FUNDRAISING",
  CUSTOMER_ISSUE: "CUSTOMERS",
  ESCALATION: "CUSTOMERS",
  HIRING_DECISION: "RECRUITING",
  APPROVAL: "FINANCE",
  OPPORTUNITY: "PARTNERSHIPS",
  DEADLINE_RISK: "OPERATIONS",
  DECISION: "STRATEGY",
  RESPONSE: "OPERATIONS",
};

/** Turn an inbox item into a CEO task that keeps all its links. */
export async function convertInboxToTask(itemId: string, opts?: { title?: string; dueDate?: string | null }): Promise<ActionResult<{ taskId: string }>> {
  return attemptAs("cockpit.view", async () => {
    const ceo = await getCeoContext();
    const item = await db.inboxItem.findUnique({ where: { id: itemId }, include: { goal: { select: { pillarId: true } } } });
    if (!item) return fail("Inbox item not found");
    if (item.taskId) {
      await db.inboxItem.update({ where: { id: itemId }, data: { status: "DONE", resolvedAt: new Date(), resolution: "Tracked as an existing task" } });
      revalidateAll();
      return ok({ taskId: item.taskId }, "Already tracked as a task");
    }
    const due = parseDayInput(opts?.dueDate) ?? item.dueDate ?? addDays(ceo.today, item.urgency >= 4 ? 0 : 2);
    const task = await db.task.create({
      data: {
        title: opts?.title?.trim() || item.title,
        description: `${item.summary ?? ""}\n\nWhy CEO: ${item.whyCeo}\nRecommended: ${item.recommendedAction}`.trim(),
        status: "TODO",
        priority: item.urgency >= 5 ? "P0" : item.urgency >= 4 ? "P1" : "P2",
        focusArea: TYPE_FOCUS[item.type] ?? "OPERATIONS",
        dueDate: due,
        originalDueDate: due,
        source: "INBOX",
        sourceRef: `inbox:${item.id}`,
        strategicImpact: Math.min(5, item.urgency),
        riskLevel: item.type === "ESCALATION" || item.type === "DEADLINE_RISK" ? 4 : 2,
        customerImpact: item.type === "CUSTOMER_ISSUE" || item.type === "ESCALATION" ? 4 : 0,
        fundraisingImpact: item.type === "INVESTOR_FOLLOW_UP" ? 4 : 0,
        ceoUniqueness: 4,
        opportunityCost: 3,
        estimatedMinutes: 30,
        ownerId: ceo.personId,
        companyId: item.companyId,
        decisionId: item.decisionId,
        goalId: item.goalId,
        pillarId: item.goal?.pillarId ?? null,
        people: item.personId ? { connect: [{ id: item.personId }] } : undefined,
      },
    });
    await db.inboxItem.update({ where: { id: itemId }, data: { status: "DONE", resolvedAt: new Date(), resolution: "Converted to task", taskId: task.id } });
    await logActivity(db, { type: "TASK_CREATED", summary: `Created from inbox: ${task.title}`, taskId: task.id });
    await rescore([task.id]);
    revalidateAll();
    return ok({ taskId: task.id }, "Converted to a task");
  });
}
