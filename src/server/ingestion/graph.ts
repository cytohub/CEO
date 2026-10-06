/**
 * Knowledge-graph queries over Relationship edges + hard foreign keys.
 *
 * Relationship rows carry evidence (count, confidence, last seen); hard
 * foreign keys (Person.companyId, Company.parentId, Meeting attendees, thread
 * and document company links) are folded in so a freshly seeded workspace
 * answers the same questions as one built by ingestion.
 */
import type { EntityType, RelationType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

export interface GraphNode {
  type: EntityType;
  id: string;
}

export interface GraphNeighbor extends GraphNode {
  relation: RelationType;
  direction: "out" | "in";
  confidence: number;
  evidenceCount: number;
  lastSeenAt: Date;
}

const EPOCH = new Date(0);

export async function neighbors(node: GraphNode, opts: { relations?: RelationType[]; types?: EntityType[]; limit?: number } = {}): Promise<GraphNeighbor[]> {
  const relationFilter = opts.relations?.length ? { relation: { in: opts.relations } } : {};
  const [outs, ins] = await Promise.all([
    db.relationship.findMany({
      where: { fromType: node.type, fromId: node.id, validTo: null, ...relationFilter, ...(opts.types?.length ? { toType: { in: opts.types } } : {}) },
      orderBy: [{ evidenceCount: "desc" }, { lastSeenAt: "desc" }],
      take: 500,
    }),
    db.relationship.findMany({
      where: { toType: node.type, toId: node.id, validTo: null, ...relationFilter, ...(opts.types?.length ? { fromType: { in: opts.types } } : {}) },
      orderBy: [{ evidenceCount: "desc" }, { lastSeenAt: "desc" }],
      take: 500,
    }),
  ]);

  const out = new Map<string, GraphNeighbor>();
  const add = (n: GraphNeighbor) => {
    if (opts.relations?.length && !opts.relations.includes(n.relation)) return;
    if (opts.types?.length && !opts.types.includes(n.type)) return;
    const key = `${n.direction}:${n.relation}:${n.type}:${n.id}`;
    const prev = out.get(key);
    if (!prev || prev.evidenceCount < n.evidenceCount) out.set(key, n);
  };
  for (const r of outs) add({ type: r.toType, id: r.toId, relation: r.relation, direction: "out", confidence: r.confidence, evidenceCount: r.evidenceCount, lastSeenAt: r.lastSeenAt });
  for (const r of ins) add({ type: r.fromType, id: r.fromId, relation: r.relation, direction: "in", confidence: r.confidence, evidenceCount: r.evidenceCount, lastSeenAt: r.lastSeenAt });

  // Hard foreign keys, as edges with no recorded evidence count.
  const hard = (n: Omit<GraphNeighbor, "confidence" | "evidenceCount" | "lastSeenAt"> & { lastSeenAt?: Date | null }) =>
    add({ ...n, confidence: 1, evidenceCount: 0, lastSeenAt: n.lastSeenAt ?? EPOCH });
  if (node.type === "PERSON") {
    const p = await db.person.findUnique({ where: { id: node.id }, select: { companyId: true, lastContactAt: true } });
    if (p?.companyId) hard({ type: "COMPANY", id: p.companyId, relation: "WORKS_AT", direction: "out", lastSeenAt: p.lastContactAt });
  } else if (node.type === "COMPANY") {
    const c = await db.company.findUnique({
      where: { id: node.id },
      select: { parentId: true, subsidiaries: { select: { id: true } }, people: { select: { id: true, lastContactAt: true }, take: 200 } },
    });
    if (c?.parentId) hard({ type: "COMPANY", id: c.parentId, relation: "SUBSIDIARY_OF", direction: "out" });
    for (const s of c?.subsidiaries ?? []) hard({ type: "COMPANY", id: s.id, relation: "SUBSIDIARY_OF", direction: "in" });
    for (const p of c?.people ?? []) hard({ type: "PERSON", id: p.id, relation: "WORKS_AT", direction: "in", lastSeenAt: p.lastContactAt });
  }

  return [...out.values()]
    .sort((a, b) => b.evidenceCount - a.evidenceCount || b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
    .slice(0, opts.limit ?? 100);
}

/** Source items connected to an entity (mentions, threads/documents about it, meetings it attended). Newest first. */
export async function sourceItemIdsForEntity(node: GraphNode, opts: { limit?: number; since?: Date } = {}): Promise<string[]> {
  const ids = new Set<string>();
  const addAll = (rows: { sourceItemId: string | null }[]) => rows.forEach((r) => r.sourceItemId && ids.add(r.sourceItemId));
  const since = opts.since ? { gte: opts.since } : undefined;

  const [mentions, edges] = await Promise.all([
    db.entityMention.findMany({ where: { entityType: node.type, entityId: node.id }, select: { sourceItemId: true }, take: 2000 }),
    db.relationship.findMany({ where: { fromType: "SOURCE_ITEM", toType: node.type, toId: node.id }, select: { fromId: true }, take: 2000 }),
  ]);
  addAll(mentions);
  for (const e of edges) ids.add(e.fromId);

  const meetingItems = async (meetingIds: string[]) => {
    if (!meetingIds.length) return;
    const [events, notes] = await Promise.all([
      db.calendarEvent.findMany({ where: { meetingId: { in: meetingIds } }, select: { sourceItemId: true } }),
      db.sourceItem.findMany({ where: { meetingId: { in: meetingIds } }, select: { id: true } }),
    ]);
    addAll(events);
    for (const n of notes) ids.add(n.id);
  };

  switch (node.type) {
    case "COMPANY": {
      const [threads, docs, meetings] = await Promise.all([
        db.emailMessage.findMany({ where: { thread: { companyId: node.id } }, select: { sourceItemId: true }, take: 2000 }),
        db.document.findMany({ where: { companyId: node.id }, select: { sourceItemId: true } }),
        db.meeting.findMany({ where: { companyId: node.id }, select: { id: true } }),
      ]);
      addAll(threads);
      addAll(docs);
      await meetingItems(meetings.map((m) => m.id));
      break;
    }
    case "PERSON": {
      const person = await db.person.findUnique({ where: { id: node.id }, select: { email: true, meetings: { select: { id: true } } } });
      const emails = [person?.email, ...(await db.entityAlias.findMany({ where: { entityType: "PERSON", entityId: node.id, kind: "EMAIL" }, select: { normalized: true } })).map((a) => a.normalized)].filter(
        (e): e is string => !!e,
      );
      if (emails.length) addAll(await db.emailMessage.findMany({ where: { fromEmail: { in: emails } }, select: { sourceItemId: true }, take: 2000 }));
      await meetingItems(person?.meetings.map((m) => m.id) ?? []);
      break;
    }
    case "PROJECT":
      addAll(await db.document.findMany({ where: { projectId: node.id }, select: { sourceItemId: true } }));
      break;
    case "MEETING":
      await meetingItems([node.id]);
      break;
    case "DEAL":
      addAll(await db.emailMessage.findMany({ where: { thread: { dealId: node.id } }, select: { sourceItemId: true }, take: 2000 }));
      break;
    case "EMAIL_THREAD":
      addAll(await db.emailMessage.findMany({ where: { threadId: node.id }, select: { sourceItemId: true } }));
      break;
    case "DOCUMENT": {
      const d = await db.document.findUnique({ where: { id: node.id }, select: { sourceItemId: true } });
      if (d) ids.add(d.sourceItemId);
      break;
    }
    default: {
      // Intelligence records: the sources that created, updated or corroborated them.
      addAll(await db.sourceReference.findMany({ where: { targetType: node.type, targetId: node.id }, select: { sourceItemId: true } }));
    }
  }

  if (!ids.size) return [];
  const rows = await db.sourceItem.findMany({
    where: { id: { in: [...ids] }, ...(since ? { occurredAt: since } : {}) },
    select: { id: true },
    orderBy: { occurredAt: "desc" },
    take: opts.limit ?? 200,
  });
  return rows.map((r) => r.id);
}

/** A company plus its corporate family (parent and subsidiaries), for "everything related to J&J". */
export async function companyFamilyIds(companyId: string): Promise<string[]> {
  // Walk up to the root (FK first, SUBSIDIARY_OF edges as a fallback), then collect every descendant.
  let root = companyId;
  const visitedUp = new Set<string>([root]);
  for (let i = 0; i < 6; i++) {
    const c = await db.company.findUnique({ where: { id: root }, select: { parentId: true } });
    let parent = c?.parentId ?? null;
    if (!parent) {
      const e = await db.relationship.findFirst({ where: { fromType: "COMPANY", fromId: root, relation: "SUBSIDIARY_OF", toType: "COMPANY", validTo: null }, orderBy: { confidence: "desc" }, select: { toId: true } });
      parent = e?.toId ?? null;
    }
    if (!parent || visitedUp.has(parent)) break;
    visitedUp.add(parent);
    root = parent;
  }

  const family = new Set<string>([root]);
  let frontier = [root];
  for (let depth = 0; depth < 6 && frontier.length; depth++) {
    const [children, edges] = await Promise.all([
      db.company.findMany({ where: { parentId: { in: frontier } }, select: { id: true } }),
      db.relationship.findMany({ where: { relation: "SUBSIDIARY_OF", toType: "COMPANY", toId: { in: frontier }, fromType: "COMPANY", validTo: null }, select: { fromId: true } }),
    ]);
    const next: string[] = [];
    for (const id of [...children.map((c) => c.id), ...edges.map((e) => e.fromId)]) {
      if (!family.has(id)) {
        family.add(id);
        next.push(id);
      }
    }
    frontier = next;
  }
  family.add(companyId);
  return [...family];
}
