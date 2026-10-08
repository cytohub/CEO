import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fakeContext, json, routes, stubFetch } from "../providers/test-helpers";
import { ProviderAuthError } from "../types";
import {
  type PnlMonth,
  type ProfitAndLossReport,
  accrualNetBurn,
  booksSignal,
  completeMonths,
  fetchBankAccounts,
  fetchProfitAndLoss,
  parseAmount,
  parseProfitAndLoss,
  realmIdOf,
  sumBankBalances,
  trailingRevenue,
} from "./quickbooks";

/** Report cells: label first, then one string per column (the shape Intuit returns). */
const cells = (label: string, ...values: string[]) => [{ value: label }, ...values.map((value) => ({ value }))];
const data = (label: string, id: string, ...values: string[]) => ({ ColData: [{ value: label, id }, ...values.map((value) => ({ value }))], type: "Data" });
const month = (title: string, start: string, end: string) => ({
  ColTitle: title,
  ColType: "Money",
  MetaData: [
    { Name: "StartDate", Value: start },
    { Name: "EndDate", Value: end },
    { Name: "ColKey", Value: title },
  ],
});

/**
 * ProfitAndLoss?start_date=2026-06-01&end_date=2026-09-15&summarize_column_by=Month&accounting_method=Accrual,
 * in the documented response shape: sections by `group`, sub-account sections without a group,
 * summary-only sections, empty strings for no activity, a Total column, and a partial current month.
 */
const PNL_JUN_SEP: ProfitAndLossReport = {
  Header: {
    Time: "2026-09-15T07:00:00-07:00",
    ReportName: "ProfitAndLoss",
    ReportBasis: "Accrual",
    StartPeriod: "2026-06-01",
    EndPeriod: "2026-09-15",
    SummarizeColumnsBy: "Month",
    Currency: "USD",
    Option: [
      { Name: "AccountingStandard", Value: "GAAP" },
      { Name: "NoReportData", Value: "false" },
    ],
  },
  Columns: {
    Column: [
      { ColTitle: "", ColType: "Account", MetaData: [{ Name: "ColKey", Value: "account" }] },
      month("Jun 2026", "2026-06-01", "2026-06-30"),
      month("Jul 2026", "2026-07-01", "2026-07-31"),
      month("Aug 2026", "2026-08-01", "2026-08-31"),
      month("Sep 1-15, 2026", "2026-09-01", "2026-09-15"),
      { ColTitle: "Total", ColType: "Money", MetaData: [{ Name: "ColKey", Value: "total" }] },
    ],
  },
  Rows: {
    Row: [
      {
        Header: { ColData: cells("Income", "", "", "", "", "") },
        Rows: {
          Row: [
            data("Assay services", "81", "310000.00", "352000.00", "381000.00", "120000.00", "1163000.00"),
            {
              Header: { ColData: [{ value: "Platform licenses", id: "84" }, { value: "" }, { value: "" }, { value: "" }, { value: "" }, { value: "" }] },
              Rows: {
                Row: [
                  data("Annual", "85", "", "", "20000.00", "", "20000.00"),
                  data("Pilot", "86", "12000.00", "", "", "", "12000.00"),
                ],
              },
              Summary: { ColData: cells("Total Platform licenses", "12000.00", "", "20000.00", "", "32000.00") },
              type: "Section",
            },
          ],
        },
        Summary: { ColData: cells("Total Income", "322000.00", "352000.00", "401000.00", "120000.00", "1195000.00") },
        type: "Section",
        group: "Income",
      },
      {
        Header: { ColData: cells("Cost of Goods Sold", "", "", "", "", "") },
        Rows: { Row: [data("Lab consumables", "90", "61000.00", "64000.00", "70500.00", "18000.00", "213500.00")] },
        Summary: { ColData: cells("Total Cost of Goods Sold", "61000.00", "64000.00", "70500.00", "18000.00", "213500.00") },
        type: "Section",
        group: "COGS",
      },
      { Summary: { ColData: cells("Gross Profit", "261000.00", "288000.00", "330500.00", "102000.00", "981500.00") }, type: "Section", group: "GrossProfit" },
      {
        Header: { ColData: cells("Expenses", "", "", "", "", "") },
        Rows: {
          Row: [
            {
              Header: { ColData: cells("Payroll Expenses", "", "", "", "", "") },
              Rows: {
                Row: [
                  data("Wages", "101", "840000.00", "860000.00", "890000.00", "300000.00", "2890000.00"),
                  data("Taxes", "102", "65000.00", "66000.00", "68000.00", "23000.00", "222000.00"),
                ],
              },
              Summary: { ColData: cells("Total Payroll Expenses", "905000.00", "926000.00", "958000.00", "323000.00", "3112000.00") },
              type: "Section",
            },
            data("Rent & Lease", "110", "95000.00", "95000.00", "95000.00", "47500.00", "332500.00"),
            data("Legal & Professional Fees", "111", "180000.00", "189000.00", "212000.00", "31500.00", "612500.00"),
          ],
        },
        Summary: { ColData: cells("Total Expenses", "1180000.00", "1210000.00", "1265000.00", "402000.00", "4057000.00") },
        type: "Section",
        group: "Expenses",
      },
      { Summary: { ColData: cells("Net Operating Income", "-919000.00", "-922000.00", "-934500.00", "-300000.00", "-3075500.00") }, type: "Section", group: "NetOperatingIncome" },
      {
        Header: { ColData: cells("Other Income", "", "", "", "", "") },
        Rows: { Row: [data("Interest earned", "120", "41000.00", "39500.00", "38000.00", "", "118500.00")] },
        Summary: { ColData: cells("Total Other Income", "41000.00", "39500.00", "38000.00", "", "118500.00") },
        type: "Section",
        group: "OtherIncome",
      },
      {
        Header: { ColData: cells("Other Expenses", "", "", "", "", "") },
        Rows: { Row: [data("Depreciation", "130", "15000.00", "15000.00", "15000.00", "", "45000.00")] },
        Summary: { ColData: cells("Total Other Expenses", "15000.00", "15000.00", "15000.00", "", "45000.00") },
        type: "Section",
        group: "OtherExpenses",
      },
      { Summary: { ColData: cells("Net Other Income", "26000.00", "24500.00", "23000.00", "0.00", "73500.00") }, type: "Section", group: "NetOtherIncome" },
      { Summary: { ColData: cells("Net Income", "-893000.00", "-897500.00", "-911500.00", "-300000.00", "-3002000.00") }, type: "Section", group: "NetIncome" },
    ],
  },
} as ProfitAndLossReport;

