import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Lexicon, lexiconFamily, matchTopic, normalize, planQuery } from "./planner";

// A lexicon shaped like the seeded workspace, plus a corporate family for J&J.
const LEX: Lexicon = {
  companies: [
    { id: "c-calder", name: "Calder Biosciences", type: "CUSTOMER", domain: "calder.example", parentId: null, aliases: [] },
    { id: "c-north", name: "Northbridge Ventures", type: "INVESTOR", domain: "northbridge.example", parentId: null, aliases: [] },
    { id: "c-helix", name: "Helix Capital Partners", type: "INVESTOR", domain: "helix.example", parentId: null, aliases: [] },
    { id: "c-bright", name: "Brightwater Therapeutics", type: "PROSPECT", domain: "brightwater.example", parentId: null, aliases: [] },
    { id: "c-lumen", name: "Lumen Biologics", type: "CUSTOMER", domain: "lumen.example", parentId: null, aliases: [] },
    { id: "c-aurelius", name: "Aurelius Pharma", type: "CUSTOMER", domain: "aurelius.example", parentId: null, aliases: [] },
    { id: "c-nhi", name: "Nordic Heart Institute", type: "ACADEMIC", domain: "nhi.example", parentId: null, aliases: [] },
    { id: "c-jj", name: "Johnson & Johnson", type: "PROSPECT", domain: "jnj.example", parentId: null, aliases: [] },
    { id: "c-janssen", name: "Janssen Pharmaceuticals", type: "PROSPECT", domain: "janssen.example", parentId: "c-jj", aliases: ["Janssen"] },
    { id: "c-ostrava", name: "Ostrava Pharma", type: "PROSPECT", domain: "ostrava.example", parentId: null, aliases: ["OPH"] },
  ],
  people: [
    { id: "p-ceo", name: "Alex Morgan", email: "ceo@cytohub.example", companyId: null, isCeo: true, aliases: [] },
    { id: "p-karen", name: "Karen Liu", email: "karen@brightwater.example", companyId: "c-bright", isCeo: false, aliases: [] },
    { id: "p-sarah", name: "Sarah Chen", email: "sarah@northbridge.example", companyId: "c-north", isCeo: false, aliases: [] },
    { id: "p-henrik", name: "Dr. Henrik Sørensen", email: "henrik@calder.example", companyId: "c-calder", isCeo: false, aliases: [] },
    { id: "p-michael", name: "Michael Grant", email: "michael@granite.example", companyId: null, isCeo: false, aliases: ["Mike"] },
    { id: "p-maya", name: "Dr. Maya Lindqvist", email: "maya@cytohub.example", companyId: null, isCeo: false, aliases: [] },
  ],
  goals: [
    { id: "g-seriesb", title: "Close a $40M Series B", type: "COMPANY" },
    { id: "g-termsheet", title: "Secure a Series B lead term sheet", type: "QUARTERLY" },
    { id: "g-arr", title: "Reach $6M ARR by year-end", type: "COMPANY" },
  ],
  deals: [
    { id: "d-north", name: "Northbridge Ventures — Series B lead", type: "FUNDRAISING", status: "OPEN", companyId: "c-north" },
    { id: "d-helix", name: "Helix Capital — Series B", type: "FUNDRAISING", status: "OPEN", companyId: "c-helix" },
    { id: "d-bright", name: "Brightwater — cardiac safety MSA", type: "SALES", status: "OPEN", companyId: "c-bright" },
  ],
  projects: [{ id: "pr-heart", name: "HeartReady", aliases: ["HeartReady program"] }],
};

// Tuesday, October 6, 2026 (CEO calendar day).
const TODAY = new Date("2026-10-06T00:00:00.000Z");
const plan = (q: string) => planQuery(q, LEX, { today: TODAY });
const ids = (p: ReturnType<typeof plan>, kind?: string) => p.entities.filter((e) => !kind || e.kind === kind).map((e) => e.id);

