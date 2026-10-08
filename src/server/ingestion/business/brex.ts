/**
 * Brex connector (user token with read-only scopes accounts.cash.readonly,
 * transactions.cash.readonly, transactions.card.readonly). Brex is the live
 * truth for cash; QuickBooks steps back to "Cash per books" while it is
 * connected (see finance-metrics.ts).
 *
 *   Cash on hand   current balances of all Brex cash accounts, every sync.
 *   Net burn       per complete calendar month, cash basis: money out minus
 *                  money in across the cash accounts, floored at zero.
 *                  Transfers between the company's own Brex accounts are
 *                  excluded (they move cash, they do not spend it).
 *   Card spend     settled purchases minus refunds per complete month. Needs
 *                  transactions.card.readonly (and an account admin to see
 *                  every card); without it the metric is skipped with a note.
 *   Signals        single cash movements at or above
 *                  settings.largePaymentThreshold (default $50,000), never on
 *                  the first sync.
 *
 * Amounts are integer minor units with a currency; only USD is summed. Brex
 * returns settled transactions only and may post late, so each run re-reads
 * from the start of the month its cursor (minus 3 days) falls in and
 * recomputes every complete month it covers from all of that month's
 * transactions.
 */
import { z } from "zod";
import { DAY_MS } from "@/lib/dates";
import { formatCurrency } from "@/lib/format";
import { ProviderHttpError, type RefreshableProviderContext, providerJson } from "../providers/http";
import { ProviderAuthError } from "../types";
import { CARD_SPEND_MONTHLY, CASH_ON_HAND, NET_BURN, ensureRunwayMetric, monthKey, monthLabel, monthStartOf } from "./finance-metrics";
import { type SignalInput, emitSignal, ensureMetric, isoDay, recordMetric, utcDay, utcMonthStart } from "./helpers";
import { type BusinessConnector, type ConnectorSyncContext, KeyRejectedError, type KeyVerification } from "./types";

// Brex's documented production host; the older platform.brexapis.com still answers too.
const DEFAULT_BASE = "https://api.brex.com";
const ALLOWED_BASES = new Set(["https://platform.brexapis.com", "https://api.brex.com"]);
/** Complete months read on the first sync (plus the current month). */
const HISTORY_MONTHS = 6;
/** Late postings: re-read this far behind the cursor (Brex recommends an overlapping lookback). */
const LOOKBACK_MS = 3 * DAY_MS;
const DEFAULT_LARGE_PAYMENT = 50_000;
const MAX_PAGES = 500;
/** Moves between the company's own Brex accounts. */
const INTERNAL_TYPES = new Set(["INTRA_CUSTOMER_ACCOUNT_BOOK_TRANSFER"]);
/** Transfers that are internal when the other side shows up on another listed account. */
const BOOK_TYPES = new Set(["BOOK_TRANSFER", "INTRA_CUSTOMER_ACCOUNT_BOOK_TRANSFER"]);

const CASH_SCOPES = ["accounts.cash.readonly", "transactions.cash.readonly"];
const CARD_SCOPE = "transactions.card.readonly";

/** `BREX_API_BASE` when it names one of Brex's API hosts, else the default. The token is only ever sent there. */
export function brexApiBase(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.BREX_API_BASE?.trim().replace(/\/+$/, "");
  return configured && ALLOWED_BASES.has(configured) ? configured : DEFAULT_BASE;
}

// ─── Response schemas (only the fields we read) ─────────────────────────────

const moneySchema = z.object({
  amount: z.union([z.number(), z.string().regex(/^-?\d+$/).transform(Number)]).transform((n) => Math.round(n)),
  currency: z.string().nullish(),
});
export type BrexMoney = z.infer<typeof moneySchema>;

export const cashAccountSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  primary: z.boolean().nullish(),
  current_balance: moneySchema.nullish(),
});
export type BrexCashAccount = z.infer<typeof cashAccountSchema>;

export const transactionSchema = z.object({
  id: z.string(),
  description: z.string().nullish(),
  amount: moneySchema.nullish(),
  /** ISO date (YYYY-MM-DD). */
  posted_at_date: z.string(),
  type: z.string().nullish(),
});
export type BrexTransaction = z.infer<typeof transactionSchema>;
/** A cash transaction with the account it posted to. */
export type BrexCashTransaction = BrexTransaction & { accountId: string };

