import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fakeContext, json, routes, stubFetch } from "../providers/test-helpers";
import {
  type BrexCashTransaction,
  type BrexTransaction,
  brexApiBase,
  brexConnector,
  cardSpendByMonth,
  cashFlowsByMonth,
  centsToDollars,
  internalTransferIds,
  largeMovements,
  largePaymentThreshold,
  listCardTransactions,
  listCashAccounts,
  listCashTransactions,
  monthsBetween,
  paymentSignal,
  sumBalances,
} from "./brex";
import { KeyRejectedError } from "./types";

const usd = (amount: number) => ({ amount, currency: "USD" });
const cash = (id: string, accountId: string, posted: string, amount: number, extra: Partial<BrexCashTransaction> = {}): BrexCashTransaction => ({
  id,
  accountId,
  description: `tx ${id}`,
  amount: usd(amount),
  posted_at_date: posted,
  type: "PAYMENT",
  ...extra,
});

/** GET /v2/accounts/cash in the documented shape (Page_CashAccount_). */
const ACCOUNTS = {
  next_cursor: null,
  items: [
    {
      id: "dpacc_cl8p2z9r00001",
      name: "Brex Business",
      status: "ACTIVE",
      current_balance: usd(1823456789),
      available_balance: usd(1823000000),
      account_number: "000123456789",
      routing_number: "121145433",
      primary: true,
    },
  ],
};

describe("brexApiBase", () => {
  it("uses Brex's API hosts only", () => {
    const base = (value?: string) => brexApiBase((value === undefined ? {} : { BREX_API_BASE: value }) as unknown as NodeJS.ProcessEnv);
    assert.equal(base(), "https://api.brex.com");
    assert.equal(base("https://api.brex.com/"), "https://api.brex.com");
    assert.equal(base("https://platform.brexapis.com"), "https://platform.brexapis.com");
    assert.equal(base("https://evil.example"), "https://api.brex.com");
    assert.equal(base("http://platform.brexapis.com"), "https://api.brex.com");
  });
});

describe("money", () => {
  it("converts minor units to dollars", () => {
    assert.equal(centsToDollars(700), 7);
    assert.equal(centsToDollars(-8200000), -82000);
    assert.equal(centsToDollars(1), 0.01);
  });

  it("sums USD balances only and lists other currencies", () => {
    const result = sumBalances([
      { id: "a", current_balance: usd(1823456789) },
      { id: "b", current_balance: { amount: 50000000, currency: null } },
      { id: "c", current_balance: { amount: 900000, currency: "EUR" } },
      { id: "d", current_balance: null },
    ]);
    assert.deepEqual(result, { usd: 18734567.89, counted: 2, otherCurrencies: ["EUR"] });
  });
});

