/**
 * Scoreboard metrics fed by the finance connectors, and which system owns cash.
 *
 * CytoHub banks with Brex and keeps its books in QuickBooks Online. Brex is the
 * live truth for cash (balances, cash burn); QuickBooks is the truth for
 * revenue and the P&L. While a live Brex connection exists, QuickBooks records
 * its bank balance as "Cash per books" only, so the two systems never write
 * competing values into "Cash on hand" or "Net burn" (which feed runway).
 */
import { db } from "@/lib/db";
import { DERIVED_METRICS } from "@/server/brain/metrics";
import type { MetricDefinition } from "./helpers";

// ─── Definitions ─────────────────────────────────────────────────────────────

export const CASH_ON_HAND: MetricDefinition = {
  key: "cash_on_hand",
  name: "Cash on hand",
  category: "CASH",
  unit: "CURRENCY",
  description:
    "Brex: sum of current balances across all Brex cash accounts (USD), read live on every sync. Without a live Brex connection: sum of active QuickBooks bank account balances (USD).",
};

export const NET_BURN: MetricDefinition = {
  key: "net_burn",
  name: "Net burn (monthly)",
  category: "CASH",
  unit: "CURRENCY",
  direction: "LOWER_IS_BETTER",
  description:
    "Brex (cash basis): money out minus money in across Brex cash accounts for the calendar month, transfers between Brex accounts excluded, floored at zero. Without a live Brex connection: QuickBooks average monthly net loss over the last 3 complete months (accrual basis).",
};

export const CASH_BOOKS: MetricDefinition = {
  key: "cash_books",
  name: "Cash per books",
  category: "CASH",
  unit: "CURRENCY",
  description: "QuickBooks: sum of active bank account balances (USD) as currently booked. Differs from Brex cash on hand until the books are reconciled.",
};

export const REVENUE_MONTHLY: MetricDefinition = {
  key: "revenue_monthly",
  name: "Revenue (monthly)",
  category: "REVENUE",
  unit: "CURRENCY",
  description: "QuickBooks Profit and Loss (accrual): Total Income for the calendar month. Complete months only.",
};

export const REVENUE_TTM: MetricDefinition = {
  key: "revenue_ttm",
  name: "Revenue (trailing 12 months)",
  category: "REVENUE",
  unit: "CURRENCY",
  description: "QuickBooks Profit and Loss (accrual): sum of Total Income over the last 12 complete months, recorded at the latest complete month.",
};

export const REVENUE_RUN_RATE: MetricDefinition = {
  key: "revenue_run_rate",
  name: "Revenue run-rate (annualized)",
  category: "ARR",
  unit: "CURRENCY",
  description: "QuickBooks Profit and Loss (accrual): the month’s Total Income × 12, recorded for each complete month.",
};

export const OPEX_MONTHLY: MetricDefinition = {
  key: "opex_monthly",
  name: "Operating expenses (monthly)",
  category: "CASH",
  unit: "CURRENCY",
  direction: "LOWER_IS_BETTER",
  description: "QuickBooks Profit and Loss (accrual): Total Cost of Goods Sold + Total Expenses for the calendar month (other expenses excluded). Complete months only.",
};

export const NET_INCOME_MONTHLY: MetricDefinition = {
  key: "net_income_monthly",
  name: "Net income (monthly)",
  category: "REVENUE",
  unit: "CURRENCY",
  description: "QuickBooks Profit and Loss (accrual): Net Income for the calendar month (negative is a loss). Complete months only.",
};

export const CARD_SPEND_MONTHLY: MetricDefinition = {
  key: "card_spend_monthly",
  name: "Card spend (monthly)",
  category: "CASH",
  unit: "CURRENCY",
  direction: "LOWER_IS_BETTER",
  description:
    "Brex: settled card purchases minus refunds and chargebacks (USD) posted in the calendar month, across all cards when the token belongs to an account admin. Complete months only.",
};

// ─── Cash authority ──────────────────────────────────────────────────────────

export type CashAuthority = "BREX" | "QUICKBOOKS";

/** Brex owns cash while a live Brex connection is usable (not disconnected, not waiting for a new key). */
export async function cashAuthority(): Promise<CashAuthority> {
  const brex = await db.sourceConnection.findFirst({
    where: { provider: "BREX", mode: "LIVE", status: { notIn: ["DISCONNECTED", "NEEDS_REAUTH"] } },
    select: { id: true },
  });
  return brex ? "BREX" : "QUICKBOOKS";
}

const RUNWAY_SOURCE_KEY = "derived:cash.runway";

/**
 * The derived "Runway" metric (cash on hand ÷ net burn), created when missing.
 * Not ensureMetric(): that would attribute it to the calling connector.
 */
export async function ensureRunwayMetric(): Promise<void> {
  const existing = await db.metric.findUnique({ where: { key: "runway" }, select: { id: true } });
  if (existing) return;
  const order = await db.metric.count({ where: { category: "CASH" } });
  await db.metric.upsert({
    where: { key: "runway" },
    create: {
      key: "runway",
      name: "Runway",
      category: "CASH",
      unit: "MONTHS",
      direction: "HIGHER_IS_BETTER",
      description: DERIVED_METRICS[RUNWAY_SOURCE_KEY].description,
      sourceKey: RUNWAY_SOURCE_KEY,
      order,
    },
    update: {},
  });
}

// ─── Months ──────────────────────────────────────────────────────────────────

/** "YYYY-MM" of a date (UTC). */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/** First day (UTC) of a "YYYY-MM" month. */
export function monthStartOf(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1));
}

/** "2026-09" → "September". */
export function monthName(key: string): string {
  return monthStartOf(key).toLocaleString("en-US", { month: "long", timeZone: "UTC" });
}

/** "2026-09" → "September 2026". */
export function monthLabel(key: string): string {
  return monthStartOf(key).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