function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), next_cursor: z.string().nullish() });
}

// ─── Money ───────────────────────────────────────────────────────────────────

/** Brex amounts are minor units: USD 7.00 is 700. */
export function centsToDollars(minor: number): number {
  return minor / 100;
}

function currencyOf(money: BrexMoney): string {
  return (money.currency ?? "USD").toUpperCase();
}

/** Minor units when the amount is USD, else null. */
function usdCents(money: BrexMoney | null | undefined): number | null {
  return money && currencyOf(money) === "USD" ? money.amount : null;
}

/** USD total of current balances; other currencies are listed, not converted. */
export function sumBalances(accounts: BrexCashAccount[]): { usd: number; counted: number; otherCurrencies: string[] } {
  let cents = 0;
  let counted = 0;
  const other = new Set<string>();
  for (const a of accounts) {
    if (!a.current_balance) continue;
    const c = usdCents(a.current_balance);
    if (c === null) other.add(currencyOf(a.current_balance));
    else {
      cents += c;
      counted++;
    }
  }
  return { usd: centsToDollars(cents), counted, otherCurrencies: [...other].sort() };
}

// ─── Aggregation ─────────────────────────────────────────────────────────────

/** "YYYY-MM" keys of the months starting at `from` and ending before `until`. */
export function monthsBetween(from: Date, until: Date): string[] {
  const keys: string[] = [];
  for (let d = utcMonthStart(from); d < until; d = utcMonthStart(d, 1)) keys.push(monthKey(d));
  return keys;
}

/**
 * Transfers between the company's own Brex accounts: intra-customer book
 * transfers, and book transfers whose opposite leg (same amount, currency and
 * day) posted to another listed account.
 */
export function internalTransferIds(txs: BrexCashTransaction[]): Set<string> {
  const internal = new Set<string>();
  const legs = new Map<string, BrexCashTransaction[]>();
  for (const tx of txs) {
    if (!tx.type || !tx.amount) continue;
    if (INTERNAL_TYPES.has(tx.type)) internal.add(tx.id);
    if (!BOOK_TYPES.has(tx.type)) continue;
    const key = `${currencyOf(tx.amount)}:${Math.abs(tx.amount.amount)}:${tx.posted_at_date.slice(0, 10)}`;
    legs.set(key, [...(legs.get(key) ?? []), tx]);
  }
  for (const group of legs.values()) {
    const unmatched = [...group];
    for (const out of group.filter((t) => t.amount!.amount < 0)) {
      const i = unmatched.findIndex((t) => t.amount!.amount === -out.amount!.amount && t.accountId !== out.accountId);
      if (i < 0) continue;
      internal.add(out.id).add(unmatched[i].id);
      unmatched.splice(i, 1);
    }
  }
  return internal;
}

export interface MonthCashFlow {
  month: string;
  moneyIn: number;
  moneyOut: number;
  /** max(0, money out − money in). */
  netBurn: number;
}

/**
 * Cash in and out per month across all cash accounts (USD only). A negative
 * amount is money leaving the account. Every listed month gets a row, so a
 * month without movements records zero burn.
 */
export function cashFlowsByMonth(txs: BrexCashTransaction[], months: string[], internal: Set<string> = internalTransferIds(txs)): MonthCashFlow[] {
  const sums = new Map(months.map((m) => [m, { in: 0, out: 0 }]));
  for (const tx of txs) {
    const cents = usdCents(tx.amount);
    const row = sums.get(tx.posted_at_date.slice(0, 7));
    if (cents === null || !row || internal.has(tx.id)) continue;
    if (cents > 0) row.in += cents;
    else row.out -= cents;
  }
  return months.map((month) => {
    const s = sums.get(month)!;
    return { month, moneyIn: centsToDollars(s.in), moneyOut: centsToDollars(s.out), netBurn: centsToDollars(Math.max(0, s.out - s.in)) };
  });
}

/**
 * Card spend per month (USD): purchases minus refunds and chargebacks.
 * Collections (card bill payments), rewards credits and fees are not spend.
 * Brex signs purchases positive; types decide the direction when present.
 */
