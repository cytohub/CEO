import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rulesAnswer, listJoin, companyTypeNoun } from "./answer";
import { ClaudePlanSchema, planFromClaude } from "./claude-planner";
import { explicitPlan, type Lexicon } from "./planner";
import { excerpt, parseHeadline, splitTerms } from "./snippets";
import { HL_START, HL_STOP, ftsFilterSql, likePattern, prefixTsQuery, sourceItemAccessSql } from "./sql";
import { resolveCitations, SynthesisSchema } from "./synthesize";
import { parseTimeRange, presetRange } from "./time-range";
import type { SearchGroup, SearchResult } from "./types";

const TODAY = new Date("2026-10-06T00:00:00.000Z"); // Tuesday
const NOW = new Date("2026-10-06T18:00:00.000Z");
const range = (q: string) => {
  const r = parseTimeRange(q, TODAY);
  return r && [r.from, r.to];
};

describe("time ranges", () => {
  it("relative periods", () => {
    assert.deepEqual(range("from the last 30 days"), ["2026-09-06", "2026-10-06"]);
    assert.deepEqual(range("past two weeks"), ["2026-09-22", "2026-10-06"]);
    assert.deepEqual(range("next 7 days"), ["2026-10-06", "2026-10-13"]);
    assert.deepEqual(range("this week"), ["2026-10-05", "2026-10-11"]);
    assert.deepEqual(range("next week"), ["2026-10-12", "2026-10-18"]);
    assert.deepEqual(range("last week"), ["2026-09-28", "2026-10-04"]);
    assert.deepEqual(range("this month"), ["2026-10-01", "2026-10-31"]);
    assert.deepEqual(range("next month"), ["2026-11-01", "2026-11-30"]);
    assert.deepEqual(range("last month"), ["2026-09-01", "2026-09-30"]);
    assert.deepEqual(range("this quarter"), ["2026-10-01", "2026-12-31"]);
  });
  it("named days", () => {
    assert.deepEqual(range("what is due today"), ["2026-10-06", "2026-10-06"]);
    assert.deepEqual(range("tomorrow"), ["2026-10-07", "2026-10-07"]);
    assert.deepEqual(range("yesterday"), ["2026-10-05", "2026-10-05"]);
    assert.deepEqual(range("since Monday"), ["2026-10-05", "2026-10-06"]);
    assert.deepEqual(range("since tuesday"), ["2026-10-06", "2026-10-06"], "today counts");
    assert.deepEqual(range("since Friday"), ["2026-10-02", "2026-10-06"]);
    assert.deepEqual(range("since September 15"), ["2026-09-15", "2026-10-06"]);
    assert.deepEqual(range("what is due Friday"), ["2026-10-09", "2026-10-09"]);
  });
  it("no range and presets", () => {
    assert.equal(parseTimeRange("What commitments have I made to investors?", TODAY), null);
    assert.equal(parseTimeRange("Show everything related to Northbridge", TODAY), null);
    const p = presetRange("next30d", TODAY);
    assert.deepEqual([p.from, p.to, p.future], ["2026-10-06", "2026-11-05", true]);
    assert.deepEqual([presetRange("7d", TODAY).from, presetRange("7d", TODAY).to], ["2026-09-29", "2026-10-06"]);
  });
});

