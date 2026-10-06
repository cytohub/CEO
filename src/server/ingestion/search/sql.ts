/**
 * Raw-SQL building blocks for full-text search over SourceItem.
 *
 * Prisma's query API cannot express tsvector matching, so the FTS query is
 * raw SQL — but the access rule must be exactly the one in
 * src/server/security/access.ts (sourceItemWhere). sourceItemAccessSql()
 * mirrors it clause by clause and is unit-tested against the same scopes.
 * Everything user-supplied is a bound parameter; the only raw fragment is the
 * table alias, which comes from a fixed whitelist.
 */
import { Prisma } from "@/generated/prisma/client";
import type { AccessScope } from "@/server/security/access";

const ALIASES = { si: Prisma.raw(`"si"`), src: Prisma.raw(`"src"`) } as const;
export type SourceAlias = keyof typeof ALIASES;

/**
 * WHERE fragment: the viewer may read the source item aliased `alias`.
 * Mirrors sourceItemWhere(): clearance level OR owned/granted connection OR
 * granted item OR granted document OR granted thread. No scope → FALSE.
 */
export function sourceItemAccessSql(scope: AccessScope, alias: SourceAlias = "si"): Prisma.Sql {
  if (scope.all) return Prisma.sql`TRUE`;
  const a = ALIASES[alias];
  const or: Prisma.Sql[] = [];
  if (scope.levels.length) or.push(Prisma.sql`${a}."sensitivity"::text = ANY(${[...scope.levels]}::text[])`);
  if (scope.connectionIds.length) or.push(Prisma.sql`${a}."connectionId" = ANY(${[...scope.connectionIds]}::text[])`);
  if (scope.sourceItemIds.length) or.push(Prisma.sql`${a}."id" = ANY(${[...scope.sourceItemIds]}::text[])`);
  if (scope.documentIds.length) {
    or.push(Prisma.sql`EXISTS (SELECT 1 FROM "Document" gd WHERE gd."sourceItemId" = ${a}."id" AND gd."id" = ANY(${[...scope.documentIds]}::text[]))`);
  }
  if (scope.threadIds.length) {
    or.push(Prisma.sql`EXISTS (SELECT 1 FROM "EmailMessage" gm WHERE gm."sourceItemId" = ${a}."id" AND gm."threadId" = ANY(${[...scope.threadIds]}::text[]))`);
  }
  if (!or.length) return Prisma.sql`FALSE`;
  return Prisma.sql`(${Prisma.join(or, " OR ")})`;
}

/** Characters ts_headline wraps matches in; they never occur in normalized text (stripped before highlighting). */
export const HL_START = "\u0002";
export const HL_STOP = "\u0003";
export const HEADLINE_OPTIONS = `StartSel=${HL_START}, StopSel=${HL_STOP}, MaxWords=32, MinWords=14, ShortWord=3, MaxFragments=2, FragmentDelimiter=" … "`;

export interface FtsFilters {
  /** Restrict to these source item ids (entity-scoped search). */
  ids?: string[] | null;
  kinds?: string[] | null;
  /** occurredAt bounds (instants). */
  from?: Date | null;
  toExclusive?: Date | null;
}

/** Optional extra WHERE clauses for the FTS query (all parameterized). */
export function ftsFilterSql(f: FtsFilters, alias: SourceAlias = "si"): Prisma.Sql {
  const a = ALIASES[alias];
  const parts: Prisma.Sql[] = [];
  if (f.ids) parts.push(f.ids.length ? Prisma.sql`${a}."id" = ANY(${f.ids}::text[])` : Prisma.sql`FALSE`);
  if (f.kinds?.length) parts.push(Prisma.sql`${a}."kind"::text = ANY(${f.kinds}::text[])`);
  if (f.from) parts.push(Prisma.sql`${a}."occurredAt" >= ${f.from}`);
  if (f.toExclusive) parts.push(Prisma.sql`${a}."occurredAt" < ${f.toExclusive}`);
  return parts.length ? Prisma.sql`AND ${Prisma.join(parts, " AND ")}` : Prisma.empty;
}

/**
 * A prefix tsquery string ("electro:* & trac:*") built only from [a-z0-9]
 * fragments, for type-ahead matching when the websearch query finds nothing.
 * Returns null when nothing usable remains.
 */
export function prefixTsQuery(text: string): string | null {
  const parts = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2)
    .slice(0, 8);
  return parts.length ? parts.map((w) => `${w}:*`).join(" & ") : null;
}

/** Escape LIKE wildcards so user text matches literally. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
