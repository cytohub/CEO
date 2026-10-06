"use server";

import { z } from "zod";
import { OpportunityStatus, RiskStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { OPPORTUNITY_STATUS, RISK_STATUS } from "@/lib/intelligence";
import { getCeoContext } from "@/server/context";
import { rescore, revalidateAll } from "@/server/mutations";
import { requireCapability, type Viewer } from "@/server/security/session";
import { attempt, fail, id, ok, type ActionResult } from "./result";

const note = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((v) => v || null);

function actorOf(viewer: Viewer) {
  return viewer.role === "CEO" ? "CEO" : viewer.name;
}

/** Move a risk through monitoring / mitigated / resolved / accepted (or reopen it). */
export async function setRiskStatus(riskId: string, status: string, resolution?: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireCapability("workspace.edit");
    const rid = id.parse(riskId);
    const next = z.enum(RiskStatus).parse(status);
    const text = note.parse(resolution);
    const risk = await db.risk.findUnique({ where: { id: rid } });
    if (!risk) return fail("Risk not found");
    if (risk.status === next && !text) return ok(undefined, "No change");
    const closing = next === "RESOLVED" || next === "ACCEPTED" || next === "MITIGATED";
    await db.$transaction([
      db.risk.update({
        where: { id: rid },
        data: {
          status: next,
          resolvedAt: next === "RESOLVED" ? new Date() : closing ? risk.resolvedAt : null,
          ...(closing && text ? { resolution: text } : {}),
          ...(next === "MONITORING" && text ? { mitigation: text } : {}),
        },
      }),
      db.activity.create({
        data: {
          type: next === "RESOLVED" ? "RISK_RESOLVED" : "STATUS_CHANGED",
          summary: `${next === "RESOLVED" ? "Risk resolved" : `Risk ${RISK_STATUS[next].label.toLowerCase()}`}: ${risk.title}`,
          actor: actorOf(viewer),
          riskId: rid,
          companyId: risk.companyId,
          goalId: risk.goalId,
          milestoneId: risk.milestoneId,
          metadata: { from: risk.status, to: next, ...(text ? { note: text } : {}) },
        },
      }),
    ]);
    revalidateAll();
    return ok(undefined, `Marked ${RISK_STATUS[next].label.toLowerCase()}`);
  });
}

export async function setRiskOwner(riskId: string, personId: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireCapability("workspace.edit");
    const rid = id.parse(riskId);
    const pid = id.nullable().parse(personId);
    const risk = await db.risk.findUnique({ where: { id: rid } });
    if (!risk) return fail("Risk not found");
    const person = pid ? await db.person.findUnique({ where: { id: pid }, select: { id: true, name: true } }) : null;
    if (pid && !person) return fail("Person not found");
    await db.$transaction([
      db.risk.update({ where: { id: rid }, data: { ownerPersonId: pid } }),
      db.activity.create({ data: { type: "OWNER_CHANGED", summary: `Risk owner ${person ? `set to ${person.name}` : "cleared"}: ${risk.title}`, actor: actorOf(viewer), riskId: rid, personId: pid, companyId: risk.companyId } }),
    ]);
    revalidateAll();
    return ok(undefined, person ? `${person.name} owns this risk` : "Owner cleared");
  });
}

export async function setOpportunityStatus(opportunityId: string, status: string): Promise<ActionResult> {
  return attempt(async () => {
    const viewer = await requireCapability("workspace.edit");
    const oid = id.parse(opportunityId);
    const next = z.enum(OpportunityStatus).parse(status);
    const opp = await db.opportunity.findUnique({ where: { id: oid } });
    if (!opp) return fail("Opportunity not found");
    if (opp.status === next) return ok(undefined, "No change");
    const closed = next === "WON" || next === "LOST" || next === "DISMISSED";
    await db.$transaction([
      db.opportunity.update({ where: { id: oid }, data: { status: next, closedAt: closed ? new Date() : null } }),
      db.activity.create({
        data: { type: "STATUS_CHANGED", summary: `Opportunity ${OPPORTUNITY_STATUS[next].label.toLowerCase()}: ${opp.title}`, actor: actorOf(viewer), opportunityId: oid, companyId: opp.companyId, goalId: opp.goalId, metadata: { from: opp.status, to: next } },
      }),
    ]);
    revalidateAll();
    return ok(undefined, OPPORTUNITY_STATUS[next].label);
  });
}

/** A CEO task to pursue an opportunity (idempotent); marks the opportunity as pursuing. */
export async function createOpportunityTask(opportunityId: string): Promise<ActionResult<{ taskId: string }>> {
  return attempt(async () => {
    const viewer = await requireCapability("workspace.edit");
    const oid = id.parse(opportunityId);
    const opp = await db.opportunity.findUnique({ where: { id: oid }, include: { goal: { select: { pillarId: true } } } });
    if (!opp) return fail("Opportunity not found");
    const ref = `opportunity:${oid}`;
    const existing = await db.task.findFirst({ where: { sourceRef: ref, status: { notIn: ["DONE", "CANCELLED"] } }, select: { id: true } });
    if (existing) return ok({ taskId: existing.id }, "Already being pursued");
    const ceo = await getCeoContext();
    const due = addDays(ceo.today, 3);
    const focus = opp.kind === "FUNDRAISING" ? "FUNDRAISING" : opp.kind === "PARTNERSHIP" ? "PARTNERSHIPS" : opp.kind === "SCIENTIFIC" ? "SCIENCE" : opp.kind === "HIRING" ? "RECRUITING" : "REVENUE";
    const task = await db.task.create({
      data: {
        title: opp.nextStep ? `${opp.nextStep}` : `Pursue: ${opp.title}`,
        description: [opp.description, opp.estimatedValue ? `Estimated value $${Math.round(opp.estimatedValue).toLocaleString("en-US")}.` : null].filter(Boolean).join("\n") || null,
        status: "TODO",
        priority: "P2",
        focusArea: focus,
        dueDate: due,
        originalDueDate: due,
        source: "BRAIN",
        sourceRef: ref,
        ownerId: ceo.personId,
        companyId: opp.companyId,
        goalId: opp.goalId,
        pillarId: opp.goal?.pillarId ?? null,
        people: opp.personId ? { connect: [{ id: opp.personId }] } : undefined,
        strategicImpact: 4,
        revenueImpact: opp.kind === "COMMERCIAL" || opp.kind === "EXPANSION" ? 4 : 1,
        fundraisingImpact: opp.kind === "FUNDRAISING" ? 4 : 0,
        opportunityCost: 3,
        estimatedMinutes: 30,
      },
    });
    await db.$transaction([
      ...(opp.status === "OPEN" ? [db.opportunity.update({ where: { id: oid }, data: { status: "PURSUING" } })] : []),
      db.activity.create({ data: { type: "TASK_CREATED", summary: `Pursuing: ${opp.title}`, actor: actorOf(viewer), taskId: task.id, opportunityId: oid, companyId: opp.companyId } }),
    ]);
    await rescore([task.id]);
    revalidateAll();
    return ok({ taskId: task.id }, "Task created — opportunity marked as pursuing");
  });
}