describe("monthsBetween", () => {
  it("lists whole months up to (not including) the end month", () => {
    assert.deepEqual(monthsBetween(new Date("2026-04-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z")), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    assert.deepEqual(monthsBetween(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z")), []);
    assert.deepEqual(monthsBetween(new Date("2025-12-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z")), ["2025-12", "2026-01"]);
  });
});

describe("internalTransferIds", () => {
  it("pairs book transfers across the company's accounts and always excludes intra-customer moves", () => {
    const txs = [
      cash("out", "acc_ops", "2026-09-10", -100000000, { type: "BOOK_TRANSFER" }),
      cash("in", "acc_treasury", "2026-09-10", 100000000, { type: "BOOK_TRANSFER" }),
      cash("vendor", "acc_ops", "2026-09-11", -2500000, { type: "BOOK_TRANSFER" }), // paid another Brex customer
      cash("sweep", "acc_ops", "2026-09-12", -500000, { type: "INTRA_CUSTOMER_ACCOUNT_BOOK_TRANSFER" }),
      cash("same-account", "acc_ops", "2026-09-13", 700000, { type: "BOOK_TRANSFER" }),
      cash("same-account-out", "acc_ops", "2026-09-13", -700000, { type: "BOOK_TRANSFER" }),
    ];
    assert.deepEqual([...internalTransferIds(txs)].sort(), ["in", "out", "sweep"]);
  });
});

describe("cashFlowsByMonth", () => {
  const months = ["2026-08", "2026-09"];
  const txs = [
    cash("payroll", "acc_ops", "2026-08-15", -95000000),
    cash("lonza", "acc_ops", "2026-08-20", -8200000),
    cash("customer", "acc_ops", "2026-08-25", 2500000),
    cash("eur", "acc_ops", "2026-08-26", -1000000, { amount: { amount: -1000000, currency: "EUR" } }),
    cash("no-amount", "acc_ops", "2026-08-27", 0, { amount: null }),
    cash("series-b", "acc_ops", "2026-09-02", 4000000000),
    cash("sep-payroll", "acc_ops", "2026-09-15", -96000000),
    cash("to-treasury", "acc_ops", "2026-09-20", -300000000, { type: "BOOK_TRANSFER" }),
    cash("from-ops", "acc_treasury", "2026-09-20", 300000000, { type: "BOOK_TRANSFER" }),
    cash("october", "acc_ops", "2026-10-02", -5000000),
  ];

  it("nets money out against money in per complete month (USD, internal transfers excluded)", () => {
    const flows = cashFlowsByMonth(txs, months);
    assert.deepEqual(flows[0], { month: "2026-08", moneyIn: 25000, moneyOut: 1032000, netBurn: 1007000 });
    assert.deepEqual(flows[1], { month: "2026-09", moneyIn: 40000000, moneyOut: 960000, netBurn: 0 }, "a funding month floors burn at zero");
  });

  it("gives every month a row and ignores months outside the window", () => {
    const flows = cashFlowsByMonth([cash("october", "acc_ops", "2026-10-02", -5000000)], ["2026-07", "2026-08"]);
    assert.deepEqual(
      flows.map((f) => [f.month, f.netBurn]),
      [
        ["2026-07", 0],
        ["2026-08", 0],
      ],
    );
  });
});

describe("cardSpendByMonth", () => {
  it("counts purchases minus refunds and chargebacks, in USD", () => {
    const card = (id: string, posted: string, amount: number, type: string | null, currency = "USD"): BrexTransaction => ({ id, description: id, amount: { amount, currency }, posted_at_date: posted, type });
    const spend = cardSpendByMonth(
      [
        card("chilis", "2026-09-18", 12900, "PURCHASE"),
        card("aws", "2026-09-03", 4210000, "PURCHASE"),
        card("refund", "2026-09-20", -2000, "REFUND"),
        card("chargeback", "2026-09-21", -500, "CHARGEBACK"),
        card("payment", "2026-09-19", -63600, "COLLECTION"),
        card("rewards", "2026-09-22", -1000, "REWARDS_CREDIT"),
        card("bnpl", "2026-09-22", 150, "BNPL_FEE"),
        card("untyped", "2026-09-23", 300, null),
        card("paris", "2026-09-24", 99900, "PURCHASE", "EUR"),
        card("october", "2026-10-01", 50000, "PURCHASE"),
      ],
      ["2026-08", "2026-09"],
    );
    assert.deepEqual(spend, [
      { month: "2026-08", spend: 0 },
      { month: "2026-09", spend: (12900 + 4210000 - 2000 - 500 + 300) / 100 },
    ]);
  });
});

describe("large payments", () => {
  it("reads the threshold from settings", () => {
    assert.equal(largePaymentThreshold({}), 50000);
    assert.equal(largePaymentThreshold({ largePaymentThreshold: 25000 }), 25000);
    assert.equal(largePaymentThreshold({ largePaymentThreshold: "$100,000" }), 100000);
    assert.equal(largePaymentThreshold({ largePaymentThreshold: -5 }), 50000);
    assert.equal(largePaymentThreshold({ largePaymentThreshold: "lots" }), 50000);
  });

  it("selects USD movements at or above the threshold, skipping internal transfers", () => {
    const txs = [
      cash("lonza", "acc_ops", "2026-10-06", -8200000, { description: "Lonza Biologics  invoice 4471" }),
      cash("aurelius", "acc_ops", "2026-10-07", 25000000, { description: "AURELIUS PHARMA ACH" }),
      cash("exact", "acc_ops", "2026-10-07", -5000000),
      cash("small", "acc_ops", "2026-10-07", -4999999),
      cash("eur", "acc_ops", "2026-10-07", -90000000, { amount: { amount: -90000000, currency: "EUR" } }),
      cash("sweep", "acc_ops", "2026-10-07", -90000000, { type: "INTRA_CUSTOMER_ACCOUNT_BOOK_TRANSFER" }),
    ];
    const large = largeMovements(txs, 50000, internalTransferIds(txs));
    assert.deepEqual(
      large.map((t) => t.id),
      ["lonza", "aurelius", "exact"],
    );

    const out = paymentSignal(large[0], "Brex Business");
    assert.equal(out.title, "Large payment: $82,000 — Lonza Biologics invoice 4471");
    assert.equal(out.externalId, "brex:tx:lonza");
    assert.equal(out.kind, "METRIC_UPDATE");
    assert.deepEqual({ signalType: out.metadata?.signalType, importance: out.metadata?.importance }, { signalType: "development", importance: 3 });
    assert.equal(out.occurredAt.toISOString(), "2026-10-06T00:00:00.000Z");
    assert.match(out.metadata?.summary ?? "", /^Paid \$82,000 from Brex Business/);

    const received = paymentSignal(large[1], null);
    assert.equal(received.title, "Payment received: $250,000 — AURELIUS PHARMA ACH");
    assert.match(received.metadata?.summary ?? "", /^Received \$250,000 into Brex/);
  });
});

describe("Brex API calls", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());
  const base = "https://api.brex.com";

  it("follows next_cursor through every page of cash accounts", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/v2\/accounts\/cash$/,
          (req) =>
            req.url.searchParams.get("cursor") === "eyJvZmZzZXQiOjF9"
              ? json({ next_cursor: null, items: [{ id: "dpacc_2", name: "Treasury", primary: false, current_balance: usd(500000000) }] })
              : json({ ...ACCOUNTS, next_cursor: "eyJvZmZzZXQiOjF9" }),
        ],
      ]),
    );
    restore = stub.restore;
    const accounts = await listCashAccounts(fakeContext({ provider: "BREX" }), base);
    assert.deepEqual(
      accounts.map((a) => a.id),
      ["dpacc_cl8p2z9r00001", "dpacc_2"],
    );
    assert.equal(stub.requests.length, 2);
    assert.equal(stub.requests[0].url.searchParams.has("cursor"), false);
    assert.equal(sumBalances(accounts).usd, 23234567.89);
  });

  it("pages cash transactions from posted_at_start, 100 at a time, and tags the account", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/v2\/transactions\/cash\/dpacc_cl8p2z9r00001$/,
          (req) =>
            req.url.searchParams.get("cursor")
              ? json({ next_cursor: null, items: [{ id: "ctx_3", description: "Lonza", amount: usd(-8200000), initiated_at_date: "2026-09-29", posted_at_date: "2026-09-30", type: "PAYMENT" }] })
              : json({
                  next_cursor: "c2",
                  items: [
                    { id: "ctx_1", description: "Old", amount: usd(-100), initiated_at_date: "2026-03-30", posted_at_date: "2026-03-31", type: "PAYMENT" },
                    { id: "ctx_2", description: "Aurelius", amount: usd(25000000), initiated_at_date: "2026-04-01", posted_at_date: "2026-04-02", type: "PAYMENT", transfer_id: null },
                  ],
                }),
        ],
      ]),
    );
    restore = stub.restore;
    const txs = await listCashTransactions(fakeContext({ provider: "BREX" }), "dpacc_cl8p2z9r00001", new Date("2026-04-01T00:00:00Z"), base);
    assert.deepEqual(
      txs.map((t) => [t.id, t.accountId]),
      [
        ["ctx_2", "dpacc_cl8p2z9r00001"],
        ["ctx_3", "dpacc_cl8p2z9r00001"],
      ],
      "postings before the window are dropped even if the API returns them",
    );
    const first = stub.requests[0].url.searchParams;
    assert.equal(first.get("posted_at_start"), "2026-04-01T00:00:00.000Z");
    assert.equal(first.get("limit"), "100");
    assert.equal(stub.requests[1].url.searchParams.get("cursor"), "c2");
    assert.equal(stub.requests[1].url.searchParams.get("posted_at_start"), "2026-04-01T00:00:00.000Z");
  });

  it("reads card transactions, and returns null when the token may not (403 or 401)", async () => {
    restore = stubFetch(
      routes([
        [
          "GET",
          /\/v2\/transactions\/card\/primary$/,
          () =>
            json({
              next_cursor: null,
              items: [
                { id: "pste_1", description: "Payment – Thank you!", amount: usd(-63600), posted_at_date: "2026-09-19", type: "COLLECTION" },
                { id: "pste_2", card_id: "ncard_1", description: "Chili's", amount: usd(12900), posted_at_date: "2026-09-18", type: "PURCHASE" },
              ],
            }),
        ],
      ]),
    ).restore;
    const cards = await listCardTransactions(fakeContext({ provider: "BREX" }), new Date("2026-09-01T00:00:00Z"), base);
    assert.equal(cards?.length, 2);
    assert.deepEqual(cardSpendByMonth(cards!, ["2026-09"]), [{ month: "2026-09", spend: 129 }]);
    restore();

    restore = stubFetch(routes([["GET", /\/v2\/transactions\/card\/primary$/, () => json({ type: "FORBIDDEN", message: "Missing scope" }, { status: 403 })]])).restore;
    assert.equal(await listCardTransactions(fakeContext({ provider: "BREX" }), new Date("2026-09-01T00:00:00Z"), base), null);
    restore();

    restore = stubFetch(routes([["GET", /\/v2\/transactions\/card\/primary$/, () => json({ type: "UNAUTHORIZED" }, { status: 401 })]])).restore;
    assert.equal(await listCardTransactions(fakeContext({ provider: "BREX" }), new Date("2026-09-01T00:00:00Z"), base), null);
  });

  it("fails loudly on a malformed page instead of summing partial data", async () => {
    restore = stubFetch(routes([["GET", /\/v2\/accounts\/cash$/, () => json({ items: [{ name: "no id" }] })]])).restore;
    await assert.rejects(() => listCashAccounts(fakeContext({ provider: "BREX" }), base), /unexpected shape/);
  });
});

