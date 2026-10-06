/**
 * Provenance: every record the Brain creates or changes points back to the
 * source that produced it. SourceReference keeps a snapshot of the source
 * (kind, provider, title, external id, url, dates) so traceability survives
 * retention purges and upstream deletion.
 *
 * Roles:  CREATED_FROM    the record was created from this source
 *         UPDATED_FROM    this source changed the record (date, status, value…)
 *         CORROBORATED_BY this source said the same thing again (dedupe hit)
 */
import type { EntityType, ReferenceRole } from "@/generated/prisma/enums";
import type { Tx } from "@/lib/db";
import type { SourceSnapshot, WriteEnv } from "./env";

export interface SourceReferenceInput {
  targetType: EntityType;
  targetId: string;
  item: SourceSnapshot;
  role: ReferenceRole;
  excerpt?: string | null;
  confidence?: number | null;
  engine?: string | null;
  now?: Date;
}

const EXCERPT_MAX = 600;

/** Idempotent per (target, source item, role): re-processing refreshes the excerpt instead of duplicating. */
export async function addSourceReference(tx: Tx, input: SourceReferenceInput) {
  const excerpt = input.excerpt ? input.excerpt.replace(/\s+/g, " ").trim().slice(0, EXCERPT_MAX) : null;
  const where = { targetType_targetId_sourceItemId_role: { targetType: input.targetType, targetId: input.targetId, sourceItemId: input.item.id, role: input.role } };
  const existing = await tx.sourceReference.findUnique({ where, select: { id: true } });
  if (existing) {
    return tx.sourceReference.update({
      where: { id: existing.id },
      data: {
        ...(excerpt ? { excerpt } : {}),
        ...(input.confidence != null ? { confidence: input.confidence } : {}),
        ...(input.engine ? { engine: input.engine } : {}),
      },
    });
  }
  return tx.sourceReference.create({
    data: {
      targetType: input.targetType,
      targetId: input.targetId,
      role: input.role,
      sourceItemId: input.item.id,
      sourceKind: input.item.kind,
      provider: input.item.provider,
      sourceTitle: input.item.title.slice(0, 500),
      sourceExternalId: input.item.externalId,
      sourceUrl: input.item.externalUrl,
      sourceOccurredAt: input.item.occurredAt,
      ingestedAt: input.item.ingestedAt,
      excerpt,
      confidence: input.confidence ?? null,
      engine: input.engine ?? null,
      ...(input.now ? { createdAt: input.now } : {}),
    },
  });
}

/** addSourceReference bound to the write environment (no-op without a source). */
export async function reference(
  env: WriteEnv,
  targetType: EntityType,
  targetId: string,
  role: ReferenceRole,
  opts: { excerpt?: string | null; confidence?: number | null } = {},
) {
  if (!env.source) return null;
  return addSourceReference(env.tx, { targetType, targetId, item: env.source, role, excerpt: opts.excerpt, confidence: opts.confidence, engine: env.engine, now: env.now });
}

/** True when this source already produced or touched the record (re-processing guard). */
export async function hasReferenceFrom(tx: Tx, targetType: EntityType, targetId: string, sourceItemId: string): Promise<boolean> {
  return (await tx.sourceReference.count({ where: { targetType, targetId, sourceItemId } })) > 0;
}

/** Ids of records of a type that a set of source items produced or touched. */
export async function targetsReferencedBy(tx: Tx, targetType: EntityType, sourceItemIds: string[]): Promise<string[]> {
  if (!sourceItemIds.length) return [];
  const rows = await tx.sourceReference.findMany({ where: { targetType, sourceItemId: { in: sourceItemIds } }, select: { targetId: true }, distinct: ["targetId"] });
  return rows.map((r) => r.targetId);
}
