/** Documents (and their version history) the viewer may read. */
import type { Prisma } from "@/generated/prisma/client";
import type { DocumentType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { getCeoContext } from "@/server/context";
import { documentWhere, getAccessScope } from "@/server/security/access";
import { getDerivedIntelligence, resolveRecords, type ProvenanceViewer } from "./provenance";

export async function getDocuments(viewer: ProvenanceViewer, f: { type?: DocumentType | null; companyId?: string | null; q?: string | null; significant?: boolean }) {
  const ceo = await getCeoContext();
  const scope = await getAccessScope(viewer);
  const and: Prisma.DocumentWhereInput[] = [documentWhere(scope)];
  if (f.type) and.push({ docType: f.type });
  if (f.companyId) and.push({ companyId: f.companyId });
  if (f.significant) and.push({ versions: { some: { isSignificant: true } } });
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { summary: { contains: q, mode: "insensitive" } },
        { author: { contains: q, mode: "insensitive" } },
        { company: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  const [docs, companies, types] = await Promise.all([
    db.document.findMany({
      where: { AND: and },
      orderBy: [{ modifiedAtSource: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 300,
      select: {
        id: true,
        title: true,
        docType: true,
        format: true,
        currentVersion: true,
        modifiedAtSource: true,
        updatedAt: true,
        author: true,
        sensitivity: true,
        sizeBytes: true,
        summary: true,
        company: { select: { id: true, name: true } },
        sourceItem: { select: { connection: { select: { provider: true } } } },
        versions: { orderBy: { version: "desc" }, take: 1, select: { isSignificant: true, changeSummary: true, version: true } },
      },
    }),
    db.company.findMany({ where: { documents: { some: documentWhere(scope) } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.document.groupBy({ by: ["docType"], where: documentWhere(scope), _count: { _all: true } }),
  ]);
  return { docs, companies, types: types.map((t) => t.docType), timezone: ceo.timezone };
}

export type DocumentRow = Awaited<ReturnType<typeof getDocuments>>["docs"][number];

export async function getDocumentDetail(viewer: ProvenanceViewer, id: string) {
  const ceo = await getCeoContext();
  const scope = await getAccessScope(viewer);
  const doc = await db.document.findFirst({
    where: { AND: [{ id }, documentWhere(scope)] },
    include: {
      company: { select: { id: true, name: true } },
      project: { select: { id: true, name: true } },
      resource: { select: { id: true, title: true } },
      sourceItem: { select: { id: true, externalUrl: true, contentPurgedAt: true, relevance: true, category: true, text: true, connection: { select: { provider: true, label: true } } } },
      versions: {
        orderBy: { version: "desc" },
        select: { id: true, version: true, modifiedAt: true, changeSummary: true, significantChanges: true, isSignificant: true, keyFacts: true, pageCount: true, parser: true, textLength: true, createdAt: true },
      },
      insights: { select: { id: true } },
    },
  });
  if (!doc) return null;
  // Everything derived from the document's source item, plus insights pinned to the document.
  const [fromSource, pinned] = await Promise.all([
    getDerivedIntelligence(viewer, [doc.sourceItemId]),
    resolveRecords(
      viewer,
      doc.insights.map((i) => ({ type: "INSIGHT" as const, id: i.id })),
    ),
  ]);
  const seen = new Set(fromSource.records.map((r) => r.key));
  const derived = {
    records: [...fromSource.records, ...pinned.records.filter((r) => !seen.has(r.key))].filter((r) => !(r.type === "DOCUMENT" && r.id === doc.id)),
    hidden: fromSource.hidden + pinned.hidden,
  };
  return { doc, derived, timezone: ceo.timezone };
}

export type DocumentDetail = NonNullable<Awaited<ReturnType<typeof getDocumentDetail>>>;