/** A monthly report in the same shape from per-month totals (only the sections given). */
function monthlyReport(months: { month: string; income: number; cogs?: number; expenses: number; netIncome?: number }[], opts: { lastEnd?: string } = {}): ProfitAndLossReport {
  const column = (m: string, i: number) => {
    const [y, mo] = m.split("-").map(Number);
    const end = i === months.length - 1 && opts.lastEnd ? opts.lastEnd : new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    return month(m, `${m}-01`, end);
  };
  const section = (group: string, values: number[]) => ({ Summary: { ColData: cells(`Total ${group}`, ...values.map((v) => v.toFixed(2))) }, type: "Section", group });
  const rows = [section("Income", months.map((m) => m.income)), section("Expenses", months.map((m) => m.expenses))];
  if (months.some((m) => m.cogs !== undefined)) rows.push(section("COGS", months.map((m) => m.cogs ?? 0)));
  if (months.some((m) => m.netIncome !== undefined)) rows.push(section("NetIncome", months.map((m) => m.netIncome ?? 0)));
  return { Columns: { Column: [{ ColType: "Account", ColTitle: "" }, ...months.map((m, i) => column(m.month, i))] }, Rows: { Row: rows } } as ProfitAndLossReport;
}

const pick = (m: PnlMonth) => ({ month: m.month, income: m.income, cogs: m.cogs, expenses: m.expenses, otherIncome: m.otherIncome, otherExpenses: m.otherExpenses, netIncome: m.netIncome });

