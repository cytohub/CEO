/**
 * Visibility of intelligence derived from sources.
 *
 * A commitment, risk, task or insight extracted from a restricted email is
 * itself restricted material: its title and quote come from that email. For
 * viewers without unrestricted access, derived records are shown only when
 * every source they were created or updated from is readable (SourceReference
 * provenance). Records whose provenance snapshot outlived its source (purged)
 * are shown only to unrestricted viewers.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EntityType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { type AccessScope, documentWhere, emailThreadWhere, sourceItemWhere } from "@/server/security/access";

/** Ids (of `targetType` records) the viewer must not see because of their provenance. */
export async function hiddenByProvenance(scope: AccessScope, targetType: EntityType, ids: string[]): Promise<Set<string>> {
  const hidden = new Set<string>();
  if (scope.all || ids.length === 0) return hidden;
  const refs = await db.sourceReference.findMany({ where: { targetType, targetId: { in: ids } }, select: { targetId: true, sourceItemId: true } });
  if (!refs.length) return hidden;
  const sourceIds = [...new Set(refs.map((r) => r.sourceItemId).filter((x): x is string => Boolean(x)))];
  const readable = new Set(
    sourceIds.length ? (await db.sourceItem.findMany({ where: { AND: [{ id: { in: sourceIds } }, sourceItemWhere(scope)] }, select: { id: true } })).map((s) => s.id) : [],
  );
  for (const r of refs) if (!r.sourceItemId || !readable.has(r.sourceItemId)) hidden.add(r.targetId);
  return hidden;
}

/** Drop records hidden by provenance (order preserved). */
export async function filterByProvenance<T extends { id: string }>(scope: AccessScope, targetType: EntityType, rows: T[]): Promise<T[]> {
  if (scope.all || rows.length === 0) return rows;
  const hidden = await hiddenByProvenance(scope, targetType, rows.map((r) => r.id));
  return hidden.size ? rows.filter((r) => !hidden.has(r.id)) : rows;
}

/** Commitments: the thread they came from must be readable. */
export function commitmentAccessWhere(scope: AccessScope): Prisma.CommitmentWhereInput {
  if (scope.all) return {};
  return { OR: [{ threadId: null }, { thread: emailThreadWhere(scope) }] };
}

/** Insights: their source item and document (if any) must be readable. */
export function insightAccessWhere(scope: AccessScope): Prisma.BrainInsightWhereInput {
  if (scope.all) return {};
  return {
    AND: [{ OR: [{ sourceItemId: null }, { sourceItem: sourceItemWhere(scope) }] }, { OR: [{ documentId: null }, { document: documentWhere(scope) }] }],
  };
}
