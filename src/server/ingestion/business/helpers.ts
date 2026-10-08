/**
 * Writes shared by the business connectors: Brain signals, scoreboard
 * metrics, companies and people. Every write is idempotent, so a retried or
 * repeated sync never duplicates anything.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { CompanyType, MetricCategory, MetricDirection, MetricUnit, SignalKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { CONNECTOR_DEFINITIONS } from "@/server/brain/connectors";
import type { SignalMetadata } from "@/server/brain/analyzers/signals";
import type { ConnectorSyncContext } from "./types";

// ─── Dates ───────────────────────────────────────────────────────────────────

/** UTC midnight of the day (MetricValue.recordedAt is a date). */
export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** First day of the month (UTC). `offset` moves whole months (-1 = previous month). */
export function utcMonthStart(d: Date, offset = 0): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1));
}

/** YYYY-MM-DD in UTC. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Catalog ─────────────────────────────────────────────────────────────────

/** The BrainSource catalog row for a connector key, created on first use. */
export async function ensureBrainSource(key: string): Promise<string> {
  const existing = await db.brainSource.findUnique({ where: { key }, select: { id: true } });
  if (existing) return existing.id;
  const def = CONNECTOR_DEFINITIONS.find((c) => c.key === key);
  if (!def) throw new Error(`Unknown connector catalog key ${key}`);
  const row = await db.brainSource.upsert({
    where: { key },
    create: { key, name: def.name, category: def.category, description: def.description, status: "CONNECTED" },
    update: {},
    select: { id: true },
  });
  return row.id;
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export interface SignalInput {
  /** Stable per event (e.g. `deal:123:stage:closedwon`): the same event is never signalled twice. */
  externalId: string;
  kind: SignalKind;
  title: string;
  body?: string | null;
  occurredAt: Date;
  metadata?: SignalMetadata & Record<string, unknown>;
  dealId?: string | null;
  companyId?: string | null;
  personId?: string | null;
}

/**
 * Record a Brain signal (immutable once written). The next Daily Brain
 * Refresh turns it into an insight and, when it needs the CEO, an inbox item.
 */
export async function emitSignal(ctx: Pick<ConnectorSyncContext, "connection">, input: SignalInput): Promise<"created" | "unchanged"> {
  const sourceId = await ensureBrainSource(ctx.connection.sourceKey);
  const externalId = input.externalId.slice(0, 300);
  const existing = await db.brainSignal.findUnique({ where: { sourceId_externalId: { sourceId, externalId } }, select: { id: true } });
  if (existing) return "unchanged";
  await db.brainSignal.create({
    data: {
      sourceId,
      externalId,
      kind: input.kind,
      title: input.title.slice(0, 500),
      body: input.body?.slice(0, 5000) ?? null,
      occurredAt: input.occurredAt,
      metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      dealId: input.dealId ?? null,
      companyId: input.companyId ?? null,
      personId: input.personId ?? null,
    },
  });
  return "created";
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface MetricDefinition {
  key: string;
  name: string;
  category: MetricCategory;
  unit: MetricUnit;
  direction?: MetricDirection;
  description: string;
}

/**
 * Make sure a scoreboard metric exists and is fed by this connector. A metric
 * the CEO already has (e.g. "Cash on hand" kept by hand) is switched over to
 * the connector; its history and any manual points stay.
 */
export async function ensureMetric(ctx: Pick<ConnectorSyncContext, "connection">, def: MetricDefinition): Promise<string> {
  const sourceKey = ctx.connection.sourceKey;
  const existing = await db.metric.findUnique({ where: { key: def.key }, select: { id: true, sourceKey: true } });
  if (existing) {
    // Derived metrics are computed from workspace data and stay derived.
    if (existing.sourceKey !== sourceKey && !existing.sourceKey.startsWith("derived:")) {
      await db.metric.update({ where: { id: existing.id }, data: { sourceKey } });
    }
    return existing.id;
  }
  const order = await db.metric.count({ where: { category: def.category } });
  const row = await db.metric.create({
    data: {
      key: def.key,
      name: def.name,
      category: def.category,
      unit: def.unit,
      direction: def.direction ?? "HIGHER_IS_BETTER",
      description: def.description,
      sourceKey,
      order,
    },
    select: { id: true },
  });
  return row.id;
}

/**
 * Record a metric value for a day (or a month: pass its first day). Values the
 * CEO entered by hand for the same day win: a connector never overwrites them.
 */
export async function recordMetric(
  ctx: Pick<ConnectorSyncContext, "connection">,
  input: { metricId: string; day: Date; value: number; note?: string | null },
): Promise<"created" | "updated" | "unchanged"> {
  if (!Number.isFinite(input.value)) return "unchanged";
  const recordedAt = utcDay(input.day);
  const value = Math.round(input.value * 100) / 100;
  const existing = await db.metricValue.findUnique({ where: { metricId_recordedAt: { metricId: input.metricId, recordedAt } } });
  if (existing) {
    if (existing.source === "manual" || (existing.value === value && existing.source === ctx.connection.sourceKey)) return "unchanged";
    await db.metricValue.update({ where: { id: existing.id }, data: { value, source: ctx.connection.sourceKey, note: input.note ?? existing.note } });
    return "updated";
  }
  await db.metricValue.create({ data: { metricId: input.metricId, recordedAt, value, source: ctx.connection.sourceKey, note: input.note ?? null } });
  return "created";
}

// ─── Companies and people ────────────────────────────────────────────────────

/** Lower-cased bare domain from a domain, URL or email address. */
export function normalizeDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  if (v.includes("@")) v = v.split("@").pop() ?? "";
  v = v.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0] ?? "";
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v) ? v : null;
}

/** Webmail domains never identify a company. */
const PERSONAL_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com"]);

/**
 * The company with this domain or name, created when unknown. Domain wins over
 * name (names vary: "Brightwater Therapeutics, Inc." vs "Brightwater").
 */
export async function findOrCreateCompany(input: { name: string | null | undefined; domain?: string | null; type?: CompanyType }): Promise<string | null> {
  const name = input.name?.trim().replace(/\s+/g, " ").slice(0, 200) || null;
  const domain = normalizeDomain(input.domain);
  const usableDomain = domain && !PERSONAL_DOMAINS.has(domain) ? domain : null;
  if (usableDomain) {
    const byDomain = await db.company.findFirst({ where: { domain: { equals: usableDomain, mode: "insensitive" } }, select: { id: true } });
    if (byDomain) return byDomain.id;
  }
  if (name) {
    const byName = await db.company.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true, domain: true } });
    if (byName) {
      if (usableDomain && !byName.domain) await db.company.update({ where: { id: byName.id }, data: { domain: usableDomain } });
      return byName.id;
    }
  }
  if (!name && !usableDomain) return null;
  const created = await db.company.upsert({
    where: { name: name ?? usableDomain! },
    create: { name: name ?? usableDomain!, domain: usableDomain, type: input.type ?? "OTHER", website: usableDomain ? `https://${usableDomain}` : null },
    update: {},
    select: { id: true },
  });
  return created.id;
}

/** The person with this email address, if CytoHub Brain knows them. */
export async function findPersonByEmail(email: string | null | undefined): Promise<string | null> {
  const e = email?.trim().toLowerCase();
  if (!e || !e.includes("@")) return null;
  const row = await db.person.findFirst({ where: { email: { equals: e, mode: "insensitive" } }, select: { id: true } });
  return row?.id ?? null;
}