describe("parseProfitAndLoss", () => {
  it("reads each month column's group totals, ignoring the Total column", () => {
    const months = parseProfitAndLoss(PNL_JUN_SEP);
    assert.deepEqual(
      months.map((m) => m.month),
      ["2026-06", "2026-07", "2026-08", "2026-09"],
    );
    assert.deepEqual(pick(months[0]), { month: "2026-06", income: 322000, cogs: 61000, expenses: 1180000, otherIncome: 41000, otherExpenses: 15000, netIncome: -893000 });
    assert.equal(months[2].income, 401000, "sub-account sections inside Income are not counted twice");
    assert.equal(months[0].start.toISOString(), "2026-06-01T00:00:00.000Z");
  });

  it("treats empty cells as zero and keeps the partial month for the caller to drop", () => {
    const sep = parseProfitAndLoss(PNL_JUN_SEP)[3];
    assert.deepEqual(pick(sep), { month: "2026-09", income: 120000, cogs: 18000, expenses: 402000, otherIncome: 0, otherExpenses: 0, netIncome: -300000 });
  });

  it("derives net income when the NetIncome group is missing, and zeroes missing groups", () => {
    const months = parseProfitAndLoss(monthlyReport([{ month: "2026-07", income: 50000, expenses: 80000 }]));
    assert.deepEqual(pick(months[0]), { month: "2026-07", income: 50000, cogs: 0, expenses: 80000, otherIncome: 0, otherExpenses: 0, netIncome: -30000 });
  });

  it("handles a report with no data and month columns without date metadata", () => {
    const empty = parseProfitAndLoss({
      Header: { Option: [{ Name: "NoReportData", Value: "true" }] },
      Columns: { Column: [{ ColType: "Account", ColTitle: "" }, { ColType: "Money", ColTitle: "Aug. 2025" }, { ColType: "Money", ColTitle: "Sep 2025" }, { ColType: "Money", ColTitle: "Total" }] },
      Rows: {},
    });
    assert.deepEqual(
      empty.map((m) => [m.month, m.income, m.netIncome]),
      [
        ["2025-08", 0, 0],
        ["2025-09", 0, 0],
      ],
    );
    assert.deepEqual(parseProfitAndLoss({}), []);
  });

  it("finds groups nested one level down", () => {
    const report = monthlyReport([{ month: "2026-05", income: 1000, expenses: 400 }]);
    const other = { Header: { ColData: cells("Other Income/Expense", "") }, Rows: { Row: [{ Summary: { ColData: cells("Total Other Income", "250.00") }, type: "Section", group: "OtherIncome" }] }, type: "Section" };
    report.Rows!.Row!.push(other);
    assert.equal(parseProfitAndLoss(report)[0].otherIncome, 250);
    assert.equal(parseProfitAndLoss(report)[0].netIncome, 850);
  });
});

describe("parseAmount", () => {
  it("parses report strings", () => {
    assert.equal(parseAmount("1234.56"), 1234.56);
    assert.equal(parseAmount("-125.00"), -125);
    assert.equal(parseAmount("1,234.50"), 1234.5);
    assert.equal(parseAmount(""), 0);
    assert.equal(parseAmount(undefined), 0);
    assert.equal(parseAmount("n/a"), 0);
    assert.equal(parseAmount(42), 42);
  });
});

