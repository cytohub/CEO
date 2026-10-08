/**
 * QuickBooks Online connector (OAuth; Intuit has no read-only accounting
 * scope, so this connector only ever issues GET requests).
 *
 *   P&L    reports/ProfitAndLoss, accrual basis, one column per month from the
 *          first day of the month 12 complete months ago through today →
 *          revenue, operating expenses, net income and the annualized
 *          run-rate per complete month, plus trailing-12-month revenue.
 *   Cash   active bank accounts (query API). Brex is the live truth for cash
 *          while connected, so QuickBooks then records "Cash per books" only;
 *          without Brex it feeds cash on hand and an accrual-based net burn so
 *          runway still works.
 *
 * The current month is partial and never recorded (it would read as a drop).
 * When a month completes, one Brain signal summarizes it; the first sync only
 * backfills history.
 */
import { z } from "zod";
import { formatCurrency } from "@/lib/format";
import { ProviderHttpError, type RefreshableProviderContext, providerJson } from "../providers/http";
import { REALM_ID, quickbooksApiBase } from "../providers/oauth";
import { ProviderAuthError } from "../types";
import {
  CASH_BOOKS,
  CASH_ON_HAND,
  NET_BURN,
  NET_INCOME_MONTHLY,
  OPEX_MONTHLY,
  REVENUE_MONTHLY,
  REVENUE_RUN_RATE,
  REVENUE_TTM,
  cashAuthority,
  ensureRunwayMetric,
  monthKey,
  monthLabel,
  monthName,
} from "./finance-metrics";
import { type SignalInput, emitSignal, ensureMetric, isoDay, recordMetric, utcDay, utcMonthStart } from "./helpers";
import type { BusinessConnector, ConnectorSyncContext } from "./types";

/** Days after a month ends before its books are reported in the brief (most close by then). */
const BOOKS_CLOSE_GRACE_DAYS = 10;

const MINOR_VERSION = 75;
const BANK_QUERY = "select * from Account where AccountType = 'Bank' and Active = true MAXRESULTS 1000";
/** Months averaged for the accrual net burn. */
const BURN_WINDOW = 3;

// ─── Response schemas (only the fields we read) ─────────────────────────────

export interface QboReportRow {
  type?: string;
  group?: string;
  ColData?: { value?: unknown }[];
  Summary?: { ColData?: { value?: unknown }[] };
  Rows?: { Row?: QboReportRow[] };
}

const colDataSchema = z.array(z.object({ value: z.unknown().optional() }));

const rowSchema: z.ZodType<QboReportRow> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    group: z.string().optional(),
    ColData: colDataSchema.optional(),
    Summary: z.object({ ColData: colDataSchema.optional() }).optional(),
    Rows: z.object({ Row: z.array(rowSchema).optional() }).optional(),
  }),
);

const nameValueSchema = z.object({ Name: z.string().optional(), Value: z.string().optional() });

export const profitAndLossSchema = z.object({
  Header: z.object({ Currency: z.string().optional(), Option: z.array(nameValueSchema).optional() }).optional(),
  Columns: z
    .object({
      Column: z.array(z.object({ ColType: z.string().optional(), ColTitle: z.string().optional(), MetaData: z.array(nameValueSchema).optional() })).optional(),
    })
    .optional(),
  Rows: z.object({ Row: z.array(rowSchema).optional() }).optional(),
});
export type ProfitAndLossReport = z.infer<typeof profitAndLossSchema>;

const bankAccountSchema = z.object({
  Id: z.string().optional(),
  CurrentBalance: z.unknown().optional(),
  CurrencyRef: z.object({ value: z.string().optional() }).optional(),
});
export type QboBankAccount = z.infer<typeof bankAccountSchema>;

const accountQuerySchema = z.object({ QueryResponse: z.object({ Account: z.array(bankAccountSchema).optional() }).optional() });

// ─── P&L parsing ─────────────────────────────────────────────────────────────

export interface PnlMonth {
  /** "YYYY-MM" */
  month: string;
  start: Date;
  income: number;
  cogs: number;
  expenses: number;
  otherIncome: number;
  otherExpenses: number;
  netIncome: number;
}

/** Report sections whose Summary row carries the totals we use. */
const GROUP_FIELDS = {
  Income: "income",
  COGS: "cogs",
  Expenses: "expenses",
  OtherIncome: "otherIncome",
  OtherExpenses: "otherExpenses",
  NetIncome: "netIncome",
} as const;
type Group = keyof typeof GROUP_FIELDS;

