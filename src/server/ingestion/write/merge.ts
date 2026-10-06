/**
 * Entity merges (two companies or two people that are the same thing).
 *
 * Runs inside the caller's transaction: every foreign key and many-to-many
 * link is re-pointed to the kept record, graph edges are folded together,
 * the merged record's name/email/domain become aliases of the kept one, and
 * the duplicate is deleted. History is kept: Activity rows are re-pointed,
 * never removed, and an ENTITY_MERGED entry records what happened.
 */
import type { EntityType } from "@/generated/prisma/enums";
import type { Tx } from "@/lib/db";
import type { WriteEnv } from "./env";
import { recordActivity } from "./history";
import { addAlias } from "./records";

export class MergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MergeError";
  }
}

/** Re-point graph edges from `dropId` to `keepId`, folding evidence into existing edges. */
export async function repointEdges(tx: Tx, type: EntityType, dropId: string, keepId: string) {
  const edges = await tx.relationship.findMany({ where: { OR: [{ fromType: type, fromId: dropId }, { toType: type, toId: dropId }] } });
  for (const e of edges) {
    const fromId = e.fromType === type && e.fromId === dropId ? keepId : e.fromId;
    const toId = e.toType === type && e.toId === dropId ? keepId : e.toId;
    if (e.fromType === e.toType && fromId === toId) {
      await tx.relationship.delete({ where: { id: e.id } });
      continue;
    }
    const twin = await tx.relationship.findUnique({ where: { fromType_fromId_relation_toType_toId: { fromType: e.fromType, fromId, relation: e.relation, toType: e.toType, toId } } });
    if (twin && twin.id !== e.id) {
      await tx.relationship.update({
        where: { id: twin.id },
        data: {
          evidenceCount: twin.evidenceCount + e.evidenceCount,
          confidence: Math.max(twin.confidence, e.confidence),
          firstSeenAt: e.firstSeenAt < twin.firstSeenAt ? e.firstSeenAt : twin.firstSeenAt,
          lastSeenAt: e.lastSeenAt > twin.lastSeenAt ? e.lastSeenAt : twin.lastSeenAt,
        },
      });
      await tx.relationship.delete({ where: { id: e.id } });
    } else {
      await tx.relationship.update({ where: { id: e.id }, data: { fromId, toId } });
    }
  }
}

async function repointAliases(tx: Tx, type: "PERSON" | "COMPANY", dropId: string, keepId: string) {
  const aliases = await tx.entityAlias.findMany({ where: { entityType: type, entityId: dropId } });
  for (const a of aliases) {
    const twin = await tx.entityAlias.findUnique({ where: { entityType_entityId_normalized: { entityType: type, entityId: keepId, normalized: a.normalized } }, select: { id: true } });
    if (twin) await tx.entityAlias.delete({ where: { id: a.id } });
    else await tx.entityAlias.update({ where: { id: a.id }, data: { entityId: keepId } });
  }
}

async function repointProvenance(tx: Tx, type: EntityType, dropId: string, keepId: string) {
  const refs = await tx.sourceReference.findMany({ where: { targetType: type, targetId: dropId }, select: { id: true, sourceItemId: true, role: true } });
  for (const r of refs) {
    const twin = await tx.sourceReference.findFirst({ where: { targetType: type, targetId: keepId, sourceItemId: r.sourceItemId, role: r.role }, select: { id: true } });
    if (twin) await tx.sourceReference.delete({ where: { id: r.id } });
    else await tx.sourceReference.update({ where: { id: r.id }, data: { targetId: keepId } });
  }
  await tx.entityMention.updateMany({ where: { entityType: type, entityId: dropId }, data: { entityId: keepId } });
  await tx.reviewQueueItem.updateMany({ where: { targetType: type, targetId: dropId }, data: { targetId: keepId } });
}

