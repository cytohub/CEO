/**
 * Audit log: filtered, paginated reads and CSV export. Filters arrive from the
 * URL, so every value is validated; dates are calendar days in the CEO's
 * timezone.
 */
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { AuditOutcome } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { addDays, dayFromKey, dayStartInstant } from "@/lib/dates";

export const AUDIT_PAGE_SIZE = 50;
/** CSV exports are capped so one click can't pull the whole history into memory. */
export const AUDIT_EXPORT_LIMIT = 10_000;

const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => !Number.isNaN(dayFromKey(v).getTime()));

export const auditFiltersSchema = z.object({
  action: z.string().trim().max(80).regex(/^[a-z0-9_.-]+$/i).optional().catch(undefined),
  actor: z.string().trim().max(200).optional().catch(undefined),
  outcome: z.enum(AuditOutcome).optional().catch(undefined),
  from: dayKey.optional().catch(undefined),
  to: dayKey.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
});

export type AuditFilters = z.infer<typeof auditFiltersSchema>;

/** URL search params → validated filters (bad values are dropped, never thrown). Pure. */
export function parseAuditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  return auditFiltersSchema.parse({
    action: one(sp.action),
    actor: one(sp.actor),
    outcome: one(sp.outcome),
    from: one(sp.from),
    to: one(sp.to),
    page: one(sp.page),
  });
}

/** Prisma filter for the audit log. `to` is inclusive (whole CEO-local day). Pure. */
export function auditWhere(f: Omit<AuditFilters, "page">, timezone: string): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  if (f.action) and.push({ action: f.action });
  if (f.actor) and.push({ actorLabel: { contains: f.actor, mode: "insensitive" } });
  if (f.outcome) and.push({ outcome: f.outcome });
  if (f.from) and.push({ at: { gte: dayStartInstant(dayFromKey(f.from), timezone) } });
  if (f.to) and.push({ at: { lt: dayStartInstant(addDays(dayFromKey(f.to), 1), timezone) } });
  return and.length ? { AND: and } : {};
}

export interface AuditRow {
  id: string;
  at: Date;
  action: string;
  outcome: AuditOutcome;
  actorLabel: string;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  ip: string | null;
  userAgent: string | null;
  metadata: Prisma.JsonValue | null;
}

const SELECT = {
  id: true,
  at: true,
  action: true,
  outcome: true,
  actorLabel: true,
  targetType: true,
  targetId: true,
  ip: true,
  userAgent: true,
  metadata: true,
  actor: { select: { name: true } },
} satisfies Prisma.AuditLogSelect;

type Selected = Prisma.AuditLogGetPayload<{ select: typeof SELECT }>;
const toRow = (r: Selected): AuditRow => ({ ...r, actorName: r.actor?.name ?? null });

export async function getAuditPage(f: AuditFilters, timezone: string) {
  const where = auditWhere(f, timezone);
  const [total, rows, actions] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({ where, orderBy: [{ at: "desc" }, { id: "desc" }], skip: (f.page - 1) * AUDIT_PAGE_SIZE, take: AUDIT_PAGE_SIZE, select: SELECT }),
    db.auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { action: "asc" } }),
  ]);
  return {
    rows: rows.map(toRow),
    total,
    page: f.page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    actions: actions.map((a) => ({ action: a.action, count: a._count._all })),
  };
}

export async function getAuditExportRows(f: Omit<AuditFilters, "page">, timezone: string): Promise<{ rows: AuditRow[]; truncated: boolean }> {
  const rows = await db.auditLog.findMany({ where: auditWhere(f, timezone), orderBy: [{ at: "desc" }, { id: "desc" }], take: AUDIT_EXPORT_LIMIT + 1, select: SELECT });
  return { rows: rows.slice(0, AUDIT_EXPORT_LIMIT).map(toRow), truncated: rows.length > AUDIT_EXPORT_LIMIT };
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/**
 * One CSV cell. Quotes when needed, and neutralizes spreadsheet formulas:
 * actor labels and metadata can be attacker-controlled (e.g. a failed sign-in
 * with an email of "=HYPERLINK(…)"), so a leading = + - @ tab or CR is
 * prefixed with an apostrophe. Pure.
 */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const AUDIT_CSV_COLUMNS = ["at", "action", "outcome", "actor", "actorName", "targetType", "targetId", "ip", "userAgent", "metadata"] as const;

/** RFC 4180 CSV (CRLF line endings) of audit rows. Pure. */
export function auditCsv(rows: AuditRow[]): string {
  const lines = [AUDIT_CSV_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([r.at, r.action, r.outcome, r.actorLabel, r.actorName, r.targetType, r.targetId, r.ip, r.userAgent, r.metadata].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
