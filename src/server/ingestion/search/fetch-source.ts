/**
 * Source-content fetchers: email threads, documents, calendar events and
 * meeting notes. Every query is built on the access filters from
 * src/server/security/access.ts, so a viewer only ever gets rows (and
 * summaries / snippets) they are allowed to read.
 */
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { CEO_CATEGORIES, DOCUMENT_TYPES, MEETING_CATEGORIES, THREAD_STATUS } from "@/lib/intelligence";
import { documentWhere, emailThreadWhere, sourceItemWhere } from "@/server/security/access";
import { type Exec, meetingCategoriesFor } from "./exec";
import { links } from "./links";
import { excerpt } from "./snippets";
import type { SearchResult } from "./types";


export type StrFilter = { contains?: string; startsWith?: string; mode: "insensitive" };

/** Short terms match at a word start ("api" must not match "capital"); longer ones anywhere. */
function variants(t: string): StrFilter[] {
  const mode = "insensitive" as const;
  if (t.length > 4) return [{ contains: t, mode }];
  return [{ startsWith: t, mode }, ...[" ", "-", "(", "/", "“", "\""].map((p) => ({ contains: `${p}${t}`, mode }))];
}

/** Every term must appear in at least one of the fields (≤3 terms), or any term (longer queries). */
export function termsWhere<W>(terms: string[], fields: ((f: StrFilter, term: string) => W)[]): W[] {
  if (!terms.length) return [];
  const per = terms.map((t) => ({ OR: fields.flatMap((field) => variants(t).map((v) => field(v, t))) }) as W);
  return terms.length <= 3 ? per : [{ OR: per } as W];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function hasTerm(text: string, term: string): boolean {
  if (term.length > 4) return text.includes(term);
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(term)}`, "u").test(text);
}

/** How strongly a result matches the terms (0–1): title hits count double. */
export function termScore(terms: string[], title: string, other = ""): number {
  if (!terms.length) return 0;
  const t = title.toLowerCase();
  const o = other.toLowerCase();
  let s = 0;
  for (const term of terms) {
    const x = term.toLowerCase();
    if (hasTerm(t, x)) s += 1;
    else if (hasTerm(o, x)) s += 0.5;
  }
  return s / terms.length;
}

/** Whether text constrains this fetch ("and"), widens it ("or", topic search) or is ignored. */
function textMode(x: Exec): "and" | "or" | "none" {
  if (!x.plan.text) return "none";
  if (x.plan.intent === "status" || x.plan.intent === "related") return "or";
  if (x.plan.intent === "keyword" || x.plan.intent === "list" || x.plan.intent === "discussed") return "and";
  return "none";
}

function ftsIds(x: Exec, pick: (h: { threadId: string | null; documentId: string | null; eventId: string | null; id: string; kind: string }) => string | null): string[] {
  const out = new Set<string>();
  for (const h of x.fts.values()) {
    const v = pick(h);
    if (v) out.add(v);
  }
  return [...out];
}

const notNoise: Prisma.EmailThreadWhereInput = { OR: [{ relevance: null }, { relevance: { not: "NOISE" } }] };

// ─── Threads ─────────────────────────────────────────────────────────────────

export async function fetchThreads(x: Exec): Promise<SearchResult[]> {
  const { plan } = x;
  const mode = textMode(x);
  const ftsThreadIds = ftsIds(x, (h) => h.threadId);
  const graphThreadIds = x.graphItemIds.length
    ? (await db.emailMessage.findMany({ where: { sourceItemId: { in: x.graphItemIds } }, select: { threadId: true } })).map((m) => m.threadId)
    : [];

  const entity: Prisma.EmailThreadWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } });
  if (x.dealIds.length) entity.push({ dealId: { in: x.dealIds } });
  for (const email of x.emails.slice(0, 40)) entity.push({ participants: { array_contains: [{ email }] } });
  if (graphThreadIds.length) entity.push({ id: { in: graphThreadIds } });
  const text: Prisma.EmailThreadWhereInput[] = [
    ...(ftsThreadIds.length ? [{ id: { in: ftsThreadIds } }] : []),
    ...termsWhere<Prisma.EmailThreadWhereInput>(x.terms, [(f) => ({ subject: f }), (f) => ({ summary: f })]),
  ];

  const and: Prisma.EmailThreadWhereInput[] = [emailThreadWhere(x.scope)];
  if (plan.intent !== "keyword") and.push(notNoise);
  if (x.hasEntities && mode === "or") and.push({ OR: [...entity, ...(text.length ? [{ OR: text }] : [])] });
  else {
    if (x.hasEntities) and.push(entity.length ? { OR: entity } : { id: "__none__" });
    if (mode === "and") and.push(text.length ? { OR: text } : { id: "__none__" });
  }
  if (plan.companyTypes.length || plan.categories.length) {
    and.push({ OR: [...(plan.companyTypes.length ? [{ company: { type: { in: plan.companyTypes } } }] : []), ...(plan.categories.length ? [{ category: { in: plan.categories } }] : [])] });
  }
  if (plan.intent === "waiting") and.push({ status: plan.direction === "INBOUND" ? "AWAITING_THEM" : "AWAITING_CEO" });
  if (x.range && plan.timeField === "occurred") {
    if (x.range.from) and.push({ lastMessageAt: { gte: x.range.from } });
    if (x.range.toExclusive) and.push({ lastMessageAt: { lt: x.range.toExclusive } });
  }

  const rows = await db.emailThread.findMany({
    where: { AND: and },
    orderBy: { lastMessageAt: "desc" },
    take: Math.max(x.limit * 3, 30),
    select: {
      id: true,
      subject: true,
      summary: true,
      status: true,
      category: true,
      messageCount: true,
      lastMessageAt: true,
      companyId: true,
      company: { select: { name: true } },
      messages: { orderBy: { sentAt: "desc" }, take: 1, select: { sourceItemId: true } },
    },
  });

  return rows.map((t) => {
    // Best FTS hit inside this thread supplies the snippet.
    let best: { rank: number; headline?: SearchResult["snippet"] } | null = null;
    for (const h of x.fts.values()) if (h.threadId === t.id && (!best || h.rank > best.rank)) best = { rank: h.rank, headline: h.headline };
    const status = THREAD_STATUS[t.status];
    const recency = Math.max(0, 1 - (x.now.getTime() - t.lastMessageAt.getTime()) / (90 * 86_400_000));
    return {
      type: "thread" as const,
      id: t.id,
      title: t.subject,
      subtitle: [status.label, t.company?.name ?? (t.category ? CEO_CATEGORIES[t.category].label : null), `${t.messageCount} message${t.messageCount === 1 ? "" : "s"}`, timeAgo(t.lastMessageAt, x.now)]
        .filter(Boolean)
        .join(" · "),
      snippet: best?.headline ?? excerpt(t.summary, x.plan.terms),
      href: links.thread(t.id),
      timestamp: t.lastMessageAt.toISOString(),
      rank: (best ? Math.min(1, best.rank * 6) : termScore(x.terms, t.subject, t.summary ?? "")) * 0.8 + recency * 0.2,
      badges: t.status === "AWAITING_CEO" ? ["Awaiting your reply"] : t.status === "AWAITING_THEM" ? ["Waiting on them"] : undefined,
      companyId: t.companyId,
      companyName: t.company?.name ?? null,
      meta: { status: t.status, summary: t.summary ?? null },
    };
  });
}

// ─── Documents ───────────────────────────────────────────────────────────────

export async function fetchDocuments(x: Exec): Promise<SearchResult[]> {
  const { plan } = x;
  const mode = textMode(x);
  const ftsDocIds = ftsIds(x, (h) => h.documentId);
  const entity: Prisma.DocumentWhereInput[] = [];
  if (x.companyIds.length) entity.push({ companyId: { in: x.companyIds } }, { resource: { is: { companies: { some: { id: { in: x.companyIds } } } } } });
  if (x.projectIds.length) entity.push({ projectId: { in: x.projectIds } });
  if (x.goalIds.length) entity.push({ resource: { is: { goals: { some: { id: { in: x.goalIds } } } } } });
  if (x.graphItemIds.length) entity.push({ sourceItemId: { in: x.graphItemIds } });
  if (x.personIds.length) entity.push({ resource: { is: { people: { some: { id: { in: x.personIds } } } } } });
  const text: Prisma.DocumentWhereInput[] = [
    ...(ftsDocIds.length ? [{ id: { in: ftsDocIds } }] : []),
    ...termsWhere<Prisma.DocumentWhereInput>(x.terms, [(f) => ({ title: f }), (f) => ({ summary: f })]),
  ];
  const and: Prisma.DocumentWhereInput[] = [documentWhere(x.scope)];
  if (x.hasEntities && mode === "or") and.push({ OR: [...entity, ...text] });
  else {
    if (x.hasEntities) and.push(entity.length ? { OR: entity } : { id: "__none__" });
    if (mode === "and") and.push(text.length ? { OR: text } : { id: "__none__" });
  }
  if (!x.hasEntities && mode === "none" && plan.intent !== "list") return [];
  if (x.range && plan.timeField === "occurred") {
    if (x.range.from) and.push({ sourceItem: { occurredAt: { gte: x.range.from } } });
    if (x.range.toExclusive) and.push({ sourceItem: { occurredAt: { lt: x.range.toExclusive } } });
  }
  const rows = await db.document.findMany({
    where: { AND: and },
    orderBy: [{ modifiedAtSource: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    take: Math.max(x.limit * 3, 30),
    select: {
      id: true,
      title: true,
      docType: true,
      currentVersion: true,
      summary: true,
      modifiedAtSource: true,
      updatedAt: true,
      sourceItemId: true,
      companyId: true,
      company: { select: { name: true } },
      versions: { orderBy: { version: "desc" }, take: 1, select: { isSignificant: true, changeSummary: true, version: true } },
    },
  });
  return rows.map((d) => {
    const hit = x.fts.get(d.sourceItemId);
    const latest = d.versions[0];
    const changed = Boolean(latest?.isSignificant && latest.version > 1);
    const at = d.modifiedAtSource ?? d.updatedAt;
    return {
      type: "document" as const,
      id: d.id,
      title: d.title,
      subtitle: [DOCUMENT_TYPES[d.docType].label, `v${d.currentVersion}`, d.company?.name, `updated ${timeAgo(at, x.now)}`].filter(Boolean).join(" · "),
      snippet: hit?.headline ?? excerpt(changed ? latest!.changeSummary : d.summary, x.plan.terms),
      href: links.document(d.id),
      timestamp: at.toISOString(),
      rank: hit ? Math.min(1, hit.rank * 6) : termScore(x.terms, d.title, d.summary ?? "") || 0.3,
      badges: changed ? ["Significant change"] : undefined,
      companyId: d.companyId,
      companyName: d.company?.name ?? null,
      meta: { summary: d.summary ?? null },
    };
  });
}

// ─── Calendar events ─────────────────────────────────────────────────────────

export async function fetchEvents(x: Exec): Promise<SearchResult[]> {
  const { plan } = x;
  const mode = textMode(x);
  const ftsEventItemIds = ftsIds(x, (h) => (h.eventId ? h.id : null));
  const entity: Prisma.CalendarEventWhereInput[] = [];
  if (x.companyIds.length) entity.push({ meeting: { is: { companyId: { in: x.companyIds } } } }, { relatedThread: { is: { companyId: { in: x.companyIds } } } });
  if (x.meetingIds.length) entity.push({ meetingId: { in: x.meetingIds } });
  if (x.graphItemIds.length) entity.push({ sourceItemId: { in: x.graphItemIds } });
  for (const email of x.emails.slice(0, 40)) entity.push({ attendees: { array_contains: [{ email }] } });
  const text: Prisma.CalendarEventWhereInput[] = [
    ...(ftsEventItemIds.length ? [{ sourceItemId: { in: ftsEventItemIds } }] : []),
    ...termsWhere<Prisma.CalendarEventWhereInput>(x.terms, [(f) => ({ title: f })]),
  ];
  const and: Prisma.CalendarEventWhereInput[] = [{ sourceItem: sourceItemWhere(x.scope) }];
  if (x.hasEntities && mode === "or") and.push({ OR: [...entity, ...text] });
  else {
    if (x.hasEntities) and.push(entity.length ? { OR: entity } : { id: "__none__" });
    if (mode === "and") and.push(text.length ? { OR: text } : { id: "__none__" });
  }
  const cats = meetingCategoriesFor(plan);
  if (cats.length) and.push({ category: { in: cats } });
  if (!x.hasEntities && mode === "none" && !cats.length && !x.range) return [];
  if (x.range) {
    if (x.range.from) and.push({ startsAt: { gte: x.range.from } });
    if (x.range.toExclusive) and.push({ startsAt: { lt: x.range.toExclusive } });
  }
  if ((plan.intent === "discussed" || plan.intent === "conversations") && !x.range) and.push({ startsAt: { lt: x.now } });
  const rows = await db.calendarEvent.findMany({
    where: { AND: and },
    orderBy: { startsAt: "desc" },
    take: Math.max(x.limit * 2, 20),
    select: { id: true, sourceItemId: true, title: true, startsAt: true, category: true, organizerName: true, meetingId: true, status: true, meeting: { select: { companyId: true, company: { select: { name: true } } } } },
  });
  return rows.map((e) => {
    const hit = x.fts.get(e.sourceItemId);
    return {
      type: "event" as const,
      id: e.sourceItemId,
      title: e.title,
      subtitle: [formatDateTime(e.startsAt, x.timezone), e.category ? MEETING_CATEGORIES[e.category].label : null, e.status === "CANCELLED" ? "Cancelled" : null, e.organizerName ? `organized by ${e.organizerName}` : null]
        .filter(Boolean)
        .join(" · "),
      snippet: hit?.headline,
      href: links.event(e.sourceItemId, e.meetingId),
      timestamp: e.startsAt.toISOString(),
      rank: hit ? Math.min(1, hit.rank * 6) : 0.3,
      companyId: e.meeting?.companyId ?? null,
      companyName: e.meeting?.company?.name ?? null,
      meta: { meetingId: e.meetingId },
    };
  });
}

// ─── Meeting notes (ingested) ────────────────────────────────────────────────

export async function fetchNotesSources(x: Exec): Promise<SearchResult[]> {
  const { plan } = x;
  const mode = textMode(x);
  const ftsNoteIds = ftsIds(x, (h) => (h.kind === "MEETING_NOTES" ? h.id : null));
  const entity: Prisma.SourceItemWhereInput[] = [];
  if (x.companyIds.length) entity.push({ meeting: { is: { companyId: { in: x.companyIds } } } });
  if (x.meetingIds.length) entity.push({ meetingId: { in: x.meetingIds } });
  if (x.graphItemIds.length) entity.push({ id: { in: x.graphItemIds } });
  const text: Prisma.SourceItemWhereInput[] = [...(ftsNoteIds.length ? [{ id: { in: ftsNoteIds } }] : []), ...termsWhere<Prisma.SourceItemWhereInput>(x.terms, [(f) => ({ title: f })])];
  const and: Prisma.SourceItemWhereInput[] = [{ kind: "MEETING_NOTES" }, sourceItemWhere(x.scope)];
  if (x.hasEntities && mode === "or") and.push({ OR: [...entity, ...text] });
  else {
    if (x.hasEntities) and.push(entity.length ? { OR: entity } : { id: "__none__" });
    if (mode === "and") and.push(text.length ? { OR: text } : { id: "__none__" });
  }
  const cats = meetingCategoriesFor(plan);
  if (cats.length || plan.companyTypes.length) {
    and.push({ meeting: { is: { OR: [...(cats.length ? [{ category: { in: cats } }] : []), ...(plan.companyTypes.length ? [{ company: { type: { in: plan.companyTypes } } }] : [])] } } });
  }
  if (!x.hasEntities && mode === "none" && !cats.length && !x.range) return [];
  if (x.range) {
    if (x.range.from) and.push({ occurredAt: { gte: x.range.from } });
    if (x.range.toExclusive) and.push({ occurredAt: { lt: x.range.toExclusive } });
  }
  const rows = await db.sourceItem.findMany({
    where: { AND: and },
    orderBy: { occurredAt: "desc" },
    take: Math.max(x.limit * 2, 20),
    select: { id: true, title: true, snippet: true, occurredAt: true, status: true, meetingId: true, meeting: { select: { title: true, companyId: true, company: { select: { name: true } } } } },
  });
  return rows.map((n) => {
    const hit = x.fts.get(n.id);
    return {
      type: "notes" as const,
      id: n.id,
      title: n.title,
      subtitle: [n.meeting?.title, formatDateTime(n.occurredAt, x.timezone), n.status === "PROCESSED" ? "Processed" : n.status === "FAILED" ? "Processing failed" : "Processing"].filter(Boolean).join(" · "),
      snippet: hit?.headline ?? excerpt(n.snippet, x.plan.terms),
      href: links.notes(n.id, n.meetingId),
      timestamp: n.occurredAt.toISOString(),
      rank: hit ? Math.min(1, hit.rank * 6) : 0.4,
      companyId: n.meeting?.companyId ?? null,
      companyName: n.meeting?.company?.name ?? null,
      meta: { meetingId: n.meetingId },
    };
  });
}

/** FTS hits that belong to no thread / document / event / notes item (rare). */
export function orphanSourceResults(x: Exec): SearchResult[] {
  const out: SearchResult[] = [];
  for (const h of x.fts.values()) {
    if (h.threadId || h.documentId || h.eventId || h.kind === "MEETING_NOTES") continue;
    out.push({ type: "source", id: h.id, title: h.title, snippet: h.headline, href: links.source(h.id), timestamp: h.occurredAt.toISOString(), rank: Math.min(1, h.rank * 6) });
  }
  return out;
}