describe("planner: the eight example questions", () => {
  it("What have we discussed with <company>?", () => {
    for (const [q, id] of [
      ["What have we discussed with Calder Biosciences?", "c-calder"],
      ["What have we discussed with Calder?", "c-calder"],
      ["what have we discussed with northbridge ventures", "c-north"],
      ["What have we discussed with Lumen?", "c-lumen"],
    ] as const) {
      const p = plan(q);
      assert.equal(p.intent, "discussed", q);
      assert.deepEqual(ids(p, "company"), [id], q);
      assert.equal(p.sort, "newest");
      assert.ok(p.recordTypes.includes("thread") && p.recordTypes.includes("meeting") && p.recordTypes.includes("document") && p.recordTypes.includes("notes"));
      assert.equal(p.text, "", q);
      assert.ok(p.confidence >= 0.6, `${q} confidence ${p.confidence}`);
    }
  });

  it("Show everything related to <company>", () => {
    for (const [q, id] of [
      ["Show everything related to Northbridge Ventures", "c-north"],
      ["Show everything related to Brightwater", "c-bright"],
      ["show me everything about aurelius pharma", "c-aurelius"],
    ] as const) {
      const p = plan(q);
      assert.equal(p.intent, "related", q);
      assert.deepEqual(ids(p, "company"), [id], q);
      assert.equal(p.entities[0].family, true);
      assert.deepEqual(p.recordTypes, [], "related returns every type");
    }
  });

  it("What commitments have I made to investors?", () => {
    const p = plan("What commitments have I made to investors?");
    assert.equal(p.intent, "commitments");
    assert.equal(p.direction, "OUTBOUND");
    assert.deepEqual(p.companyTypes, ["INVESTOR"]);
    assert.deepEqual(p.recordTypes, ["commitment"]);
    assert.equal(p.sort, "open_first");
    assert.equal(p.entities.length, 0);
    for (const [q, types] of [
      ["What commitments have I made to customers?", ["CUSTOMER", "PROSPECT"]],
      ["What commitments have we made to partners?", ["PARTNER", "ACADEMIC"]],
    ] as const) {
      const x = plan(q);
      assert.equal(x.intent, "commitments", q);
      assert.equal(x.direction, "OUTBOUND", q);
      assert.deepEqual(x.companyTypes, types, q);
    }
  });

  it("What is happening with the Series B?", () => {
    const p = plan("What is happening with the Series B?");
    assert.equal(p.intent, "status");
    assert.equal(p.topic, "series b");
    assert.deepEqual(ids(p, "goal"), ["g-seriesb", "g-termsheet"], "company goal ranks first");
    assert.deepEqual(ids(p, "deal"), ["d-north", "d-helix"]);
    assert.ok(p.recordTypes.includes("goal") && p.recordTypes.includes("deal") && p.recordTypes.includes("thread") && p.recordTypes.includes("insight"));
    assert.ok(p.confidence >= 0.8);
    const h = plan("What's the status of HeartReady?");
    assert.equal(h.intent, "status");
    assert.deepEqual(ids(h, "project"), ["pr-heart"]);
  });

  it("What deadlines do we have next week?", () => {
    const p = plan("What deadlines do we have next week?");
    assert.equal(p.intent, "deadlines");
    assert.deepEqual(p.timeRange && { from: p.timeRange.from, to: p.timeRange.to }, { from: "2026-10-12", to: "2026-10-18" });
    assert.equal(p.timeField, "due");
    assert.equal(p.sort, "due");
    assert.equal(p.openOnly, true);
    assert.deepEqual([...p.recordTypes].sort(), ["commitment", "decision", "milestone", "task"]);
    const t = plan("What deadlines do we have this week?");
    assert.deepEqual(t.timeRange && [t.timeRange.from, t.timeRange.to], ["2026-10-05", "2026-10-11"]);
    const none = plan("What deadlines do we have?");
    assert.deepEqual(none.timeRange && [none.timeRange.from, none.timeRange.to], [null, "2026-10-20"], "defaults to overdue + next 14 days");
  });

  it("Which customers are waiting on CytoHub?", () => {
    const p = plan("Which customers are waiting on CytoHub?");
    assert.equal(p.intent, "waiting");
    assert.equal(p.direction, "OUTBOUND");
    assert.deepEqual(p.companyTypes, ["CUSTOMER", "PROSPECT"]);
    assert.ok(p.categories.includes("CUSTOMER"));
    assert.deepEqual(p.recordTypes, ["commitment", "thread"]);
    assert.equal(p.openOnly, true);
    assert.equal(p.entities.length, 0, "CytoHub is us, not an entity");
    const inbound = plan("Which investors are we waiting on them for?");
    assert.equal(inbound.direction, "INBOUND");
  });

  it("What did we promise <first name>?", () => {
    for (const [q, id] of [
      ["What did we promise Karen?", "p-karen"],
      ["What did we promise Sarah?", "p-sarah"],
      ["what did we promise henrik", "p-henrik"],
      ["What did I promise Mike?", "p-michael"],
    ] as const) {
      const p = plan(q);
      assert.equal(p.intent, "commitments", q);
      assert.equal(p.direction, "OUTBOUND", q);
      assert.deepEqual(ids(p, "person"), [id], q);
      assert.ok(p.confidence >= 0.6, `${q} ${p.confidence}`);
    }
  });

  it("Show investor conversations from the last 30 days", () => {
    const p = plan("Show investor conversations from the last 30 days");
    assert.equal(p.intent, "conversations");
    assert.deepEqual(p.companyTypes, ["INVESTOR"]);
    assert.ok(p.categories.includes("INVESTOR") && p.categories.includes("FUNDRAISING"));
    assert.deepEqual(p.timeRange && [p.timeRange.from, p.timeRange.to], ["2026-09-06", "2026-10-06"]);
    assert.equal(p.timeField, "occurred");
    assert.ok(p.recordTypes.includes("thread") && p.recordTypes.includes("meeting"));
    assert.equal(p.text, "");
    const c = plan("Show customer emails from the past 2 weeks");
    assert.equal(c.intent, "conversations");
    assert.deepEqual(c.timeRange && [c.timeRange.from, c.timeRange.to], ["2026-09-22", "2026-10-06"]);
  });
});

