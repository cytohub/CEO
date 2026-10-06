/**
 * Provenance: which sources produced an intelligence record, and which records
 * a source produced. Every read is filtered by the viewer's access scope;
 * filtered-out references are counted (never described) so the UI can say
 * "N sources hidden by your access level".
 */
import type { Prisma } from "@/generated/prisma/client";
import type { EntityType, ReferenceRole, SourceItemKind, SourceProvider } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import type { Tone } from "@/lib/domain";
import { DECISION_STATUS, INSIGHT_TYPES, TASK_STATUS } from "@/lib/domain";
import { COMMITMENT_STATUS, OPPORTUNITY_STATUS, RISK_STATUS } from "@/lib/intelligence";
import { safeHttpUrl } from "@/components/intelligence/model";
import { documentWhere, emailThreadWhere, getAccessScope, sourceItemWhere, sourceReferenceWhere, type AccessScope } from "@/server/security/access";
import { can, type Viewer } from "@/server/security/session";

export type ProvenanceViewer = Pick<Viewer, "userId" | "role" | "capabilities">;

export interface ProvenanceRef {
  id: string;
  role: ReferenceRole;
  sourceItemId: string | null;
  kind: SourceItemKind;
  provider: SourceProvider;
  connectionLabel: string | null;
  title: string;
  /** Sender, organizer or author when known. */
  author: string | null;
  occurredAt: Date;
  ingestedAt: Date;
  excerpt: string | null;
  confidence: number | null;
  /** Link to the original — http(s) only. */
  url: string | null;
  purged: boolean;
  /** The source item is gone; only the snapshot remains. */
  deleted: boolean;
}

export interface Provenance {
  refs: ProvenanceRef[];
  hidden: number;
}

const sourceSelect = {
  id: true,
  kind: true,
  title: true,
  snippet: true,
  occurredAt: true,
  ingestedAt: true,
  externalUrl: true,
  contentPurgedAt: true,
  deletedAtSource: true,
  connection: { select: { label: true, provider: true } },
  emailMessage: { select: { fromName: true, fromEmail: true } },
  calendarEvent: { select: { organizerName: true, organizerEmail: true } },
  document: { select: { author: true, url: true } },
} satisfies Prisma.SourceItemSelect;

type SourceRow = Prisma.SourceItemGetPayload<{ select: typeof sourceSelect }>;

function authorOf(s: SourceRow | null): string | null {
  if (!s) return null;
  return s.emailMessage?.fromName ?? s.emailMessage?.fromEmail ?? s.calendarEvent?.organizerName ?? s.calendarEvent?.organizerEmail ?? s.document?.author ?? null;
}

function fromSourceItem(s: SourceRow): ProvenanceRef {
  return {
    id: `direct:${s.id}`,
    role: "CREATED_FROM",
    sourceItemId: s.id,
    kind: s.kind,
    provider: s.connection.provider,
    connectionLabel: s.connection.label,
    title: s.title,
    author: authorOf(s),
    occurredAt: s.occurredAt,
    ingestedAt: s.ingestedAt,
    excerpt: s.contentPurgedAt ? null : (s.snippet?.slice(0, 320) ?? null),
    confidence: null,
    url: safeHttpUrl(s.externalUrl ?? s.document?.url),
    purged: Boolean(s.contentPurgedAt),
    deleted: false,
  };
}

/** Records that point at their source directly (and may carry no reference rows). */
async function directSourceItemId(targetType: EntityType, targetId: string): Promise<string | null> {
  switch (targetType) {
    case "SOURCE_ITEM":
      return targetId;
    case "INBOX_ITEM":
      return (await db.inboxItem.findUnique({ where: { id: targetId }, select: { sourceItemId: true } }))?.sourceItemId ?? null;
    case "INSIGHT":
      return (await db.brainInsight.findUnique({ where: { id: targetId }, select: { sourceItemId: true } }))?.sourceItemId ?? null;
    case "DOCUMENT":
      return (await db.document.findUnique({ where: { id: targetId }, select: { sourceItemId: true } }))?.sourceItemId ?? null;
    case "MEETING":
      return (await db.calendarEvent.findFirst({ where: { meetingId: targetId }, select: { sourceItemId: true } }))?.sourceItemId ?? null;
    default:
      return null;
  }
}

