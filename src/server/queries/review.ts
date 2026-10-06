/**
 * Brain Review Queue: pending items (impact, then age) and resolution history,
 * filtered by the viewer's clearance. Enriches each item with what its
 * dedicated renderer needs: both sides of an entity merge, the record a field
 * change targets, the document a change belongs to, merge candidates and a
 * readable source line.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EntityType, ReviewKind, ReviewStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { COMPANY_TYPES, PERSON_TYPES } from "@/lib/domain";
import { getIn, isPlainObject, readCandidates, readChanges, type Candidate, type ChangeRow } from "@/components/intelligence/model";
import { getCeoContext } from "@/server/context";
import { documentWhere, getAccessScope, reviewItemWhere, sourceItemWhere } from "@/server/security/access";
import { resolveRecords, type DerivedRecord, type ProvenanceViewer } from "./provenance";

export type ReviewTab = "pending" | "resolved";

const itemInclude = {
  resolvedBy: { select: { name: true, email: true } },
  sourceItem: {
    select: {
      id: true,
      kind: true,
      title: true,
      occurredAt: true,
      connection: { select: { provider: true } },
      emailMessage: { select: { fromName: true, fromEmail: true } },
      calendarEvent: { select: { organizerName: true } },
      document: { select: { author: true } },
    },
  },
} satisfies Prisma.ReviewQueueItemInclude;

export interface MergeSide {
  id: string;
  label: string;
  href: string;
  fields: { label: string; value: string }[];
  /** Linked-record counts, labelled [singular, plural]. */
  counts: { label: [string, string]; value: number }[];
  createdAt: Date;
}

async function mergeSides(entityType: unknown, ids: string[]): Promise<MergeSide[]> {
  if (!ids.length) return [];
  if (entityType === "PERSON") {
    const people = await db.person.findMany({
      where: { id: { in: ids } },
      include: { company: { select: { name: true } }, _count: { select: { ownedTasks: true, relatedTasks: true, meetings: true, commitmentsOwned: true, commitmentsOwed: true, opportunities: true } } },
    });
    return people.map((p) => ({
      id: p.id,
      label: p.name,
      href: `/resources/people/${p.id}`,
      createdAt: p.createdAt,
      fields: [
        { label: "Email", value: p.email ?? "—" },
        { label: "Title", value: p.title ?? "—" },
        { label: "Company", value: p.company?.name ?? "—" },
        { label: "Type", value: PERSON_TYPES[p.type].label },
      ],
      counts: [
        { label: ["task", "tasks"], value: p._count.ownedTasks + p._count.relatedTasks },
        { label: ["meeting", "meetings"], value: p._count.meetings },
        { label: ["commitment", "commitments"], value: p._count.commitmentsOwned + p._count.commitmentsOwed },
        { label: ["opportunity", "opportunities"], value: p._count.opportunities },
      ],
    }));
  }
  const companies = await db.company.findMany({
    where: { id: { in: ids } },
    include: { parent: { select: { name: true } }, _count: { select: { tasks: true, deals: true, meetings: true, threads: true, people: true, documents: true } } },
  });
  return companies.map((c) => ({
    id: c.id,
    label: c.name,
    href: `/resources/companies/${c.id}`,
    createdAt: c.createdAt,
    fields: [
      { label: "Type", value: COMPANY_TYPES[c.type].label },
      { label: "Domain", value: c.domain ?? "—" },
      { label: "Website", value: c.website ?? "—" },
      { label: "Location", value: c.location ?? "—" },
      ...(c.parent ? [{ label: "Part of", value: c.parent.name }] : []),
    ],
    counts: [
      { label: ["task", "tasks"], value: c._count.tasks },
      { label: ["deal", "deals"], value: c._count.deals },
      { label: ["meeting", "meetings"], value: c._count.meetings },
      { label: ["thread", "threads"], value: c._count.threads },
      { label: ["person", "people"], value: c._count.people },
      { label: ["document", "documents"], value: c._count.documents },
    ],
  }));
}