export async function mergeCompanies(env: WriteEnv, keepId: string, dropId: string): Promise<{ id: string }> {
  const { tx } = env;
  if (keepId === dropId) throw new MergeError("Cannot merge a company into itself.");
  const [keep, drop] = await Promise.all([tx.company.findUnique({ where: { id: keepId } }), tx.company.findUnique({ where: { id: dropId } })]);
  if (!keep || !drop) throw new MergeError("One of the companies no longer exists.");

  // Family links: never leave the kept company pointing at the one being removed.
  if (keep.parentId === drop.id) await tx.company.update({ where: { id: keep.id }, data: { parentId: drop.parentId && drop.parentId !== keep.id ? drop.parentId : null } });
  await tx.company.updateMany({ where: { parentId: drop.id, id: { not: keep.id } }, data: { parentId: keep.id } });

  const byCompany = { where: { companyId: drop.id }, data: { companyId: keep.id } };
  await Promise.all([
    tx.person.updateMany(byCompany),
    tx.task.updateMany(byCompany),
    tx.deal.updateMany(byCompany),
    tx.meeting.updateMany(byCompany),
    tx.inboxItem.updateMany(byCompany),
    tx.brainInsight.updateMany(byCompany),
    tx.activity.updateMany(byCompany),
    tx.note.updateMany(byCompany),
    tx.commitment.updateMany(byCompany),
    tx.risk.updateMany(byCompany),
    tx.opportunity.updateMany(byCompany),
    tx.document.updateMany(byCompany),
    tx.emailThread.updateMany(byCompany),
    tx.brainSignal.updateMany(byCompany),
  ]);
  for (const r of await tx.resource.findMany({ where: { companies: { some: { id: drop.id } } }, select: { id: true } })) {
    await tx.resource.update({ where: { id: r.id }, data: { companies: { connect: { id: keep.id }, disconnect: { id: drop.id } } } });
  }
  for (const d of await tx.decision.findMany({ where: { companies: { some: { id: drop.id } } }, select: { id: true } })) {
    await tx.decision.update({ where: { id: d.id }, data: { companies: { connect: { id: keep.id }, disconnect: { id: drop.id } } } });
  }

  await repointEdges(tx, "COMPANY", drop.id, keep.id);
  await repointAliases(tx, "COMPANY", drop.id, keep.id);
  await repointProvenance(tx, "COMPANY", drop.id, keep.id);
  await addAlias(tx, "COMPANY", keep.id, drop.name, "NAME", "USER", 1, env.now);
  if (drop.domain && drop.domain !== keep.domain) await addAlias(tx, "COMPANY", keep.id, drop.domain, "DOMAIN", "USER", 1, env.now);

  await tx.company.delete({ where: { id: drop.id } });
  await tx.company.update({
    where: { id: keep.id },
    data: {
      domain: keep.domain ?? drop.domain,
      website: keep.website ?? drop.website,
      industry: keep.industry ?? drop.industry,
      description: keep.description ?? drop.description,
      location: keep.location ?? drop.location,
      relationship: Math.max(keep.relationship, drop.relationship),
      lastActivityAt: !keep.lastActivityAt || (drop.lastActivityAt && drop.lastActivityAt > keep.lastActivityAt) ? drop.lastActivityAt : keep.lastActivityAt,
    },
  });
  await recordActivity(env, "ENTITY_MERGED", `Merged company “${drop.name}” into “${keep.name}”`, { companyId: keep.id }, { entity: "COMPANY", mergedId: drop.id, mergedName: drop.name, keptId: keep.id });
  return { id: keep.id };
}

