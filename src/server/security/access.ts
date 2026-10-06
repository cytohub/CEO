/**
 * Source-level permissions. Every read of ingested content — search, View
 * Source, thread and document pages, Prepare Me, the Chief of Staff — builds
 * its query from these filters, so restricted material can never leak through
 * a summary, an excerpt or an AI answer.
 *
 * A viewer can read a source item when ANY of these hold:
 *   • their role clearance covers the item's sensitivity;
 *   • they own the connection it came from;
 *   • an AccessGrant (to them or their role) covers the item, its document,
 *     its email thread or its connection.
 */
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import type { Sensitivity, UserRole } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { sensitivityLevelsFor, ROLE_CLEARANCE } from "./rbac";
import type { Viewer } from "./session";

export interface AccessScope {
  /** Unrestricted (CEO). */
  all: boolean;
  levels: Sensitivity[];
  connectionIds: string[];
  sourceItemIds: string[];
  documentIds: string[];
  threadIds: string[];
}

const NONE = "__no_access__";

async function computeScope(userId: string, role: UserRole): Promise<AccessScope> {
  const clearance = ROLE_CLEARANCE[role];
  if (clearance === "RESTRICTED") return { all: true, levels: sensitivityLevelsFor(clearance), connectionIds: [], sourceItemIds: [], documentIds: [], threadIds: [] };
  const now = new Date();
  const [grants, owned] = await Promise.all([
    db.accessGrant.findMany({
      where: { OR: [{ userId }, { role }], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] },
      select: { resourceType: true, resourceId: true },
    }),
    db.sourceConnection.findMany({ where: { ownerUserId: userId }, select: { id: true } }),
  ]);
  const of = (t: string) => grants.filter((g) => g.resourceType === t).map((g) => g.resourceId);
  return {
    all: false,
    levels: sensitivityLevelsFor(clearance),
    connectionIds: [...owned.map((c) => c.id), ...of("CONNECTION")],
    sourceItemIds: of("SOURCE_ITEM"),
    documentIds: of("DOCUMENT"),
    threadIds: of("EMAIL_THREAD"),
  };
}

const scopeFor = cache(computeScope);

export function getAccessScope(viewer: Pick<Viewer, "userId" | "role">): Promise<AccessScope> {
  return scopeFor(viewer.userId, viewer.role);
}

/** Scope used by system jobs (the Brain itself reads everything). */
export const SYSTEM_SCOPE: AccessScope = { all: true, levels: ["INTERNAL", "CONFIDENTIAL", "RESTRICTED"], connectionIds: [], sourceItemIds: [], documentIds: [], threadIds: [] };

export function sourceItemWhere(scope: AccessScope): Prisma.SourceItemWhereInput {
  if (scope.all) return {};
  const or: Prisma.SourceItemWhereInput[] = [];
  if (scope.levels.length) or.push({ sensitivity: { in: scope.levels } });
  if (scope.connectionIds.length) or.push({ connectionId: { in: scope.connectionIds } });
  if (scope.sourceItemIds.length) or.push({ id: { in: scope.sourceItemIds } });
  if (scope.documentIds.length) or.push({ document: { id: { in: scope.documentIds } } });
  if (scope.threadIds.length) or.push({ emailMessage: { threadId: { in: scope.threadIds } } });
  return or.length ? { OR: or } : { id: NONE };
}

export function emailThreadWhere(scope: AccessScope): Prisma.EmailThreadWhereInput {
  if (scope.all) return {};
  const or: Prisma.EmailThreadWhereInput[] = [];
  if (scope.levels.length) or.push({ sensitivity: { in: scope.levels } });
  if (scope.connectionIds.length) or.push({ connectionId: { in: scope.connectionIds } });
  if (scope.threadIds.length) or.push({ id: { in: scope.threadIds } });
  return or.length ? { OR: or } : { id: NONE };
}

export function documentWhere(scope: AccessScope): Prisma.DocumentWhereInput {
  if (scope.all) return {};
  const or: Prisma.DocumentWhereInput[] = [];
  if (scope.levels.length) or.push({ sensitivity: { in: scope.levels } });
  if (scope.connectionIds.length) or.push({ sourceItem: { connectionId: { in: scope.connectionIds } } });
  if (scope.documentIds.length) or.push({ id: { in: scope.documentIds } });
  if (scope.sourceItemIds.length) or.push({ sourceItemId: { in: scope.sourceItemIds } });
  return or.length ? { OR: or } : { id: NONE };
}

export function reviewItemWhere(scope: AccessScope): Prisma.ReviewQueueItemWhereInput {
  if (scope.all) return {};
  return scope.levels.length ? { sensitivity: { in: scope.levels } } : { id: NONE };
}

/**
 * Provenance rows are visible when their source item is readable. Rows whose
 * source item was deleted fall back to the snapshot and are shown only to
 * unrestricted viewers.
 */
export function sourceReferenceWhere(scope: AccessScope): Prisma.SourceReferenceWhereInput {
  if (scope.all) return {};
  return { sourceItem: sourceItemWhere(scope) };
}

export async function canReadSourceItem(scope: AccessScope, sourceItemId: string): Promise<boolean> {
  if (scope.all) return true;
  const n = await db.sourceItem.count({ where: { AND: [{ id: sourceItemId }, sourceItemWhere(scope)] } });
  return n > 0;
}