export function cardSpendByMonth(txs: BrexTransaction[], months: string[]): { month: string; spend: number }[] {
  const sums = new Map(months.map((m) => [m, 0]));
  for (const tx of txs) {
    const cents = usdCents(tx.amount);
    const month = tx.posted_at_date.slice(0, 7);
    if (cents === null || !sums.has(month)) continue;
    let delta = 0;
    if (tx.type === "PURCHASE") delta = Math.abs(cents);
    else if (tx.type === "REFUND" || tx.type === "CHARGEBACK") delta = -Math.abs(cents);
    else if (!tx.type) delta = cents;
    sums.set(month, sums.get(month)! + delta);
  }
  return months.map((month) => ({ month, spend: centsToDollars(sums.get(month)!) }));
}

/** settings.largePaymentThreshold in USD (number or numeric string), else $50,000. */
export function largePaymentThreshold(settings: Record<string, unknown>): number {
  const raw = settings.largePaymentThreshold;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[$,\s]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LARGE_PAYMENT;
}

/** USD cash movements at or above the threshold, internal transfers excluded. */
export function largeMovements(txs: BrexCashTransaction[], threshold: number, internal: Set<string>): BrexCashTransaction[] {
  return txs.filter((tx) => {
    const cents = usdCents(tx.amount);
    return cents !== null && cents !== 0 && Math.abs(centsToDollars(cents)) >= threshold && !internal.has(tx.id);
  });
}

function cleanDescription(text: string | null | undefined): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "no description";
  return t.length > 120 ? `${t.slice(0, 119)}…` : t;
}

/** "Large payment: $82,000 — Lonza invoice 4471" / "Payment received: $250,000 — Aurelius Pharma". */
export function paymentSignal(tx: BrexCashTransaction, accountName: string | null): SignalInput {
  const dollars = centsToDollars(tx.amount!.amount);
  const out = dollars < 0;
  const amount = formatCurrency(Math.abs(dollars), false);
  const description = cleanDescription(tx.description);
  const day = tx.posted_at_date.slice(0, 10);
  const summary = `${out ? "Paid" : "Received"} ${amount} ${out ? "from" : "into"} ${accountName ?? "Brex"} (posted ${day}): ${description}.`;
  return {
    externalId: `brex:tx:${tx.id}`,
    kind: "METRIC_UPDATE",
    title: `${out ? "Large payment" : "Payment received"}: ${amount} — ${description}`,
    body: summary,
    occurredAt: new Date(`${day}T00:00:00Z`),
    metadata: { signalType: "development", importance: 3, summary },
  };
}

// ─── API ─────────────────────────────────────────────────────────────────────

/** Follow `next_cursor` until Brex says the list ended. */
async function listAll<T extends z.ZodType>(http: RefreshableProviderContext, url: string, item: T, query: Record<string, string | number> = {}): Promise<z.infer<T>[]> {
  const schema = pageSchema(item);
  const out: z.infer<T>[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: z.infer<typeof schema> = await providerJson(http, url, schema, { query: { ...query, cursor } });
    out.push(...res.items);
    if (!res.next_cursor || res.next_cursor === cursor) return out;
    cursor = res.next_cursor;
  }
  throw new Error(`Brex kept paging past ${MAX_PAGES} pages (${new URL(url).pathname})`);
}

export function listCashAccounts(http: RefreshableProviderContext, base = brexApiBase()): Promise<BrexCashAccount[]> {
  return listAll(http, `${base}/v2/accounts/cash`, cashAccountSchema);
}

/** Settled cash transactions of one account posted on or after `since` (filtered here too, should the API ignore the parameter). */
export async function listCashTransactions(http: RefreshableProviderContext, accountId: string, since: Date, base = brexApiBase()): Promise<BrexCashTransaction[]> {
  const items = await listAll(http, `${base}/v2/transactions/cash/${encodeURIComponent(accountId)}`, transactionSchema, { posted_at_start: since.toISOString(), limit: 100 });
  const from = isoDay(since);
  return items.filter((t) => t.posted_at_date.slice(0, 10) >= from).map((t) => ({ ...t, accountId }));
}

/**
 * Settled card transactions posted on or after `since`, or null when the
 * token may not read them (no transactions.card.readonly, or not an admin).
 * Only called after the token has proven valid on the cash endpoints.
 */