describe("SQL access filter (scope → where)", () => {
  const scope = (patch: object) => ({ all: false, levels: [], connectionIds: [], sourceItemIds: [], documentIds: [], threadIds: [], ...patch });
  it("unrestricted viewers see everything", () => {
    assert.equal(sourceItemAccessSql({ ...scope({}), all: true }).sql, "TRUE");
  });
  it("no clearance and no grants → nothing", () => {
    assert.equal(sourceItemAccessSql(scope({})).sql, "FALSE");
  });
  it("one clause per scope field, all parameterized", () => {
    const sql = sourceItemAccessSql(scope({ levels: ["INTERNAL", "CONFIDENTIAL"], connectionIds: ["c1"], sourceItemIds: ["s1"], documentIds: ["d1"], threadIds: ["t1"] }));
    assert.match(sql.sql, /^\(.*\)$/s);
    assert.equal(sql.sql.split(" OR ").length, 5);
    assert.match(sql.sql, /"si"\."sensitivity"::text = ANY\(\$1::text\[\]\)/);
    assert.match(sql.sql, /"si"\."connectionId" = ANY\(\$2::text\[\]\)/);
    assert.match(sql.sql, /"si"\."id" = ANY\(\$3::text\[\]\)/);
    assert.match(sql.sql, /FROM "Document" gd WHERE gd\."sourceItemId" = "si"\."id" AND gd\."id" = ANY\(\$4::text\[\]\)/);
    assert.match(sql.sql, /FROM "EmailMessage" gm WHERE gm\."sourceItemId" = "si"\."id" AND gm\."threadId" = ANY\(\$5::text\[\]\)/);
    assert.deepEqual(sql.values, [["INTERNAL", "CONFIDENTIAL"], ["c1"], ["s1"], ["d1"], ["t1"]]);
  });
  it("grant-only viewers (advisors) get just their grants", () => {
    const sql = sourceItemAccessSql(scope({ threadIds: ["t9"] }));
    assert.equal(sql.values.length, 1);
    assert.doesNotMatch(sql.sql, /sensitivity/);
  });
  it("user input never reaches the SQL text", () => {
    const evil = `x'); DROP TABLE "SourceItem"; --`;
    const sql = sourceItemAccessSql(scope({ connectionIds: [evil] }));
    assert.ok(!sql.sql.includes("DROP"));
    const f = ftsFilterSql({ ids: [evil], kinds: ["EMAIL_MESSAGE"], from: TODAY, toExclusive: NOW });
    assert.ok(!f.sql.includes("DROP"));
    assert.equal(f.values.length, 4);
    assert.equal(ftsFilterSql({ ids: [] }).sql, `AND FALSE`, "empty id restriction matches nothing");
    assert.equal(ftsFilterSql({}).sql, "");
  });
  it("prefix queries and LIKE patterns are sanitized", () => {
    assert.equal(prefixTsQuery("Electro trac!"), "electro:* & trac:*");
    assert.equal(prefixTsQuery("'; DROP"), "drop:*");
    assert.equal(prefixTsQuery("!!"), null);
    assert.equal(likePattern("50%_off"), "%50\\%\\_off%");
  });
});

describe("snippets", () => {
  it("parses ts_headline markers into parts", () => {
    const parts = parseHeadline(`send the ${HL_START}revised${HL_STOP} data ${HL_START}package${HL_STOP} by Friday`);
    assert.deepEqual(parts, [
      { text: "send the ", match: false },
      { text: "revised", match: true },
      { text: " data ", match: false },
      { text: "package", match: true },
      { text: " by Friday", match: false },
    ]);
  });
  it("never produces HTML, only text parts", () => {
    const parts = splitTerms("<script>alert(1)</script> Calder", ["calder"]);
    assert.deepEqual(parts, [
      { text: "<script>alert(1)</script> ", match: false },
      { text: "Calder", match: true },
    ]);
  });
  it("excerpts around the first match", () => {
    const long = `${"intro ".repeat(80)}the electrophysiology traces are attached ${"tail ".repeat(80)}`;
    const ex = excerpt(long, ["electrophysiology"], 120)!;
    assert.ok(ex.some((p) => p.match && p.text.toLowerCase() === "electrophysiology"));
    assert.ok(ex[0].text.startsWith("…") && ex.at(-1)!.text.endsWith("…"));
  });
});

// ─── Answer templates ────────────────────────────────────────────────────────

const r = (p: Partial<SearchResult> & Pick<SearchResult, "type" | "id" | "title">): SearchResult => ({ href: `/x/${p.id}`, rank: 0.5, ...p });
const group = (type: SearchResult["type"], results: SearchResult[]): SearchGroup => ({ type, label: type, results, truncated: false });
const answer = (plan: ReturnType<typeof explicitPlan>, groups: SearchGroup[], extra = {}) => rulesAnswer({ plan, groups, today: TODAY, now: NOW, ...extra });