describe("P&L aggregates", () => {
  // Oct 2025 → Oct 2026 as requested on 2026-10-08: twelve complete months plus a partial October.
  const now = new Date("2026-10-08T14:00:00Z");
  const series = [
    { month: "2025-10", income: 200000, expenses: 900000 },
    { month: "2025-11", income: 210000, expenses: 900000 },
    { month: "2025-12", income: 220000, expenses: 950000 },
    { month: "2026-01", income: 230000, expenses: 950000 },
    { month: "2026-02", income: 240000, expenses: 1000000 },
    { month: "2026-03", income: 250000, expenses: 1000000 },
    { month: "2026-04", income: 260000, expenses: 1000000 },
    { month: "2026-05", income: 270000, expenses: 1050000 },
    { month: "2026-06", income: 280000, expenses: 1050000 },
    { month: "2026-07", income: 1500000, expenses: 1100000 }, // milestone payment: a profitable month
    { month: "2026-08", income: 381000, expenses: 1100000 },
    { month: "2026-09", income: 412300, expenses: 1520000 },
    { month: "2026-10", income: 15000, expenses: 300000 }, // partial
  ];
  const months = parseProfitAndLoss(monthlyReport(series, { lastEnd: "2026-10-08" }));
  const complete = completeMonths(months, now);

  it("drops the partial current month", () => {
    assert.equal(months.length, 13);
    assert.equal(complete.length, 12);
    assert.equal(complete.at(-1)!.month, "2026-09");
    assert.ok(!complete.some((m) => m.month === "2026-10"));
  });

  it("sums trailing-12-month revenue over complete months only", () => {
    const expected = series.slice(0, 12).reduce((s, m) => s + m.income, 0);
    assert.deepEqual(trailingRevenue(complete), { value: expected, months: 12 });
    assert.deepEqual(trailingRevenue(complete.slice(-5)), { value: 280000 + 1500000 + 381000 + 412300 + 270000, months: 5 });
  });

  it("annualizes the last complete month", () => {
    assert.equal(complete.at(-1)!.income * 12, 4947600);
  });

  it("averages max(0, −net income) over three months; profitable months count as zero burn", () => {
    const burn = accrualNetBurn(complete);
    assert.equal(burn.length, 10, "every month with three months of history");
    assert.equal(burn[0].month, "2025-12");
    const last = burn.at(-1)!;
    assert.equal(last.month, "2026-09");
    // Jul +400,000 (no burn), Aug −719,000, Sep −1,107,700.
    assert.equal(last.value, (0 + 719000 + 1107700) / 3);
    assert.equal(last.start.toISOString(), "2026-09-01T00:00:00.000Z");
  });

  it("still gives the latest month a burn with less than three months of history", () => {
    const burn = accrualNetBurn(complete.slice(-2));
    assert.deepEqual(
      burn.map((b) => [b.month, b.value]),
      [["2026-09", (719000 + 1107700) / 2]],
    );
  });

  it("summarizes the newly completed month in one signal", () => {
    const signal = booksSignal(complete, now)!;
    assert.equal(signal.title, "September books: revenue $412K (+8% vs August), net loss $1.1M");
    assert.equal(signal.externalId, "quickbooks:month:2026-09");
    assert.equal(signal.kind, "METRIC_UPDATE");
    assert.equal(signal.metadata?.signalType, "development");
    assert.equal(signal.metadata?.importance, 3);
    assert.match(signal.metadata?.summary ?? "", /revenue \$412,300, operating expenses \$1,520,000, net loss \$1,107,700/);
  });

  it("words a profit and a revenue drop, and skips the comparison without the prior month", () => {
    const profitable = booksSignal(completeMonths(parseProfitAndLoss(monthlyReport(series.slice(8, 10))), now), now)!;
    assert.equal(profitable.title, "July books: revenue $1.5M (+436% vs June), net income $400K");
    const down = booksSignal(completeMonths(parseProfitAndLoss(monthlyReport(series.slice(9, 11))), now), now)!;
    assert.equal(down.title, "August books: revenue $381K (-75% vs July), net loss $719K");
    const alone = booksSignal(completeMonths(parseProfitAndLoss(monthlyReport(series.slice(11, 12))), now), now)!;
    assert.equal(alone.title, "September books: revenue $412K, net loss $1.1M");
    assert.equal(booksSignal([], now), null);
  });
});

describe("sumBankBalances", () => {
  it("sums USD bank balances and lists other currencies", () => {
    const result = sumBankBalances([
      { Id: "35", CurrentBalance: 18250000.55, CurrencyRef: { value: "USD" } },
      { Id: "36", CurrentBalance: 1200000 },
      { Id: "37", CurrentBalance: 50000, CurrencyRef: { value: "EUR" } },
      { Id: "38", CurrentBalance: "-1500.25", CurrencyRef: { value: "usd" } },
    ]);
    assert.deepEqual(result, { total: 19448500.3, counted: 3, otherCurrencies: ["EUR"] });
  });
});