export async function listCardTransactions(http: RefreshableProviderContext, since: Date, base = brexApiBase()): Promise<BrexTransaction[] | null> {
  try {
    const items = await listAll(http, `${base}/v2/transactions/card/primary`, transactionSchema, { posted_at_start: since.toISOString(), limit: 100 });
    const from = isoDay(since);
    return items.filter((t) => t.posted_at_date.slice(0, 10) >= from);
  } catch (error) {
    if ((error instanceof ProviderHttpError && error.status === 403) || error instanceof ProviderAuthError) return null;
    throw error;
  }
}

/** A 403 on a cash endpoint means the token expired or lost a scope: only a new key fixes that. */
async function requireAccess<T>(scope: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ProviderHttpError && error.status === 403) {
      throw new ProviderAuthError(`Brex refused access (403): the token expired or lacks ${scope}. Create a new read-only user token in Brex → Developer and replace the key in Settings → Integrations.`);
    }
    throw error;
  }
}

// ─── Key check ───────────────────────────────────────────────────────────────

const NEW_TOKEN_HINT = `Create a new user token in Brex → Developer, signed in as an account admin, with read-only access: ${[...CASH_SCOPES, CARD_SCOPE].join(", ")}.`;

function keyContext(key: string): RefreshableProviderContext {
  // No forceRefreshToken: a user token cannot be refreshed, so a 401 is final.
  return {
    connection: { id: "brex-key-check", provider: "BREX", mode: "LIVE", accountEmail: null, settings: {} },
    now: new Date(),
    log: () => {},
    getAccessToken: async () => key,
  };
}

function keyRejection(error: unknown, scope: string): unknown {
  if (error instanceof ProviderAuthError) {
    return new KeyRejectedError(`Brex rejected the token. ${NEW_TOKEN_HINT} Tokens unused for 90 days expire; Brex business accounts must be enabled for the user.`);
  }
  if (error instanceof ProviderHttpError && error.status === 403) {
    return new KeyRejectedError(`This Brex token can’t read ${scope === CASH_SCOPES[0] ? "business account balances" : "cash transactions"} (${scope}), or it has expired. ${NEW_TOKEN_HINT}`);
  }
  if (error instanceof ProviderHttpError) {
    return new KeyRejectedError(`Brex couldn’t check the token right now (${error.status || "network error"}). Try again in a minute.`);
  }
  return error;
}

async function verifyBrexKey(key: string): Promise<KeyVerification> {
  const base = brexApiBase();
  const http = keyContext(key);
  let accounts: BrexCashAccount[];
  try {
    accounts = await listCashAccounts(http, base);
  } catch (error) {
    throw keyRejection(error, CASH_SCOPES[0]);
  }
  const primary = accounts.find((a) => a.primary) ?? accounts[0];
  if (!primary) throw new KeyRejectedError(`Brex returned no business accounts for this token. ${NEW_TOKEN_HINT}`);

  // One page of each transaction list confirms the remaining scopes.
  const probe = { posted_at_start: utcMonthStart(new Date()).toISOString(), limit: 1 };
  try {
    await providerJson(http, `${base}/v2/transactions/cash/${encodeURIComponent(primary.id)}`, pageSchema(transactionSchema), { query: probe });
  } catch (error) {
    throw keyRejection(error, CASH_SCOPES[1]);
  }
  const scopes = [...CASH_SCOPES];
  try {
    await providerJson(http, `${base}/v2/transactions/card/primary`, pageSchema(transactionSchema), { query: probe });
    scopes.push(CARD_SCOPE);
  } catch (error) {
    // Card spend is optional: the connection works without it (see sync notes).
    if (!(error instanceof ProviderAuthError) && !(error instanceof ProviderHttpError && error.status === 403)) throw keyRejection(error, CARD_SCOPE);
  }
  return { accountName: primary.name?.trim() || "Brex cash", externalAccountId: primary.id, scopes };
}

// ─── Sync ────────────────────────────────────────────────────────────────────

const cursorSchema = z.object({ postedSince: z.string().optional(), largeSeen: z.array(z.string()).optional() });