describe("brexConnector.verifyKey", () => {
  let restore: () => void = () => {};
  let savedBase: string | undefined;
  beforeEach(() => {
    savedBase = process.env.BREX_API_BASE;
    delete process.env.BREX_API_BASE;
  });
  afterEach(() => {
    restore();
    if (savedBase === undefined) delete process.env.BREX_API_BASE;
    else process.env.BREX_API_BASE = savedBase;
  });
  const KEY = "bxt_jBWQLZXtu1f4sVT6UjaWPp7Gh9nVGjzEZgRX";
  const page = (items: unknown[] = []) => json({ next_cursor: null, items });

  it("returns the primary account and the scopes it confirmed, never the key", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /\/v2\/accounts\/cash$/, () => json({ next_cursor: null, items: [{ ...ACCOUNTS.items[0], primary: false, id: "dpacc_other", name: "Vault" }, ACCOUNTS.items[0]] })],
        ["GET", /\/v2\/transactions\/cash\/dpacc_cl8p2z9r00001$/, () => page()],
        ["GET", /\/v2\/transactions\/card\/primary$/, () => page()],
      ]),
    );
    restore = stub.restore;
    const result = await brexConnector.verifyKey!(KEY);
    assert.deepEqual(result, {
      accountName: "Brex Business",
      externalAccountId: "dpacc_cl8p2z9r00001",
      scopes: ["accounts.cash.readonly", "transactions.cash.readonly", "transactions.card.readonly"],
    });
    assert.ok(!JSON.stringify(result).includes(KEY));
    assert.ok(stub.requests.every((r) => r.headers.get("authorization") === `Bearer ${KEY}` && r.url.host === "api.brex.com"));
    assert.equal(stub.requests[1].url.searchParams.get("limit"), "1");
  });

  it("connects without card access and leaves that scope out", async () => {
    restore = stubFetch(
      routes([
        ["GET", /\/v2\/accounts\/cash$/, () => json({ next_cursor: null, items: [{ id: "dpacc_1", name: "  ", primary: true, current_balance: usd(100) }] })],
        ["GET", /\/v2\/transactions\/cash\//, () => page()],
        ["GET", /\/v2\/transactions\/card\/primary$/, () => json({ type: "FORBIDDEN" }, { status: 403 })],
      ]),
    ).restore;
    const result = await brexConnector.verifyKey!(KEY);
    assert.deepEqual(result.scopes, ["accounts.cash.readonly", "transactions.cash.readonly"]);
    assert.equal(result.accountName, "Brex cash");
  });

  it("turns 401 into an actionable KeyRejectedError without echoing the key", async () => {
    const stub = stubFetch(routes([["GET", /\/v2\/accounts\/cash$/, () => json({ type: "UNAUTHORIZED", message: "PERMISSION_DENIED: Invalid or Revoked Token" }, { status: 401 })]]));
    restore = stub.restore;
    await assert.rejects(
      () => brexConnector.verifyKey!(KEY),
      (e) => e instanceof KeyRejectedError && /^Brex rejected the token\. Create a new user token in Brex → Developer/.test(e.message) && /read-only/.test(e.message) && !e.message.includes(KEY),
    );
    assert.equal(stub.requests.length, 1, "a user token cannot be refreshed: no retry");
  });

  it("names the missing read-only scope on 403", async () => {
    restore = stubFetch(routes([["GET", /\/v2\/accounts\/cash$/, () => json({ type: "FORBIDDEN", message: "Expired token" }, { status: 403 })]])).restore;
    await assert.rejects(() => brexConnector.verifyKey!(KEY), (e) => e instanceof KeyRejectedError && /accounts\.cash\.readonly/.test(e.message));
    restore();

    restore = stubFetch(
      routes([
        ["GET", /\/v2\/accounts\/cash$/, () => json(ACCOUNTS)],
        ["GET", /\/v2\/transactions\/cash\//, () => json({ type: "FORBIDDEN" }, { status: 403 })],
      ]),
    ).restore;
    await assert.rejects(() => brexConnector.verifyKey!(KEY), (e) => e instanceof KeyRejectedError && /cash transactions \(transactions\.cash\.readonly\)/.test(e.message));
  });

  it("rejects a token that sees no business account", async () => {
    restore = stubFetch(routes([["GET", /\/v2\/accounts\/cash$/, () => page()]])).restore;
    await assert.rejects(() => brexConnector.verifyKey!(KEY), (e) => e instanceof KeyRejectedError && /no business accounts/.test(e.message));
  });

  it("only sends the key to Brex's own hosts", async () => {
    process.env.BREX_API_BASE = "https://collector.example";
    const stub = stubFetch(
      routes([
        ["GET", /\/v2\/accounts\/cash$/, () => json(ACCOUNTS)],
        ["GET", /\/v2\/transactions\//, () => page()],
      ]),
    );
    restore = stub.restore;
    await brexConnector.verifyKey!(KEY);
    assert.ok(stub.requests.every((r) => r.url.host === "api.brex.com"));
  });
});