export async function mergePeople(env: WriteEnv, keepId: string, dropId: string): Promise<{ id: string }> {
  const { tx } = env;
  if (keepId === dropId) throw new MergeError("Cannot merge a person into themselves.");
  const [keep, drop] = await Promise.all([
    tx.person.findUnique({ where: { id: keepId }, include: { user: { select: { id: true } } } }),
    tx.person.findUnique({ where: { id: dropId }, include: { user: { select: { id: true } } } }),
  ]);
  if (!keep || !drop) throw new MergeError("One of the people no longer exists.");
  if (drop.isCeo) throw new MergeError("The CEO's record can only be the one kept.");
  if (keep.user && drop.user) throw new MergeError("Both people have sign-in accounts; deactivate one first.");

  await Promise.all([
    tx.goal.updateMany({ where: { ownerId: drop.id }, data: { ownerId: keep.id } }),
    tx.milestone.updateMany({ where: { ownerId: drop.id }, data: { ownerId: keep.id } }),
    tx.task.updateMany({ where: { ownerId: drop.id }, data: { ownerId: keep.id } }),
    tx.task.updateMany({ where: { suggestedDelegateId: drop.id }, data: { suggestedDelegateId: keep.id } }),
    tx.decision.updateMany({ where: { ownerId: drop.id }, data: { ownerId: keep.id } }),
    tx.delegation.updateMany({ where: { delegateId: drop.id }, data: { delegateId: keep.id } }),
    tx.deal.updateMany({ where: { ownerId: drop.id }, data: { ownerId: keep.id } }),
    tx.brainInsight.updateMany({ where: { personId: drop.id }, data: { personId: keep.id } }),
    tx.inboxItem.updateMany({ where: { personId: drop.id }, data: { personId: keep.id } }),
    tx.note.updateMany({ where: { personId: drop.id }, data: { personId: keep.id } }),
    tx.activity.updateMany({ where: { personId: drop.id }, data: { personId: keep.id } }),
    tx.brainSignal.updateMany({ where: { personId: drop.id }, data: { personId: keep.id } }),
    tx.commitment.updateMany({ where: { ownerPersonId: drop.id }, data: { ownerPersonId: keep.id } }),
    tx.commitment.updateMany({ where: { counterpartyPersonId: drop.id }, data: { counterpartyPersonId: keep.id } }),
    tx.risk.updateMany({ where: { ownerPersonId: drop.id }, data: { ownerPersonId: keep.id } }),
    tx.opportunity.updateMany({ where: { personId: drop.id }, data: { personId: keep.id } }),
  ]);
  for (const t of await tx.task.findMany({ where: { people: { some: { id: drop.id } } }, select: { id: true } })) {
    await tx.task.update({ where: { id: t.id }, data: { people: { connect: { id: keep.id }, disconnect: { id: drop.id } } } });
  }
  for (const m of await tx.meeting.findMany({ where: { attendees: { some: { id: drop.id } } }, select: { id: true } })) {
    await tx.meeting.update({ where: { id: m.id }, data: { attendees: { connect: { id: keep.id }, disconnect: { id: drop.id } } } });
  }
  for (const r of await tx.resource.findMany({ where: { people: { some: { id: drop.id } } }, select: { id: true } })) {
    await tx.resource.update({ where: { id: r.id }, data: { people: { connect: { id: keep.id }, disconnect: { id: drop.id } } } });
  }
  if (drop.user) await tx.user.update({ where: { id: drop.user.id }, data: { personId: keep.id } });

  await repointEdges(tx, "PERSON", drop.id, keep.id);
  await repointAliases(tx, "PERSON", drop.id, keep.id);
  await repointProvenance(tx, "PERSON", drop.id, keep.id);
  await addAlias(tx, "PERSON", keep.id, drop.name, "NAME", "USER", 1, env.now);
  if (drop.email && drop.email !== keep.email) await addAlias(tx, "PERSON", keep.id, drop.email, "EMAIL", "USER", 1, env.now);

  await tx.person.delete({ where: { id: drop.id } });
  await tx.person.update({
    where: { id: keep.id },
    data: {
      email: keep.email ?? drop.email,
      title: keep.title ?? drop.title,
      companyId: keep.companyId ?? drop.companyId,
      department: keep.department ?? drop.department,
      notesText: [keep.notesText, drop.notesText].filter(Boolean).join("\n\n") || null,
      lastContactAt: !keep.lastContactAt || (drop.lastContactAt && drop.lastContactAt > keep.lastContactAt) ? drop.lastContactAt : keep.lastContactAt,
      ...(keep.type === "OTHER" && drop.type !== "OTHER" ? { type: drop.type } : {}),
    },
  });
  await recordActivity(env, "ENTITY_MERGED", `Merged contact “${drop.name}” into “${keep.name}”`, { personId: keep.id, companyId: keep.companyId ?? drop.companyId }, { entity: "PERSON", mergedId: drop.id, mergedName: drop.name, keptId: keep.id });
  return { id: keep.id };
}