async function syncBrex(ctx: ConnectorSyncContext): Promise<void> {
  const base = brexApiBase();
  const tally = (outcome: "created" | "updated" | "unchanged") => ctx.count(outcome);
  const today = utcDay(ctx.now);
  const currentMonth = utcMonthStart(ctx.now);

  // Balances.
  const accounts = await requireAccess(CASH_SCOPES[0], () => listCashAccounts(ctx.http, base));
  ctx.count("fetched", accounts.length);
  const balances = sumBalances(accounts);
  if (balances.otherCurrencies.length) ctx.note(`Balances in ${balances.otherCurrencies.join(", ")} are not included in cash on hand (USD only).`);
  if (balances.counted > 0) {
    const cashId = await ensureMetric(ctx, CASH_ON_HAND);
    tally(await recordMetric(ctx, { metricId: cashId, day: today, value: balances.usd, note: "Brex cash accounts (live)" }));
  } else {
    ctx.note("No USD Brex cash account found; cash on hand was not updated.");
  }
  await ensureRunwayMetric();

  // Window: 6 complete months on the first sync; afterwards from the start of the month the cursor (minus 3 days) falls in.
  const parsed = cursorSchema.safeParse(ctx.cursor ?? {});
  const cursor = parsed.success ? parsed.data : {};
  const since = cursor.postedSince ? new Date(cursor.postedSince) : null;
  const resumeFrom = since && !Number.isNaN(since.getTime()) ? new Date(since.getTime() - LOOKBACK_MS) : null;
  const earliest = utcMonthStart(ctx.now, -HISTORY_MONTHS);
  const from = !ctx.initial && resumeFrom && utcMonthStart(resumeFrom) > earliest ? utcMonthStart(resumeFrom) : earliest;
  const months = monthsBetween(from, currentMonth);

  // Cash movements → monthly net burn.
  const txs: BrexCashTransaction[] = [];
  for (const account of accounts) txs.push(...(await requireAccess(CASH_SCOPES[1], () => listCashTransactions(ctx.http, account.id, from, base))));
  ctx.count("fetched", txs.length);
  const foreign = txs.filter((t) => t.amount && usdCents(t.amount) === null).length;
  if (foreign) ctx.note(`${foreign} non-USD cash transaction(s) left out of burn (USD only).`);
  const internal = internalTransferIds(txs);
  const burnId = await ensureMetric(ctx, NET_BURN);
  for (const flow of cashFlowsByMonth(txs, months, internal)) {
    tally(await recordMetric(ctx, { metricId: burnId, day: monthStartOf(flow.month), value: flow.netBurn, note: "Cash basis: money out minus money in across Brex cash accounts" }));
  }

  // Card spend (optional scope).
  const cards = await listCardTransactions(ctx.http, from, base);
  if (cards === null) {
    ctx.note(`Card spend skipped: it needs a token from an account admin with ${CARD_SCOPE}.`);
  } else {
    ctx.count("fetched", cards.length);
    const spendId = await ensureMetric(ctx, CARD_SPEND_MONTHLY);
    for (const s of cardSpendByMonth(cards, months)) {
      tally(await recordMetric(ctx, { metricId: spendId, day: monthStartOf(s.month), value: s.spend, note: "Brex card purchases minus refunds (settled)" }));
    }
  }

  // Large single movements since the last run. The first sync stays quiet, and
  // movements it already saw inside the lookback window are not signalled later.
  const large = largeMovements(txs, largePaymentThreshold(ctx.connection.settings), internal);
  const seen = new Set(cursor.largeSeen ?? []);
  if (!ctx.initial && resumeFrom) {
    const names = new Map(accounts.map((a) => [a.id, a.name ?? null]));
    const signalFrom = isoDay(resumeFrom);
    for (const tx of large) {
      if (tx.posted_at_date.slice(0, 10) < signalFrom || seen.has(tx.id)) continue;
      if ((await emitSignal(ctx, paymentSignal(tx, names.get(tx.accountId) ?? null))) === "created") ctx.count("created");
    }
  }
  const seenFrom = isoDay(new Date(ctx.now.getTime() - LOOKBACK_MS));
  const largeSeen = large.filter((t) => t.posted_at_date.slice(0, 10) >= seenFrom).map((t) => t.id).slice(-200);
  await ctx.saveCursor({ postedSince: ctx.now.toISOString(), largeSeen });

  ctx.note(
    `Cash on hand from ${balances.counted} Brex account(s); ` +
      (months.length ? `burn${cards ? " and card spend" : ""} recomputed for ${monthLabel(months[0])}${months.length > 1 ? ` – ${monthLabel(months.at(-1)!)}` : ""}.` : "no complete month to recompute yet."),
  );
}

export const brexConnector: BusinessConnector = {
  provider: "BREX",
  sync: syncBrex,
  verifyKey: verifyBrexKey,
};