describe("realmIdOf", () => {
  it("accepts numeric company ids and rejects anything else as needing a reconnect", () => {
    assert.equal(realmIdOf({ realmId: "9130357" }), "9130357");
    assert.equal(realmIdOf({ realmId: 9130357 }), "9130357");
    assert.throws(() => realmIdOf({}), ProviderAuthError);
    assert.throws(() => realmIdOf({ realmId: "../companyinfo" }), /realmId/);
  });
});

describe("QuickBooks API calls", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());
  const now = new Date("2026-10-08T14:00:00Z");

  it("requests 12 complete months plus the current one, by month, accrual, minorversion 75", async () => {
    const stub = stubFetch(routes([["GET", /\/v3\/company\/9130357\/reports\/ProfitAndLoss$/, () => json(PNL_JUN_SEP)]]));
    restore = stub.restore;
    const report = await fetchProfitAndLoss(fakeContext({ provider: "QUICKBOOKS" }), "9130357", now);
    assert.equal(parseProfitAndLoss(report).length, 4);
    const req = stub.requests[0];
    assert.equal(req.url.host, "quickbooks.api.intuit.com");
    assert.deepEqual(Object.fromEntries(req.url.searchParams), {
      start_date: "2025-10-01",
      end_date: "2026-10-08",
      summarize_column_by: "Month",
      accounting_method: "Accrual",
      minorversion: "75",
    });
    assert.equal(req.headers.get("authorization"), "Bearer access-token");
  });

  it("queries active bank accounts with %20-encoded spaces", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/v3\/company\/9130357\/query$/,
          () => json({ QueryResponse: { Account: [{ Id: "35", Name: "Checking", AccountType: "Bank", CurrentBalance: 1201.0, CurrencyRef: { value: "USD", name: "United States Dollar" } }], startPosition: 1, maxResults: 1 }, time: "2026-10-08T07:00:00-07:00" }),
        ],
      ]),
    );
    restore = stub.restore;
    const accounts = await fetchBankAccounts(fakeContext({ provider: "QUICKBOOKS" }), "9130357");
    assert.equal(sumBankBalances(accounts).total, 1201);
    const req = stub.requests[0];
    assert.match(req.url.searchParams.get("query") ?? "", /^select \* from Account where AccountType = 'Bank' and Active = true/);
    assert.equal(req.url.searchParams.get("minorversion"), "75");
    assert.ok(!req.url.search.includes("+"), "spaces are %20, as Intuit documents");
  });

  it("returns no accounts for an empty query response", async () => {
    restore = stubFetch(routes([["GET", /\/query$/, () => json({ QueryResponse: {}, time: "2026-10-08T07:00:00-07:00" })]])).restore;
    assert.deepEqual(await fetchBankAccounts(fakeContext({ provider: "QUICKBOOKS" }), "9130357"), []);
  });

  it("maps 403 to a reconnect, and 401 after a refresh to ProviderAuthError", async () => {
    restore = stubFetch(routes([["GET", /ProfitAndLoss$/, () => json({ Fault: { Error: [{ Message: "Authorization Failure", code: "003100" }], type: "AuthorizationFault" } }, { status: 403 })]])).restore;
    await assert.rejects(() => fetchProfitAndLoss(fakeContext({ provider: "QUICKBOOKS" }), "9130357", now), (e) => e instanceof ProviderAuthError && /Reconnect QuickBooks/.test(e.message));
    restore();

    restore = stubFetch(routes([["GET", /ProfitAndLoss$/, () => json({ fault: { type: "AUTHENTICATION" } }, { status: 401 })]])).restore;
    const ctx = fakeContext({ provider: "QUICKBOOKS" });
    await assert.rejects(() => fetchProfitAndLoss(ctx, "9130357", now), ProviderAuthError);
    assert.equal(ctx.refreshCount, 1, "one forced refresh before giving up");
  });
});