async function readableSourceItem(scope: AccessScope, id: string) {
  return db.sourceItem.findFirst({ where: { AND: [{ id }, sourceItemWhere(scope)] }, select: sourceSelect });
}

export async function getProvenance(viewer: ProvenanceViewer, targetType: EntityType, targetId: string): Promise<Provenance> {
  const scope = await getAccessScope(viewer);
  if (targetType === "SOURCE_ITEM") {
    const s = await readableSourceItem(scope, targetId);
    return s ? { refs: [fromSourceItem(s)], hidden: 0 } : { refs: [], hidden: (await db.sourceItem.count({ where: { id: targetId } })) > 0 ? 1 : 0 };
  }
  const where: Prisma.SourceReferenceWhereInput = { targetType, targetId };
  const [rows, total] = await Promise.all([
    db.sourceReference.findMany({
      where: { AND: [where, sourceReferenceWhere(scope)] },
      orderBy: [{ role: "asc" }, { sourceOccurredAt: "desc" }],
      take: 50,
      include: { sourceItem: { select: sourceSelect } },
    }),
    db.sourceReference.count({ where }),
  ]);
  const refs: ProvenanceRef[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    sourceItemId: r.sourceItemId,
    kind: r.sourceKind,
    provider: r.provider,
    connectionLabel: r.sourceItem?.connection.label ?? null,
    title: r.sourceTitle,
    author: authorOf(r.sourceItem),
    occurredAt: r.sourceOccurredAt,
    ingestedAt: r.ingestedAt,
    excerpt: r.excerpt,
    confidence: r.confidence,
    url: safeHttpUrl(r.sourceUrl ?? r.sourceItem?.externalUrl ?? r.sourceItem?.document?.url),
    purged: Boolean(r.sourceItem?.contentPurgedAt),
    deleted: !r.sourceItem,
  }));
  let hidden = Math.max(0, total - rows.length);

  if (total === 0) {
    const direct = await directSourceItemId(targetType, targetId);
    if (direct) {
      const s = await readableSourceItem(scope, direct);
      if (s) refs.push(fromSourceItem(s));
      else hidden += 1;
    }
  }
  return { refs, hidden };
}

/** Visible / hidden reference counts for many records of one type (list pages). */
export async function getProvenanceCounts(viewer: ProvenanceViewer, targetType: EntityType, ids: string[]): Promise<Record<string, { count: number; hidden: number }>> {
  if (!ids.length) return {};
  const scope = await getAccessScope(viewer);
  const where: Prisma.SourceReferenceWhereInput = { targetType, targetId: { in: ids } };
  const [visible, total] = await Promise.all([
    db.sourceReference.groupBy({ by: ["targetId"], where: { AND: [where, sourceReferenceWhere(scope)] }, _count: { _all: true } }),
    scope.all ? Promise.resolve(null) : db.sourceReference.groupBy({ by: ["targetId"], where, _count: { _all: true } }),
  ]);
  const out: Record<string, { count: number; hidden: number }> = {};
  for (const v of visible) out[v.targetId] = { count: v._count._all, hidden: 0 };
  for (const t of total ?? []) {
    const cur = out[t.targetId] ?? { count: 0, hidden: 0 };
    cur.hidden = Math.max(0, t._count._all - cur.count);
    out[t.targetId] = cur;
  }
  return out;
}

/** First readable excerpt per record (tables show it on hover/expand). */
export async function getFirstExcerpts(viewer: ProvenanceViewer, targetType: EntityType, ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const scope = await getAccessScope(viewer);
  const rows = await db.sourceReference.findMany({
    where: { AND: [{ targetType, targetId: { in: ids }, excerpt: { not: null } }, sourceReferenceWhere(scope)] },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { targetId: true, excerpt: true },
  });
  const out: Record<string, string> = {};
  for (const r of rows) if (!out[r.targetId] && r.excerpt) out[r.targetId] = r.excerpt;
  return out;
}

// ─── Derived intelligence (source → records) ─────────────────────────────────