describe("answer templates", () => {
  it("commitments to investors", () => {
    const plan = explicitPlan("What commitments have I made to investors?", { intent: "commitments", direction: "OUTBOUND", companyTypes: ["INVESTOR"], recordTypes: ["commitment"] });
    const a = answer(plan, [
      group("commitment", [
        r({ type: "commitment", id: "c1", title: "Send the cohort retention analysis", companyName: "Northbridge Ventures", meta: { status: "OPEN", due: "2026-10-08", party: "Sarah Chen" } }),
        r({ type: "commitment", id: "c2", title: "Share the HeartReady plan", meta: { status: "OPEN", due: "2026-10-05", party: "Anna Berg", overdue: true } }),
        r({ type: "commitment", id: "c3", title: "Open the data room", meta: { status: "FULFILLED" } }),
      ]),
    ]);
    assert.equal(
      a.text,
      "You have 2 open commitments to investors: “Send the cohort retention analysis” (Sarah Chen, due Oct 8) and “Share the HeartReady plan” (Anna Berg, 1d overdue). 1 is overdue. 1 commitment already fulfilled.",
    );
    assert.deepEqual(a.citations.map((c) => c.id), ["c1", "c2", "c3"]);
    assert.equal(a.engine, "rules");
    assert.equal(answer(plan, []).text, "You have no open commitments to investors.");
  });
  it("what did we promise <person>", () => {
    const plan = explicitPlan("What did we promise Karen?", { intent: "commitments", direction: "OUTBOUND", entities: [{ kind: "person", id: "p", label: "Karen Liu", matched: "Karen", confidence: 0.7 }] });
    const a = answer(plan, [group("commitment", [r({ type: "commitment", id: "c", title: "Send the updated proposal", meta: { status: "OPEN", due: "2026-10-05", overdue: true } })])]);
    assert.equal(a.text, "You have 1 open commitment to Karen Liu: “Send the updated proposal” (1d overdue).");
  });
  it("inbound commitments", () => {
    const plan = explicitPlan("What does Northbridge owe us?", { intent: "commitments", direction: "INBOUND", entities: [{ kind: "company", id: "c", label: "Northbridge Ventures", matched: "Northbridge", confidence: 1 }] });
    assert.match(answer(plan, [group("commitment", [r({ type: "commitment", id: "c", title: "Send the term sheet", meta: { status: "OPEN", due: "2026-10-13" } })])]).text, /^Northbridge Ventures owe you 1 open commitment: “Send the term sheet” \(due Oct 13\)\.$/);
  });
  it("customers waiting on CytoHub", () => {
    const plan = explicitPlan("Which customers are waiting on CytoHub?", { intent: "waiting", direction: "OUTBOUND", companyTypes: ["CUSTOMER", "PROSPECT"] });
    const a = answer(plan, [
      group("commitment", [r({ type: "commitment", id: "c", title: "Send the updated proposal", companyName: "Brightwater", meta: { due: "2026-10-05", overdue: true } })]),
      group("thread", [r({ type: "thread", id: "t", title: "Assay turnaround — escalation", companyName: "Lumen Biologics" })]),
    ]);
    assert.equal(a.text, "2 customers are waiting on CytoHub: Brightwater (“Send the updated proposal”, 1d overdue) and Lumen Biologics (“Assay turnaround — escalation” awaiting your reply).");
    assert.equal(answer(plan, []).text, "No customers are waiting on CytoHub right now.");
  });
  it("deadlines next week", () => {
    const plan = explicitPlan("What deadlines do we have next week?", { intent: "deadlines", timeRange: { from: "2026-10-12", to: "2026-10-18", label: "Next week (Oct 12–Oct 18)" } });
    const a = answer(plan, [
      group("task", [r({ type: "task", id: "t1", title: "Review Q4 board deck", meta: { due: "2026-10-13" } }), r({ type: "task", id: "t2", title: "Sign NHI term sheet", meta: { due: "2026-10-12" } })]),
      group("milestone", [r({ type: "milestone", id: "m", title: "Series B data room complete", meta: { due: "2026-10-15" } })]),
    ]);
    assert.equal(a.text, "You have 3 deadlines next week (Oct 12–Oct 18): “Sign NHI term sheet” (task, due Oct 12), “Review Q4 board deck” (task, due Oct 13) and “Series B data room complete” (milestone, due Oct 15).");
  });
  it("conversation history with summaries, newest first", () => {
    const plan = explicitPlan("What have we discussed with Calder?", { intent: "discussed", entities: [{ kind: "company", id: "c", label: "Calder Biosciences", matched: "Calder", confidence: 1 }] });
    const a = answer(plan, [
      group("thread", [r({ type: "thread", id: "t", title: "Revised data package", timestamp: "2026-10-06T13:00:00.000Z", meta: { summary: "Henrik asked for the revised package by Friday." } })]),
      group("meeting", [r({ type: "meeting", id: "m", title: "Calder QBR", timestamp: "2026-09-20T13:00:00.000Z" }), r({ type: "meeting", id: "m2", title: "Calder kickoff (upcoming)", timestamp: "2026-10-20T13:00:00.000Z" })]),
    ]);
    assert.equal(a.text, "Here’s what you’ve discussed with Calder Biosciences: 1 email thread and 2 meetings. Most recent: “Revised data package” (5h ago) — Henrik asked for the revised package by Friday.");
  });
  it("status of the Series B uses goal progress and pipeline", () => {
    const plan = explicitPlan("What is happening with the Series B?", { intent: "status", topic: "series b" });
    const a = answer(
      plan,
      [group("deal", [r({ type: "deal", id: "d", title: "Northbridge — Series B lead", companyName: "Northbridge Ventures", meta: { status: "OPEN", stage: "Partner meeting" } })]), group("insight", [r({ type: "insight", id: "i", title: "Deck raise changed to $40M", timestamp: "2026-10-06T12:00:00.000Z" })])],
      { context: { goals: [{ id: "g", title: "Close a $40M Series B", progress: 38, status: "AT_RISK", confidence: 60, targetDate: "2026-12-15" }], pipeline: { open: 4, totalValue: 34_000_000, stages: [] } } },
    );
    assert.equal(a.text, "“Close a $40M Series B” is 38% complete (at risk, 60% confidence, target Dec 15). The pipeline has 4 open deals worth $34M, led by Northbridge Ventures (Partner meeting). Latest: “Deck raise changed to $40M” (6h ago).");
  });
  it("helpers", () => {
    assert.equal(listJoin(["a", "b", "c"]), "a, b and c");
    assert.equal(companyTypeNoun(["CUSTOMER", "PROSPECT"]), "customers");
    assert.equal(companyTypeNoun(["INVESTOR", "PARTNER"]), "investors and partners");
  });
});