export async function getReviewQueue(viewer: ProvenanceViewer, opts: { tab: ReviewTab; kind?: ReviewKind | null; minImpact?: number | null }) {
  const ceo = await getCeoContext();
  const scope = await getAccessScope(viewer);
  const visible = reviewItemWhere(scope);
  const statusWhere: Prisma.ReviewQueueItemWhereInput = opts.tab === "pending" ? { status: "PENDING" } : { status: { not: "PENDING" } };
  const filters: Prisma.ReviewQueueItemWhereInput[] = [statusWhere, visible];
  if (opts.kind) filters.push({ kind: opts.kind });
  if (opts.minImpact) filters.push({ impact: { gte: opts.minImpact } });

  const [rows, kindCounts, statusCounts] = await Promise.all([
    db.reviewQueueItem.findMany({
      where: { AND: filters },
      orderBy: opts.tab === "pending" ? [{ impact: "desc" }, { createdAt: "asc" }] : [{ resolvedAt: "desc" }, { updatedAt: "desc" }],
      take: opts.tab === "pending" ? 150 : 200,
      include: itemInclude,
    }),
    db.reviewQueueItem.groupBy({ by: ["kind"], where: { AND: [{ status: "PENDING" }, visible] }, _count: { _all: true } }),
    db.reviewQueueItem.groupBy({ by: ["status"], where: visible, _count: { _all: true } }),
  ]);

  // Source lines only for sources this viewer may read.
  const sourceIds = rows.map((r) => r.sourceItemId).filter((x): x is string => Boolean(x));
  const readable = new Set(
    sourceIds.length ? (await db.sourceItem.findMany({ where: { AND: [{ id: { in: sourceIds } }, sourceItemWhere(scope)] }, select: { id: true } })).map((s) => s.id) : [],
  );

  // Dedicated renderers' data.
  const merges = rows.filter((r) => r.kind === "ENTITY_MERGE");
  const mergeIds = (type: string) => merges.filter((m) => (getIn(m.proposal, ["entityType"]) ?? m.targetType) === type).flatMap((m) => [getIn(m.proposal, ["keepId"]), getIn(m.proposal, ["mergeId"])].filter((x): x is string => typeof x === "string"));
  const docIds = rows.filter((r) => r.kind === "DOCUMENT_CHANGE").map((r) => getIn(r.proposal, ["documentId"])).filter((x): x is string => typeof x === "string");
  const targets: { type: EntityType; id: string }[] = [];
  for (const r of rows) {
    const t = (getIn(r.proposal, ["targetType"]) ?? r.targetType) as EntityType | null;
    const id = (getIn(r.proposal, ["targetId"]) ?? r.targetId) as string | null;
    if (r.kind !== "ENTITY_MERGE" && t && id) targets.push({ type: t, id });
    if (r.status !== "PENDING" && r.resultType && r.resultId) targets.push({ type: r.resultType, id: r.resultId });
  }
  const [companySides, personSides, docs, resolved] = await Promise.all([
    mergeSides("COMPANY", mergeIds("COMPANY")),
    mergeSides("PERSON", mergeIds("PERSON")),
    docIds.length ? db.document.findMany({ where: { AND: [{ id: { in: docIds } }, documentWhere(scope)] }, select: { id: true, title: true, currentVersion: true } }) : Promise.resolve([]),
    resolveRecords(viewer, targets),
  ]);
  const sides = new Map([...companySides, ...personSides].map((s) => [s.id, s]));
  const docMap = new Map(docs.map((d) => [d.id, d]));
  const recordMap = new Map(resolved.records.map((r) => [r.key, r]));
  const personNames = await namesForPeople(rows.map((r) => r.proposal));

  const items = rows.map((r) => {
    const p = isPlainObject(r.proposal) ? r.proposal : {};
    const src = r.sourceItem && readable.has(r.sourceItem.id) ? r.sourceItem : null;
    const targetType = (p.targetType ?? r.targetType) as EntityType | null;
    const targetId = (p.targetId ?? r.targetId) as string | null;
    const docId = typeof p.documentId === "string" ? p.documentId : null;
    const changes: ChangeRow[] = readChanges(p.changes);
    return {
      id: r.id,
      kind: r.kind,
      status: r.status,
      title: r.title,
      reason: r.reason,
      impact: r.impact,
      confidence: r.confidence,
      confidenceScore: r.confidenceScore,
      proposal: p,
      edited: isPlainObject(r.edited) ? r.edited : null,
      excerpt: r.excerpt ?? (typeof p.evidence === "string" ? p.evidence : null),
      sensitivity: r.sensitivity,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt,
      resolvedBy: r.resolvedBy ? (r.resolvedBy.name || r.resolvedBy.email) : null,
      resolutionNote: r.resolutionNote,
      result: r.resultType && r.resultId ? (recordMap.get(`${r.resultType}:${r.resultId}`) ?? null) : null,
      source: src
        ? {
            id: src.id,
            kind: src.kind,
            provider: src.connection.provider,
            title: src.title,
            occurredAt: src.occurredAt,
            author: src.emailMessage?.fromName ?? src.emailMessage?.fromEmail ?? src.calendarEvent?.organizerName ?? src.document?.author ?? null,
          }
        : null,
      sourceHidden: Boolean(r.sourceItemId && !src),
      candidates: readCandidates(r.candidates) as Candidate[],
      merge:
        r.kind === "ENTITY_MERGE"
          ? {
              entityType: (p.entityType ?? r.targetType ?? "COMPANY") as string,
              keep: typeof p.keepId === "string" ? (sides.get(p.keepId) ?? null) : null,
              other: typeof p.mergeId === "string" ? (sides.get(p.mergeId) ?? null) : null,
              score: typeof p.score === "number" ? p.score : null,
              reason: typeof p.reason === "string" ? p.reason : null,
            }
          : null,
      target: r.kind !== "ENTITY_MERGE" && targetType && targetId ? ((recordMap.get(`${targetType}:${targetId}`) as DerivedRecord | undefined) ?? null) : null,
      document: docId ? (docMap.get(docId) ?? null) : null,
      documentHidden: Boolean(docId && !docMap.has(docId)),
      changes,
    };
  });

  const counts = Object.fromEntries(statusCounts.map((c) => [c.status, c._count._all])) as Partial<Record<ReviewStatus, number>>;
  return {
    items,
    kindCounts: Object.fromEntries(kindCounts.map((k) => [k.kind, k._count._all])) as Partial<Record<ReviewKind, number>>,
    pendingCount: counts.PENDING ?? 0,
    resolvedCount: Object.entries(counts).reduce((n, [s, c]) => (s === "PENDING" ? n : n + (c ?? 0)), 0),
    personNames,
    timezone: ceo.timezone,
  };
}

/** Names for person ids referenced by proposals (so read views show people, not ids). */
async function namesForPeople(proposals: unknown[]): Promise<Record<string, string>> {
  const ids = new Set<string>();
  for (const p of proposals) {
    if (!isPlainObject(p)) continue;
    for (const k of ["ownerPersonId", "counterpartyPersonId", "personId"]) if (typeof p[k] === "string") ids.add(p[k] as string);
    if (p.field === "ownerId") for (const k of ["from", "to"]) if (typeof p[k] === "string") ids.add(p[k] as string);
  }
  if (!ids.size) return {};
  const people = await db.person.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, isCeo: true } });
  return Object.fromEntries(people.map((p) => [p.id, p.isCeo ? "You (CEO)" : p.name]));
}

export type ReviewQueueData = Awaited<ReturnType<typeof getReviewQueue>>;
export type ReviewEntry = ReviewQueueData["items"][number];