export interface DerivedRecord {
  key: string;
  type: EntityType;
  id: string;
  kindLabel: string;
  title: string;
  href: string | null;
  /** Opens a global sheet instead of navigating. */
  sheet?: "task" | "milestone" | "meeting";
  status?: { label: string; tone: Tone };
  role?: ReferenceRole;
  confidence?: number | null;
}

const TYPE_ORDER: EntityType[] = ["TASK", "COMMITMENT", "DECISION", "RISK", "OPPORTUNITY", "MEETING", "INSIGHT", "INBOX_ITEM", "MILESTONE", "GOAL", "DOCUMENT", "EMAIL_THREAD", "COMPANY", "PERSON", "DEAL"];

/**
 * Resolve (type, id) pairs into linkable records. Records the viewer cannot
 * open (restricted documents/threads, CEO-only inbox items) are dropped and
 * counted in `hidden`.
 */
export async function resolveRecords(viewer: ProvenanceViewer, targets: { type: EntityType; id: string; role?: ReferenceRole; confidence?: number | null }[]) {
  const scope = await getAccessScope(viewer);
  const ids = (t: EntityType) => [...new Set(targets.filter((x) => x.type === t).map((x) => x.id))];
  const sel = { id: true, title: true } as const;
  const none = Promise.resolve([] as never[]);
  const q = <T,>(t: EntityType, fn: (ids: string[]) => Promise<T[]>) => (ids(t).length ? fn(ids(t)) : (none as Promise<T[]>));
  const [tasks, commitments, decisions, risks, opps, meetings, insights, inbox, milestones, goals, docs, threads, companies, people, deals] = await Promise.all([
    q("TASK", (i) => db.task.findMany({ where: { id: { in: i } }, select: { ...sel, status: true } })),
    q("COMMITMENT", (i) => db.commitment.findMany({ where: { id: { in: i } }, select: { ...sel, status: true, direction: true } })),
    q("DECISION", (i) => db.decision.findMany({ where: { id: { in: i } }, select: { ...sel, status: true } })),
    q("RISK", (i) => db.risk.findMany({ where: { id: { in: i } }, select: { ...sel, status: true } })),
    q("OPPORTUNITY", (i) => db.opportunity.findMany({ where: { id: { in: i } }, select: { ...sel, status: true } })),
    q("MEETING", (i) => db.meeting.findMany({ where: { id: { in: i } }, select: sel })),
    can(viewer, "brain.view") ? q("INSIGHT", (i) => db.brainInsight.findMany({ where: { id: { in: i } }, select: { ...sel, type: true } })) : none,
    can(viewer, "cockpit.view") ? q("INBOX_ITEM", (i) => db.inboxItem.findMany({ where: { id: { in: i } }, select: { ...sel, status: true } })) : none,
    q("MILESTONE", (i) => db.milestone.findMany({ where: { id: { in: i } }, select: sel })),
    q("GOAL", (i) => db.goal.findMany({ where: { id: { in: i } }, select: sel })),
    q("DOCUMENT", (i) => db.document.findMany({ where: { AND: [{ id: { in: i } }, documentWhere(scope)] }, select: sel })),
    q("EMAIL_THREAD", (i) => db.emailThread.findMany({ where: { AND: [{ id: { in: i } }, emailThreadWhere(scope)] }, select: { id: true, subject: true } })),
    q("COMPANY", (i) => db.company.findMany({ where: { id: { in: i } }, select: { id: true, name: true } })),
    q("PERSON", (i) => db.person.findMany({ where: { id: { in: i } }, select: { id: true, name: true } })),
    q("DEAL", (i) => db.deal.findMany({ where: { id: { in: i } }, select: { id: true, name: true, companyId: true } })),
  ]);

  const map = new Map<string, Omit<DerivedRecord, "key" | "role" | "confidence">>();
  const put = (r: Omit<DerivedRecord, "key" | "role" | "confidence">) => map.set(`${r.type}:${r.id}`, r);
  for (const t of tasks) put({ type: "TASK", id: t.id, kindLabel: "Task", title: t.title, href: `?task=${t.id}`, sheet: "task", status: TASK_STATUS[t.status] });
  for (const c of commitments) put({ type: "COMMITMENT", id: c.id, kindLabel: "Commitment", title: c.title, href: `/commitments?highlight=${c.id}`, status: COMMITMENT_STATUS[c.status] });
  for (const d of decisions) put({ type: "DECISION", id: d.id, kindLabel: "Decision", title: d.title, href: `/decisions/${d.id}`, status: DECISION_STATUS[d.status] });
  for (const r of risks) put({ type: "RISK", id: r.id, kindLabel: "Risk", title: r.title, href: `/risks?highlight=${r.id}`, status: RISK_STATUS[r.status] });
  for (const o of opps) put({ type: "OPPORTUNITY", id: o.id, kindLabel: "Opportunity", title: o.title, href: `/risks?tab=opportunities&highlight=${o.id}`, status: OPPORTUNITY_STATUS[o.status] });
  for (const m of meetings) put({ type: "MEETING", id: m.id, kindLabel: "Meeting", title: m.title, href: `?meeting=${m.id}`, sheet: "meeting" });
  for (const i of insights) put({ type: "INSIGHT", id: i.id, kindLabel: INSIGHT_TYPES[i.type].label, title: i.title, href: `/brain?insight=${i.id}` });
  for (const i of inbox) put({ type: "INBOX_ITEM", id: i.id, kindLabel: "Inbox item", title: i.title, href: i.status === "OPEN" ? `/inbox?item=${i.id}` : `/inbox?status=${i.status}&item=${i.id}` });
  for (const m of milestones) put({ type: "MILESTONE", id: m.id, kindLabel: "Milestone", title: m.title, href: `?milestone=${m.id}`, sheet: "milestone" });
  for (const g of goals) put({ type: "GOAL", id: g.id, kindLabel: "Goal", title: g.title, href: `/goals/${g.id}` });
  for (const d of docs) put({ type: "DOCUMENT", id: d.id, kindLabel: "Document", title: d.title, href: `/documents/${d.id}` });
  for (const t of threads) put({ type: "EMAIL_THREAD", id: t.id, kindLabel: "Email thread", title: t.subject, href: `/brain/threads/${t.id}` });
  for (const c of companies) put({ type: "COMPANY", id: c.id, kindLabel: "Company", title: c.name, href: `/resources/companies/${c.id}` });
  for (const p of people) put({ type: "PERSON", id: p.id, kindLabel: "Person", title: p.name, href: `/resources/people/${p.id}` });
  for (const d of deals) put({ type: "DEAL", id: d.id, kindLabel: "Deal", title: d.name, href: d.companyId ? `/resources/companies/${d.companyId}` : null });

  const seen = new Set<string>();
  const records: DerivedRecord[] = [];
  let hidden = 0;
  for (const t of targets) {
    const key = `${t.type}:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = map.get(key);
    if (!r) {
      // Deleted records are simply gone; unreadable ones are counted.
      if (t.type === "DOCUMENT" || t.type === "EMAIL_THREAD" || (t.type === "INBOX_ITEM" && !can(viewer, "cockpit.view"))) hidden += 1;
      continue;
    }
    records.push({ ...r, key, role: t.role, confidence: t.confidence });
  }
  records.sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  return { records, hidden };
}

/** Every record derived from the given (already readable) source items. */
export async function getDerivedIntelligence(viewer: ProvenanceViewer, sourceItemIds: string[]) {
  if (!sourceItemIds.length) return { records: [] as DerivedRecord[], hidden: 0 };
  const [refs, inbox, insights] = await Promise.all([
    db.sourceReference.findMany({ where: { sourceItemId: { in: sourceItemIds } }, select: { targetType: true, targetId: true, role: true, confidence: true }, orderBy: { createdAt: "asc" } }),
    db.inboxItem.findMany({ where: { sourceItemId: { in: sourceItemIds } }, select: { id: true } }),
    db.brainInsight.findMany({ where: { sourceItemId: { in: sourceItemIds } }, select: { id: true } }),
  ]);
  return resolveRecords(viewer, [
    ...refs.map((r) => ({ type: r.targetType, id: r.targetId, role: r.role, confidence: r.confidence })),
    ...inbox.map((i) => ({ type: "INBOX_ITEM" as const, id: i.id })),
    ...insights.map((i) => ({ type: "INSIGHT" as const, id: i.id })),
  ]);
}

// ─── Source detail (/sources/[id]) ───────────────────────────────────────────

/**
 * Full source item for the viewer, or null when it does not exist or the
 * viewer may not read it (the page 404s either way — existence is not leaked).
 * Encrypted payloads and stage data never leave the server.
 */
export async function getSourceDetail(viewer: ProvenanceViewer, id: string) {
  const scope = await getAccessScope(viewer);
  const item = await db.sourceItem.findFirst({
    where: { AND: [{ id }, sourceItemWhere(scope)] },
    omit: { rawPayload: true, stageData: true, extraction: true },
    include: {
      connection: { select: { id: true, label: true, provider: true, kind: true, accountEmail: true, mode: true } },
      emailMessage: {
        include: {
          thread: { select: { id: true, subject: true } },
          attachments: { select: { id: true, filename: true, mimeType: true, sizeBytes: true, documentId: true } },
        },
      },
      calendarEvent: { include: { meeting: { select: { id: true, title: true } } } },
      document: {
        select: {
          id: true,
          title: true,
          docType: true,
          format: true,
          currentVersion: true,
          modifiedAtSource: true,
          author: true,
          url: true,
          sizeBytes: true,
          versions: { orderBy: { version: "desc" }, take: 1, select: { version: true, modifiedAt: true, changeSummary: true, isSignificant: true, pageCount: true, parser: true } },
        },
      },
      meeting: { select: { id: true, title: true } },
      mentions: { orderBy: [{ resolution: "asc" }, { confidence: "desc" }], select: { id: true, entityType: true, entityId: true, text: true, email: true, role: true, confidence: true, resolution: true } },
    },
  });
  if (!item) return null;

  const threadId = item.emailMessage?.thread.id;
  const attachmentDocIds = (item.emailMessage?.attachments ?? []).map((a) => a.documentId).filter((x): x is string => Boolean(x));
  const personIds = item.mentions.filter((m) => m.entityType === "PERSON" && m.entityId).map((m) => m.entityId!);
  const companyIds = item.mentions.filter((m) => m.entityType === "COMPANY" && m.entityId).map((m) => m.entityId!);
  const projectIds = item.mentions.filter((m) => m.entityType === "PROJECT" && m.entityId).map((m) => m.entityId!);
  const [threadReadable, readableDocs, people, companies, projects, derived] = await Promise.all([
    threadId ? db.emailThread.count({ where: { AND: [{ id: threadId }, emailThreadWhere(scope)] } }).then((n) => n > 0) : Promise.resolve(false),
    attachmentDocIds.length ? db.document.findMany({ where: { AND: [{ id: { in: attachmentDocIds } }, documentWhere(scope)] }, select: { id: true } }) : Promise.resolve([]),
    personIds.length ? db.person.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true, isCeo: true } }) : Promise.resolve([]),
    companyIds.length ? db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    projectIds.length ? db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }) : Promise.resolve([]),
    getDerivedIntelligence(viewer, [item.id]),
  ]);
  const names = new Map<string, { name: string; href: string | null }>([
    ...people.map((p) => [p.id, { name: p.isCeo ? "You" : p.name, href: p.isCeo ? null : `/resources/people/${p.id}` }] as const),
    ...companies.map((c) => [c.id, { name: c.name, href: `/resources/companies/${c.id}` }] as const),
    ...projects.map((p) => [p.id, { name: p.name, href: null }] as const),
  ]);
  const readableDocIds = new Set(readableDocs.map((d) => d.id));
  return {
    item,
    threadReadable,
    attachments: (item.emailMessage?.attachments ?? []).map((a) => ({ ...a, documentId: a.documentId && readableDocIds.has(a.documentId) ? a.documentId : null })),
    mentions: item.mentions.map((m) => ({ ...m, resolved: m.entityId ? (names.get(m.entityId) ?? null) : null })),
    derived,
  };
}

export type SourceDetail = NonNullable<Awaited<ReturnType<typeof getSourceDetail>>>;
