/**
 * Knowledge-graph lookups for search, Prepare Me and the Chief of Staff.
 *
 * Calls the graph contract (src/server/ingestion/graph.ts) and, while it is
 * not implemented (it throws) or when it fails, answers from hard foreign
 * keys, EntityMention rows and Relationship edges directly. Results are ids
 * only: callers must still filter source items through the viewer's access
 * scope before reading anything.
 */
import type { EntityType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { companyFamilyIds, neighbors, sourceItemIdsForEntity, type GraphNeighbor, type GraphNode } from "../graph";

/** A company plus its parent, siblings and subsidiaries. */
export async function familyOf(companyId: string): Promise<string[]> {
  try {
    const ids = await companyFamilyIds(companyId);
    if (ids.length) return [...new Set([companyId, ...ids])];
  } catch {
    // Contract not available yet: fall back to Company.parentId.
  }
  const c = await db.company.findUnique({
    where: { id: companyId },
    select: { id: true, parentId: true, subsidiaries: { select: { id: true } }, parent: { select: { subsidiaries: { select: { id: true } } } } },
  });
  if (!c) return [companyId];
  return [...new Set([c.id, ...(c.parentId ? [c.parentId] : []), ...c.subsidiaries.map((s) => s.id), ...(c.parent?.subsidiaries.map((s) => s.id) ?? [])])];
}

export async function familiesOf(companyIds: string[]): Promise<string[]> {
  const all = await Promise.all([...new Set(companyIds)].map(familyOf));
  return [...new Set(all.flat())];
}

/** Source items connected to an entity, newest first (unfiltered ids). */
export async function sourceItemsFor(node: GraphNode, opts: { limit?: number; since?: Date } = {}): Promise<string[]> {
  const limit = opts.limit ?? 200;
  try {
    return await sourceItemIdsForEntity(node, { limit, since: opts.since });
  } catch {
    // Fallback: mentions resolved to the entity + relationship evidence.
  }
  const [mentions, edges] = await Promise.all([
    db.entityMention.findMany({
      where: { entityType: node.type, entityId: node.id, ...(opts.since ? { sourceItem: { occurredAt: { gte: opts.since } } } : {}) },
      select: { sourceItemId: true, sourceItem: { select: { occurredAt: true } } },
      orderBy: { sourceItem: { occurredAt: "desc" } },
      take: limit,
    }),
    db.relationship.findMany({
      where: { sourceItemId: { not: null }, OR: [{ fromType: node.type, fromId: node.id }, { toType: node.type, toId: node.id }] },
      select: { sourceItemId: true, lastSeenAt: true },
      orderBy: { lastSeenAt: "desc" },
      take: limit,
    }),
  ]);
  return [...new Set([...mentions.map((m) => m.sourceItemId), ...edges.map((e) => e.sourceItemId!).filter(Boolean)])].slice(0, limit);
}

export async function sourceItemsForMany(nodes: GraphNode[], opts: { limit?: number; since?: Date } = {}): Promise<string[]> {
  const all = await Promise.all(nodes.map((n) => sourceItemsFor(n, opts)));
  return [...new Set(all.flat())];
}

/** Graph neighbours, or Relationship edges read directly. */
export async function neighborsOf(node: GraphNode, opts: { types?: EntityType[]; limit?: number } = {}): Promise<GraphNeighbor[]> {
  try {
    return await neighbors(node, { types: opts.types, limit: opts.limit });
  } catch {
    // Fallback below.
  }
  const edges = await db.relationship.findMany({
    where: {
      validTo: null,
      OR: [
        { fromType: node.type, fromId: node.id, ...(opts.types ? { toType: { in: opts.types } } : {}) },
        { toType: node.type, toId: node.id, ...(opts.types ? { fromType: { in: opts.types } } : {}) },
      ],
    },
    orderBy: [{ confidence: "desc" }, { lastSeenAt: "desc" }],
    take: opts.limit ?? 100,
  });
  return edges.map((e) => {
    const out = e.fromType === node.type && e.fromId === node.id;
    return {
      type: out ? e.toType : e.fromType,
      id: out ? e.toId : e.fromId,
      relation: e.relation,
      direction: out ? ("out" as const) : ("in" as const),
      confidence: e.confidence,
      evidenceCount: e.evidenceCount,
      lastSeenAt: e.lastSeenAt,
    };
  });
}
