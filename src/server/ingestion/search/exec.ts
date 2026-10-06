/**
 * Execution context for one search: the plan resolved into concrete ids
 * (company families, people and their emails, meetings, graph-linked source
 * items), date bounds in the CEO timezone, and full-text hits over source
 * items — all filtered by the viewer's access scope.
 */
import type { CompanyType, DealType, MeetingCategory, MeetingType, PersonType } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { addDays, dayFromKey, dayStartInstant } from "@/lib/dates";
import type { AccessScope } from "@/server/security/access";
import { familiesOf, sourceItemsForMany } from "./graph-fallback";
import { parseHeadline } from "./snippets";
import { HEADLINE_OPTIONS, HL_START, HL_STOP, ftsFilterSql, likePattern, prefixTsQuery, sourceItemAccessSql } from "./sql";
import type { QueryPlan, SearchViewer, SnippetPart } from "./types";

export interface Range {
  /** Calendar-day bounds (inclusive) for @db.Date columns. */
  fromDay: Date | null;
  toDay: Date | null;
  /** Instant bounds for timestamp columns. */
  from: Date | null;
  toExclusive: Date | null;
}

export interface FtsHit {
  id: string;
  kind: string;
  title: string;
  occurredAt: Date;
  rank: number;
  threadId: string | null;
  documentId: string | null;
  eventId: string | null;
  meetingId: string | null;
  headline?: SnippetPart[];
}

export interface Exec {
  plan: QueryPlan;
  scope: AccessScope;
  viewer: SearchViewer;
  now: Date;
  today: Date;
  timezone: string;
  ceoPersonId: string | null;
  limit: number;
  structured: boolean;
  insights: boolean;
  hasEntities: boolean;
  companyIds: string[];
  personIds: string[];
  emails: string[];
  goalIds: string[];
  dealIds: string[];
  projectIds: string[];
  meetingIds: string[];
  /** Source items linked to the entities through the graph / mentions (unfiltered ids). */
  graphItemIds: string[];
  /** Readable full-text hits keyed by source item id. */
  fts: Map<string, FtsHit>;
  /** Free-text terms for ILIKE matching on structured records. */
  terms: string[];
  range: Range | null;
}

export function toRange(plan: QueryPlan, timezone: string): Range | null {
  if (!plan.timeRange) return null;
  const fromDay = plan.timeRange.from ? dayFromKey(plan.timeRange.from) : null;
  const toDay = plan.timeRange.to ? dayFromKey(plan.timeRange.to) : null;
  return {
    fromDay,
    toDay,
    from: fromDay ? dayStartInstant(fromDay, timezone) : null,
    toExclusive: toDay ? dayStartInstant(addDays(toDay, 1), timezone) : null,
  };
}

export function termsOf(text: string): string[] {
  return [...new Set(text.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2))].slice(0, 8);
}

// ─── Mappings from company types to other vocabularies ─────────────────────

export function personTypesFor(types: CompanyType[]): PersonType[] {
  const out = new Set<PersonType>();
  for (const t of types) {
    if (t === "INVESTOR") ["INVESTOR", "BOARD"].forEach((x) => out.add(x as PersonType));
    if (t === "CUSTOMER" || t === "PROSPECT") out.add("CUSTOMER");
    if (t === "PARTNER" || t === "ACADEMIC") out.add("PARTNER");
  }
  return [...out];
}

export function meetingTypesFor(types: CompanyType[]): MeetingType[] {
  const out = new Set<MeetingType>();
  for (const t of types) {
    if (t === "INVESTOR") out.add("INVESTOR");
    if (t === "CUSTOMER" || t === "PROSPECT") out.add("CUSTOMER");
    if (t === "PARTNER" || t === "ACADEMIC") out.add("PARTNER");
  }
  return [...out];
}

export function meetingCategoriesFor(plan: QueryPlan): MeetingCategory[] {
  const out = new Set<MeetingCategory>();
  for (const t of plan.companyTypes) {
    if (t === "INVESTOR") ["INVESTOR", "FUNDRAISING"].forEach((x) => out.add(x as MeetingCategory));
    if (t === "CUSTOMER" || t === "PROSPECT") ["CUSTOMER", "SALES"].forEach((x) => out.add(x as MeetingCategory));
    if (t === "PARTNER" || t === "ACADEMIC") out.add("PARTNER");
  }
  if (plan.categories.includes("BOARD")) out.add("BOARD");
  if (plan.categories.includes("FUNDRAISING")) ["INVESTOR", "FUNDRAISING"].forEach((x) => out.add(x as MeetingCategory));
  return [...out];
}