describe("planner: entity resolution", () => {
  it("resolves aliases, abbreviations and domains", () => {
    assert.deepEqual(ids(plan("What have we discussed with J&J?"), "company"), ["c-jj"]);
    assert.deepEqual(ids(plan("What have we discussed with Johnson & Johnson?"), "company"), ["c-jj"]);
    assert.deepEqual(ids(plan("emails from janssen.example"), "company"), ["c-janssen"]);
    assert.deepEqual(ids(plan("Show everything related to OPH"), "company"), ["c-ostrava"]);
    assert.deepEqual(ids(plan("What do we know about NHI?"), "company"), ["c-nhi"]);
    assert.deepEqual(ids(plan("Show everything related to Janssen"), "company"), ["c-janssen"]);
  });

  it("expands corporate families", () => {
    assert.deepEqual(lexiconFamily(LEX, "c-jj").sort(), ["c-janssen", "c-jj"]);
    assert.deepEqual(lexiconFamily(LEX, "c-janssen").sort(), ["c-janssen", "c-jj"]);
    assert.deepEqual(lexiconFamily(LEX, "c-calder"), ["c-calder"]);
    const p = plan("Show everything related to J&J");
    assert.ok(p.explanation.some((e) => e.includes("Johnson & Johnson (+1 related)")));
  });

  it("matches people by full name, accents and titles", () => {
    assert.deepEqual(ids(plan("What did we promise Henrik Sørensen?"), "person"), ["p-henrik"]);
    assert.deepEqual(ids(plan("What did we promise Henrik Sorensen?"), "person"), ["p-henrik"]);
    assert.deepEqual(ids(plan("commitments to karen@brightwater.example"), "person"), ["p-karen"]);
  });

  it("does not match common words or the CEO", () => {
    assert.deepEqual(ids(plan("grant access to the data room"), "person"), []);
    assert.deepEqual(ids(plan("What did Alex promise?"), "person"), []);
    assert.equal(plan("pricing for the bright idea").entities.length, 0);
  });

  it("topic matching needs the whole phrase", () => {
    assert.deepEqual(matchTopic("series b", LEX).filter((e) => e.kind === "goal").map((e) => e.id), ["g-seriesb", "g-termsheet"]);
    assert.deepEqual(matchTopic("series", LEX).filter((e) => e.kind === "goal").length, 2);
    assert.deepEqual(matchTopic("term sheet", LEX).map((e) => e.id), ["g-termsheet"]);
    assert.deepEqual(matchTopic("b", LEX), []);
  });
});

describe("planner: direction", () => {
  const dir = (q: string) => plan(q).direction;
  it("detects outbound phrasings", () => {
    for (const q of ["What have I promised Brightwater?", "What do we owe Brightwater?", "commitments I have made", "What did we promise Karen?", "Which customers are waiting on us?", "Who is waiting on CytoHub?", "What have we committed to investors?"]) {
      assert.equal(dir(q), "OUTBOUND", q);
    }
  });
  it("detects inbound phrasings", () => {
    for (const q of ["What does Northbridge owe us?", "What has Sarah promised us?", "What did they promise me?", "commitments from investors", "Which investors are we waiting on them for?"]) {
      assert.equal(dir(q), "INBOUND", q);
    }
  });
  it("leaves direction empty when not stated", () => {
    assert.equal(dir("Show all commitments"), null);
    assert.equal(dir("Brightwater MSA"), null);
  });
});

describe("planner: other intents", () => {
  it("lists record types", () => {
    const p = plan("open risks");
    assert.equal(p.intent, "list");
    assert.deepEqual(p.recordTypes, ["risk"]);
    assert.equal(p.openOnly, true);
    const d = plan("documents about pricing");
    assert.equal(d.intent, "list");
    assert.ok(d.recordTypes.includes("document"));
    assert.equal(d.text, "pricing");
  });

  it("overdue commitments", () => {
    const p = plan("overdue commitments");
    assert.equal(p.intent, "commitments");
    assert.deepEqual(p.timeRange && [p.timeRange.from, p.timeRange.to], [null, "2026-10-05"]);
    assert.equal(p.timeField, "due");
    assert.equal(p.openOnly, true);
  });

  it("keyword search keeps the words", () => {
    const p = plan("electrophysiology traces");
    assert.equal(p.intent, "keyword");
    assert.equal(p.text, "electrophysiology traces");
    assert.ok(p.confidence >= 0.8);
  });

  it("low confidence for unparsed questions", () => {
    const p = plan("How should we think about the oncology market next year?");
    assert.ok(p.confidence < 0.6, String(p.confidence));
  });

  it("a bare company name means everything related", () => {
    const p = plan("Brightwater");
    assert.equal(p.intent, "related");
    assert.deepEqual(ids(p), ["c-bright"]);
  });

  it("normalizes text", () => {
    assert.equal(normalize("Sørensen’s J&J — Café!"), "sorensen j&j cafe");
  });
});