/** Report amounts are strings ("1234.56"); an empty string means zero. */
export function parseAmount(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "YYYY-MM" of a monthly Money column: MetaData StartDate, else a "Sep 2026" / "Sep. 2026" title. Null for Total. */
function columnMonth(col: NonNullable<NonNullable<ProfitAndLossReport["Columns"]>["Column"]>[number]): string | null {
  if (col.ColType !== "Money") return null;
  const meta = new Map((col.MetaData ?? []).map((m) => [m.Name, m.Value]));
  if (meta.get("ColKey") === "total") return null;
  const start = meta.get("StartDate");
  if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) return start.slice(0, 7);
  const title = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(col.ColTitle?.trim() ?? "");
  const index = title ? MONTH_ABBR.indexOf(title[1].toLowerCase()) : -1;
  return title && index >= 0 ? `${title[2]}-${String(index + 1).padStart(2, "0")}` : null;
}

/**
 * Per-month totals from a ProfitAndLoss report summarized by month. Sections
 * are found by `group` at any depth (the first match wins; sub-account
 * sections inside it are not counted twice). Missing groups count as zero;
 * a missing NetIncome is derived from the other groups.
 */
export function parseProfitAndLoss(report: ProfitAndLossReport): PnlMonth[] {
  const columns = (report.Columns?.Column ?? []).map((col, index) => ({ index, month: columnMonth(col) })).filter((c): c is { index: number; month: string } => c.month !== null);

  const totals = new Map<Group, unknown[]>();
  const walk = (rows: QboReportRow[] | undefined) => {
    for (const row of rows ?? []) {
      if (row.group && row.group in GROUP_FIELDS && !totals.has(row.group as Group)) {
        totals.set(row.group as Group, (row.Summary?.ColData ?? []).map((c) => c.value));
        continue;
      }
      walk(row.Rows?.Row);
    }
  };
  walk(report.Rows?.Row);

  const at = (group: Group, index: number) => parseAmount(totals.get(group)?.[index]);
  return columns
    .map(({ index, month }) => {
      const income = at("Income", index);
      const cogs = at("COGS", index);
      const expenses = at("Expenses", index);
      const otherIncome = at("OtherIncome", index);
      const otherExpenses = at("OtherExpenses", index);
      const netIncome = totals.has("NetIncome") ? at("NetIncome", index) : income - cogs - expenses + otherIncome - otherExpenses;
      const [y, m] = month.split("-").map(Number);
      return { month, start: new Date(Date.UTC(y, m - 1, 1)), income, cogs, expenses, otherIncome, otherExpenses, netIncome };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ─── Aggregates ──────────────────────────────────────────────────────────────

/** Months that ended before the current (UTC) month. */
export function completeMonths(months: PnlMonth[], now: Date): PnlMonth[] {
  const current = utcMonthStart(now).getTime();
  return months.filter((m) => m.start.getTime() < current);
}

/** Revenue over the last 12 complete months (fewer when QuickBooks has less history). */
export function trailingRevenue(complete: PnlMonth[]): { value: number; months: number } {
  const window = complete.slice(-12);
  return { value: window.reduce((s, m) => s + m.income, 0), months: window.length };
}

/**
 * Accrual net burn: the average of max(0, −net income) over a 3-month window,
 * for each month that has a full window. The latest month always gets a value
 * (over whatever history exists) so runway can be computed.
 */
export function accrualNetBurn(complete: PnlMonth[], window = BURN_WINDOW): { month: string; start: Date; value: number }[] {
  const out: { month: string; start: Date; value: number }[] = [];
  complete.forEach((m, i) => {
    const slice = complete.slice(Math.max(0, i - window + 1), i + 1);
    if (slice.length < window && i < complete.length - 1) return;
    out.push({ month: m.month, start: m.start, value: slice.reduce((s, x) => s + Math.max(0, -x.netIncome), 0) / slice.length });
  });
  return out;
}

/** Active bank balances in USD (accounts without a currency are in the home currency, USD for CytoHub). */
export function sumBankBalances(accounts: QboBankAccount[]): { total: number; counted: number; otherCurrencies: string[] } {
  let total = 0;
  let counted = 0;
  const other = new Set<string>();
  for (const a of accounts) {
    const currency = a.CurrencyRef?.value?.toUpperCase() ?? "USD";
    if (currency !== "USD") {
      other.add(currency);
      continue;
    }
    total += parseAmount(a.CurrentBalance);
    counted++;
  }
  return { total: Math.round(total * 100) / 100, counted, otherCurrencies: [...other].sort() };
}

/** "September books: revenue $412K (+8% vs August), net loss $1.1M" for the latest complete month. */
export function booksSignal(complete: PnlMonth[], now: Date): SignalInput | null {
  const last = complete.at(-1);
  if (!last) return null;
  const before = complete.at(-2);
  const previous = before && before.month === monthKey(utcMonthStart(last.start, -1)) ? before : null;
  const change = previous && previous.income !== 0 ? (last.income - previous.income) / Math.abs(previous.income) : null;
  const versus = previous && change !== null ? ` (${change >= 0 ? "+" : "-"}${Math.round(Math.abs(change) * 100)}% vs ${monthName(previous.month)})` : "";
  const net = (compact: boolean) => `${last.netIncome < 0 ? "net loss" : "net income"} ${formatCurrency(Math.abs(last.netIncome), compact)}`;
  const summary =
    `QuickBooks (accrual) for ${monthLabel(last.month)}: revenue ${formatCurrency(last.income, false)}, ` +
    `operating expenses ${formatCurrency(last.cogs + last.expenses, false)}, ${net(false)}. Figures can still change until the month’s books are closed.`;
  return {
    externalId: `quickbooks:month:${last.month}`,
    kind: "METRIC_UPDATE",
    title: `${monthName(last.month)} books: revenue ${formatCurrency(last.income)}${versus}, ${net(true)}`,
    body: summary,
    occurredAt: now,
    metadata: { signalType: "development", importance: 3, summary },
  };
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** The connected company. Only a reconnect can supply a missing one, so it is an auth error. */
export function realmIdOf(settings: Record<string, unknown>): string {
  const realmId = typeof settings.realmId === "string" || typeof settings.realmId === "number" ? String(settings.realmId).trim() : "";
  if (!REALM_ID.test(realmId)) throw new ProviderAuthError("QuickBooks company id (realmId) is missing from this connection. Reconnect QuickBooks in Settings → Integrations.");
  return realmId;
}

async function qboGet<S extends z.ZodType>(http: RefreshableProviderContext, url: string, schema: S): Promise<z.infer<S>> {
  try {
    return await providerJson(http, url, schema);
  } catch (error) {
    // 403: the signed-in user lost access to the company or its subscription lapsed. Retrying cannot fix it.
    if (error instanceof ProviderHttpError && error.status === 403) {
      throw new ProviderAuthError("QuickBooks refused access to this company (403). Reconnect QuickBooks in Settings → Integrations as a company admin.");
    }
    throw error;
  }
}

/** Monthly P&L from the first day of the month 12 complete months ago through today. */
export function fetchProfitAndLoss(http: RefreshableProviderContext, realmId: string, now: Date): Promise<ProfitAndLossReport> {
  const params = new URLSearchParams({
    start_date: isoDay(utcMonthStart(now, -12)),
    end_date: isoDay(now),
    summarize_column_by: "Month",
    accounting_method: "Accrual",
    minorversion: String(MINOR_VERSION),
  });
  return qboGet(http, `${quickbooksApiBase()}/v3/company/${realmId}/reports/ProfitAndLoss?${params}`, profitAndLossSchema);
}

export async function fetchBankAccounts(http: RefreshableProviderContext, realmId: string): Promise<QboBankAccount[]> {
  // Intuit documents the query with %20-encoded spaces; URLSearchParams would send "+".
  const url = `${quickbooksApiBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(BANK_QUERY)}&minorversion=${MINOR_VERSION}`;
  const res = await qboGet(http, url, accountQuerySchema);
  return res.QueryResponse?.Account ?? [];
}

// ─── Sync ────────────────────────────────────────────────────────────────────

const PNL_NOTE = "QuickBooks P&L (accrual)";

async function syncQuickBooks(ctx: ConnectorSyncContext): Promise<void> {
  const realmId = realmIdOf(ctx.connection.settings);
  const tally = (outcome: "created" | "updated" | "unchanged") => ctx.count(outcome);

  const report = await fetchProfitAndLoss(ctx.http, realmId, ctx.now);
  const months = parseProfitAndLoss(report);
  const complete = completeMonths(months, ctx.now);
  ctx.count("fetched", months.length);
  const currency = report.Header?.Currency;
  if (currency && currency !== "USD") ctx.note(`The books are kept in ${currency}; amounts are recorded as reported.`);

  const revenueId = await ensureMetric(ctx, REVENUE_MONTHLY);
  const opexId = await ensureMetric(ctx, OPEX_MONTHLY);
  const netIncomeId = await ensureMetric(ctx, NET_INCOME_MONTHLY);
  const runRateId = await ensureMetric(ctx, REVENUE_RUN_RATE);
  const ttmId = await ensureMetric(ctx, REVENUE_TTM);
  for (const m of complete) {
    tally(await recordMetric(ctx, { metricId: revenueId, day: m.start, value: m.income, note: PNL_NOTE }));
    tally(await recordMetric(ctx, { metricId: opexId, day: m.start, value: m.cogs + m.expenses, note: `${PNL_NOTE}: cost of goods sold + expenses` }));
    tally(await recordMetric(ctx, { metricId: netIncomeId, day: m.start, value: m.netIncome, note: PNL_NOTE }));
    tally(await recordMetric(ctx, { metricId: runRateId, day: m.start, value: m.income * 12, note: `${PNL_NOTE}: month’s revenue × 12` }));
  }
  const last = complete.at(-1);
  if (last) {
    const ttm = trailingRevenue(complete);
    const note = ttm.months < 12 ? `${PNL_NOTE}: only ${ttm.months} complete months available` : `${PNL_NOTE}: last 12 complete months`;
    tally(await recordMetric(ctx, { metricId: ttmId, day: last.start, value: ttm.value, note }));
    ctx.note(`P&L: ${complete.length} complete months through ${monthLabel(last.month)} (accrual).`);
  } else {
    ctx.note("P&L: no complete month in QuickBooks yet.");
  }

  const accounts = await fetchBankAccounts(ctx.http, realmId);
  ctx.count("fetched", accounts.length);
  const bank = sumBankBalances(accounts);
  if (bank.otherCurrencies.length) ctx.note(`Bank accounts in ${bank.otherCurrencies.join(", ")} are not included (USD only).`);
  const authority = await cashAuthority();
  const today = utcDay(ctx.now);
  if (authority === "QUICKBOOKS") {
    if (bank.counted > 0) {
      const cashId = await ensureMetric(ctx, CASH_ON_HAND);
      tally(await recordMetric(ctx, { metricId: cashId, day: today, value: bank.total, note: "Bank accounts per QuickBooks" }));
    }
    const burnId = await ensureMetric(ctx, NET_BURN);
    for (const b of accrualNetBurn(complete)) {
      tally(await recordMetric(ctx, { metricId: burnId, day: b.start, value: b.value, note: "Accrual basis: average monthly net loss over the last 3 complete months (QuickBooks)" }));
    }
    await ensureRunwayMetric();
    ctx.note(bank.counted > 0 ? `Cash on hand from ${bank.counted} QuickBooks bank account(s); net burn from the P&L (no live Brex connection).` : "No active USD bank accounts in QuickBooks.");
  } else if (bank.counted > 0) {
    const booksId = await ensureMetric(ctx, CASH_BOOKS);
    tally(await recordMetric(ctx, { metricId: booksId, day: today, value: bank.total, note: "Bank accounts per QuickBooks (Brex is the live source for cash on hand)" }));
    ctx.note(`Cash per books from ${bank.counted} bank account(s); Brex supplies cash on hand and burn.`);
  }

  // One summary signal per month, once its books have had time to close (values are
  // rewritten every sync until then). The first sync only backfills history.
  const cursorMonth = (key: string) => (typeof ctx.cursor?.[key] === "string" ? (ctx.cursor[key] as string) : null);
  let signalled = ctx.initial ? (last?.month ?? null) : (cursorMonth("lastSignalledMonth") ?? cursorMonth("lastCompleteMonth"));
  const closed = last ? ctx.now.getTime() >= utcMonthStart(last.start, 1).getTime() + BOOKS_CLOSE_GRACE_DAYS * 86_400_000 : false;
  if (!ctx.initial && last && closed && (!signalled || last.month > signalled)) {
    const signal = booksSignal(complete, ctx.now);
    if (signal && (await emitSignal(ctx, signal)) === "created") ctx.count("created");
    signalled = last.month;
  }
  await ctx.saveCursor({ lastCompleteMonth: last?.month ?? cursorMonth("lastCompleteMonth"), lastSignalledMonth: signalled });
}

export const quickbooksConnector: BusinessConnector = {
  provider: "QUICKBOOKS",
  sync: syncQuickBooks,
};