export function dealTypesFor(types: CompanyType[]): DealType[] {
  const out = new Set<DealType>();
  for (const t of types) {
    if (t === "INVESTOR") out.add("FUNDRAISING");
    if (t === "CUSTOMER" || t === "PROSPECT") out.add("SALES");
    if (t === "PARTNER" || t === "ACADEMIC") out.add("PARTNERSHIP");
  }
  return [...out];
}

// ─── Building the context ────────────────────────────────────────────────────

export async function buildExec(opts: {
  plan: QueryPlan;
  scope: AccessScope;
  viewer: SearchViewer;
  now: Date;
  today: Date;
  timezone: string;
  ceoPersonId: string | null;
  limit: number;
}): Promise<Exec> {
  const { plan, scope } = opts;
  const structured = opts.viewer.capabilities.includes("workspace.view");
  const insights = opts.viewer.capabilities.includes("brain.view");
  const byKind = (k: string) => plan.entities.filter((e) => e.kind === k).map((e) => e.id);

  const dealIds = byKind("deal");
  const goalIds = byKind("goal");
  const projectIds = byKind("project");
  const personIds = byKind("person");
  const directCompanies = byKind("company");

  // Deals bring their companies in (the Series B → each investor's threads).
  const dealCompanies = dealIds.length ? (await db.deal.findMany({ where: { id: { in: dealIds }, companyId: { not: null } }, select: { companyId: true } })).map((d) => d.companyId!) : [];
  const companyIds = directCompanies.length || dealCompanies.length ? await familiesOf([...directCompanies, ...dealCompanies]) : [];

  // Emails identify participants in threads and calendar events.
  const people = personIds.length || companyIds.length
    ? await db.person.findMany({
        where: { OR: [...(personIds.length ? [{ id: { in: personIds } }] : []), ...(companyIds.length ? [{ companyId: { in: companyIds } }] : [])], email: { not: null } },
        select: { email: true },
        take: 200,
      })
    : [];
  const emails = [...new Set(people.map((p) => p.email!.toLowerCase()))];

  const meetingIds =
    companyIds.length || personIds.length || goalIds.length
      ? (
          await db.meeting.findMany({
            where: {
              OR: [
                ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
                ...(personIds.length ? [{ attendees: { some: { id: { in: personIds } } } }] : []),
                ...(goalIds.length ? [{ goalId: { in: goalIds } }] : []),
              ],
            },
            select: { id: true },
            take: 500,
          })
        ).map((m) => m.id)
      : [];

  const graphNodes = [
    ...directCompanies.map((id) => ({ type: "COMPANY" as const, id })),
    ...personIds.map((id) => ({ type: "PERSON" as const, id })),
    ...projectIds.map((id) => ({ type: "PROJECT" as const, id })),
    ...goalIds.map((id) => ({ type: "GOAL" as const, id })),
    ...dealIds.map((id) => ({ type: "DEAL" as const, id })),
  ];
  const graphItemIds = graphNodes.length && plan.intent !== "commitments" && plan.intent !== "deadlines" ? await sourceItemsForMany(graphNodes, { limit: 300 }) : [];

  const range = toRange(plan, opts.timezone);
  const exec: Exec = {
    ...opts,
    structured,
    insights,
    hasEntities: plan.entities.length > 0,
    companyIds,
    personIds,
    emails,
    goalIds,
    dealIds,
    projectIds,
    meetingIds,
    graphItemIds,
    fts: new Map(),
    terms: termsOf(plan.text),
    range,
  };

  // Full-text search over readable source items (keyword / topic / residual words).
  const ftsText = plan.text || (plan.intent === "related" ? plan.entities.map((e) => e.matched).join(" ") : "");
  if (ftsText) {
    const occurred = plan.timeField === "occurred" && range ? { from: range.from, toExclusive: range.toExclusive } : {};
    const hits = await fullTextSearch(scope, ftsText, { ...occurred, limit: Math.max(60, opts.limit * 6), orMode: plan.intent === "related" });
    for (const h of hits) exec.fts.set(h.id, h);
  }
  return exec;
}

// ─── Full-text search over SourceItem ────────────────────────────────────────

interface FtsRow {
  id: string;
  kind: string;
  title: string;
  occurredAt: Date;
  rank: number;
  threadId: string | null;
  documentId: string | null;
  eventId: string | null;
  meetingId: string | null;
}

/**
 * websearch_to_tsquery over "searchVector" (title A, body B), ranked with
 * ts_rank; falls back to a prefix query (type-ahead) and then ILIKE. Only
 * rows passing the viewer's access filter are returned, and ts_headline runs
 * only on those rows. Noise and duplicates rank lower / are skipped.
 */