describe("Claude planner and synthesis validation", () => {
  const lex: Lexicon = { companies: [{ id: "c1", name: "Lumen Biologics", type: "CUSTOMER", domain: null, parentId: null, aliases: [] }], people: [], goals: [], deals: [], projects: [] };
  it("rejects malformed plans and resolves names locally", () => {
    assert.equal(ClaudePlanSchema.safeParse({ intent: "hack" }).success, false);
    const raw = ClaudePlanSchema.parse({ intent: "discussed", entityNames: ["Lumen", "Unknown Corp"], topic: "", recordTypes: ["thread"], direction: "NONE", companyTypes: [], timeFrom: "", timeTo: "", keywords: "", openOnly: false });
    const plan = planFromClaude(raw, "q", lex, TODAY, explicitPlan("q", {}));
    assert.deepEqual(plan.entities.map((e) => e.id), ["c1"]);
    assert.equal(plan.engine, "claude");
    assert.equal(plan.direction, null);
    assert.equal(ClaudePlanSchema.safeParse({ ...raw, timeFrom: "next week" }).success, false, "dates must be ISO days");
  });
  it("synthesis keeps only citations of results that were sent", () => {
    assert.equal(SynthesisSchema.safeParse({ answer: "", citations: [] }).success, false);
    const groups = [group("thread", [r({ type: "thread", id: "t1", title: "A" })])];
    assert.deepEqual(resolveCitations(["thread:t1", "thread:evil", "task:t1"], groups).map((c) => c.id), ["t1"]);
  });
});