export async function fullTextSearch(
  scope: AccessScope,
  text: string,
  opts: { ids?: string[] | null; from?: Date | null; toExclusive?: Date | null; limit?: number; orMode?: boolean } = {},
): Promise<FtsHit[]> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const access = sourceItemAccessSql(scope, "si");
  const filters = ftsFilterSql({ ids: opts.ids ?? null, from: opts.from, toExclusive: opts.toExclusive }, "si");
  const query = opts.orMode ? text.split(/\s+/).filter(Boolean).join(" OR ") : text;

  const select = (tsq: Prisma.Sql) => db.$queryRaw<FtsRow[]>`
    WITH q AS (SELECT ${tsq} AS tsq)
    SELECT si."id", si."kind"::text AS "kind", si."title", si."occurredAt",
      (ts_rank(si."searchVector", q.tsq) * CASE WHEN si."relevance" = 'NOISE' THEN 0.3 ELSE 1 END)::float8 AS "rank",
      em."threadId", d."id" AS "documentId", ce."id" AS "eventId", COALESCE(si."meetingId", ce."meetingId") AS "meetingId"
    FROM "SourceItem" si CROSS JOIN q
    LEFT JOIN "EmailMessage" em ON em."sourceItemId" = si."id"
    LEFT JOIN "Document" d ON d."sourceItemId" = si."id"
    LEFT JOIN "CalendarEvent" ce ON ce."sourceItemId" = si."id"
    WHERE si."searchVector" @@ q.tsq AND si."duplicateOfId" IS NULL AND ${access} ${filters}
    ORDER BY "rank" DESC, si."occurredAt" DESC
    LIMIT ${limit}`;

  let rows = await select(Prisma.sql`websearch_to_tsquery('english', ${query})`);
  const prefix = rows.length ? null : prefixTsQuery(text);
  if (!rows.length && prefix) rows = await select(Prisma.sql`to_tsquery('english', ${prefix})`);
  if (!rows.length) {
    const terms = termsOf(text).slice(0, 4);
    if (!terms.length) return [];
    const likes = terms.map((t) => Prisma.sql`(si."title" ILIKE ${likePattern(t)} OR si."text" ILIKE ${likePattern(t)})`);
    rows = await db.$queryRaw<FtsRow[]>`
      SELECT si."id", si."kind"::text AS "kind", si."title", si."occurredAt", 0.01::float8 AS "rank",
        em."threadId", d."id" AS "documentId", ce."id" AS "eventId", COALESCE(si."meetingId", ce."meetingId") AS "meetingId"
      FROM "SourceItem" si
      LEFT JOIN "EmailMessage" em ON em."sourceItemId" = si."id"
      LEFT JOIN "Document" d ON d."sourceItemId" = si."id"
      LEFT JOIN "CalendarEvent" ce ON ce."sourceItemId" = si."id"
      WHERE (${Prisma.join(likes, opts.orMode ? " OR " : " AND ")}) AND si."duplicateOfId" IS NULL AND ${access} ${filters}
      ORDER BY si."occurredAt" DESC
      LIMIT ${limit}`;
  }
  if (!rows.length) return [];

  // Snippets for the top rows only, re-checking access (defense in depth).
  const top = rows.slice(0, 40).map((r) => r.id);
  const tsq = prefix ? Prisma.sql`to_tsquery('english', ${prefix})` : Prisma.sql`websearch_to_tsquery('english', ${query})`;
  const heads = await db.$queryRaw<{ id: string; headline: string | null }[]>`
    SELECT si."id",
      CASE WHEN si."text" IS NULL OR si."contentPurgedAt" IS NOT NULL THEN NULL
      ELSE ts_headline('english', left(regexp_replace(si."text", ${`[${HL_START}${HL_STOP}]`}, '', 'g'), 20000), ${tsq}, ${HEADLINE_OPTIONS}) END AS "headline"
    FROM "SourceItem" si
    WHERE si."id" = ANY(${top}::text[]) AND ${access}`;
  const headMap = new Map(heads.map((h) => [h.id, h.headline]));
  return rows.map((r) => {
    const h = headMap.get(r.id);
    const parsed = h ? parseHeadline(h) : undefined;
    return { ...r, rank: Number(r.rank), headline: parsed?.some((p) => p.match) ? parsed : undefined };
  });
}

/** Does any source item match this text that the viewer cannot read? (cheap EXISTS, no content read) */
export async function hasHiddenMatches(scope: AccessScope, text: string): Promise<boolean> {
  if (scope.all || !text.trim()) return false;
  const access = sourceItemAccessSql(scope, "si");
  const rows = await db.$queryRaw<{ hidden: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM "SourceItem" si
      WHERE si."searchVector" @@ websearch_to_tsquery('english', ${text}) AND si."duplicateOfId" IS NULL AND NOT ${access}
    ) AS "hidden"`;
  return Boolean(rows[0]?.hidden);
}
