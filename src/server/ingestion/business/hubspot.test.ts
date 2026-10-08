import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ProviderAuthError } from "../types";
import { fakeContext, json, routes, stubFetch } from "../providers/test-helpers";
import {
  type DealLookup,
  type HubSpotDeal,
  type MappedDeal,
  closeDay,
  companyTypeFor,
  configuredPipelineTypes,
  decideDealSignals,
  dealSummary,
  fetchDealCompanies,
  fetchOwners,
  fetchPipelines,
  guessDealType,
  hubspotConnector,
  mapDeal,
  parsePipelines,
  parseProbability,
  primaryCompanyId,
  resolvePipelineTypes,
  searchDeals,
  stageChanged,
  stageRelabels,
  stageStatus,
} from "./hubspot";
import { KeyRejectedError, type ConnectorSyncContext } from "./types";

const PIPELINES = [
  {
    id: "default",
    label: "Pharma sales",
    displayOrder: 0,
    stages: [
      { id: "qualified", label: "Qualified", displayOrder: 1, metadata: { isClosed: "false", probability: "0.2" } },
      { id: "negotiation", label: "Negotiation", displayOrder: 3, metadata: { isClosed: "false", probability: "0.7" } },
      { id: "closedwon", label: "Closed won", displayOrder: 4, metadata: { isClosed: "true", probability: "1.0" } },
      { id: "closedlost", label: "Closed lost", displayOrder: 5, metadata: { isClosed: "true", probability: "0.0" } },
      { id: "proposal", label: "Proposal", displayOrder: 2, metadata: { isClosed: "false", probability: "0.4" } },
    ],
  },
  {
    id: "778899",
    label: "Series B",
    displayOrder: 1,
    stages: [
      { id: "1001", label: "Intro", displayOrder: 0, metadata: { isClosed: "false", probability: "0.1" } },
      { id: "1002", label: "Term sheet", displayOrder: 1, metadata: { isClosed: "false", probability: "0.8" } },
      { id: "1003", label: "Committed", displayOrder: 2, metadata: { isClosed: "true", probability: "1.0" } },
      { id: "1004", label: "Passed", displayOrder: 3, metadata: { isClosed: "true", probability: "0.0" } },
    ],
  },
  { label: "No id: skipped" },
];

function lookup(configured: Record<string, "SALES" | "FUNDRAISING" | "PARTNERSHIP"> = {}): DealLookup {
  const pipelines = parsePipelines(PIPELINES);
  return {
    pipelines: new Map(pipelines.map((p) => [p.id, p])),
    stages: new Map(pipelines.flatMap((p) => p.stages.map((s) => [s.id, s] as const))),
    types: resolvePipelineTypes(pipelines, configured),
    timeZone: "America/Los_Angeles",
  };
}

function hsDeal(id: string, props: Record<string, string | null>): HubSpotDeal {
  return {
    id,
    properties: {
      dealname: "Brightwater platform license",
      amount: "1400000",
      dealstage: "negotiation",
      pipeline: "default",
      closedate: "2026-11-14T00:00:00Z",
      createdate: "2026-09-01T10:00:00Z",
      hs_lastmodifieddate: "2026-10-07T16:00:00.000Z",
      notes_last_updated: "2026-10-05T12:00:00Z",
      hs_next_step: "Send redlined MSA",
      hubspot_owner_id: "501",
      hs_v2_date_entered_current_stage: "2026-10-07T15:59:00Z",
      ...props,
    },
  };
}

const NOW = new Date("2026-10-08T12:00:00Z");

describe("pipelines and deal types", () => {
  it("parses probabilities as 0–1 fractions", () => {
    assert.equal(parseProbability("0.2"), 0.2);
    assert.equal(parseProbability("1.0"), 1);
    assert.equal(parseProbability("0"), 0);
    assert.equal(parseProbability("20"), 0.2, "percent-style values are tolerated");
    assert.equal(parseProbability(null), null);
    assert.equal(parseProbability(""), null);
    assert.equal(parseProbability("n/a"), null);
  });

  it("guesses the deal type from the pipeline label", () => {
    for (const label of ["Series B", "Seed round", "Investors", "Fundraising 2026", "Capital raise", "Pre-seed"]) assert.equal(guessDealType(label), "FUNDRAISING", label);
    for (const label of ["Partnerships", "Pharma alliances", "Business Development", "BD pipeline", "Licensing"]) assert.equal(guessDealType(label), "PARTNERSHIP", label);
    for (const label of ["Pharma sales", "Sales | CytoHub", "Sales Pipeline", "Refunds", "Background checks", ""]) assert.equal(guessDealType(label), "SALES", label);
  });

  it("lets settings.pipelineTypes override the heuristic and drops invalid entries", () => {
    const configured = configuredPipelineTypes({ default: "partnership", "778899": "SALES", bogus: "CHARITY", n: 3 });
    assert.deepEqual(configured, { default: "PARTNERSHIP", "778899": "SALES" });
    assert.deepEqual(configuredPipelineTypes(["SALES"]), {});
    const pipelines = [
      { id: "default", label: "Pharma sales" },
      { id: "778899", label: "Series B" },
      { id: "x", label: "Strategic partners" },
    ];
    assert.deepEqual(resolvePipelineTypes(pipelines, {}), { default: "SALES", "778899": "FUNDRAISING", x: "PARTNERSHIP" });
    assert.deepEqual(resolvePipelineTypes(pipelines, { "778899": "SALES" }), { default: "SALES", "778899": "SALES", x: "PARTNERSHIP" });
  });

  it("orders stages and reads closed/probability metadata", () => {
    const [sales, series] = parsePipelines(PIPELINES);
    assert.equal(parsePipelines(PIPELINES).length, 2, "a pipeline without an id is skipped");
    assert.deepEqual(sales.stages.map((s) => s.id), ["qualified", "proposal", "negotiation", "closedwon", "closedlost"]);
    assert.deepEqual(sales.stages[0], { id: "qualified", label: "Qualified", order: 1, probability: 0.2, closed: false, pipelineId: "default", pipelineLabel: "Pharma sales" });
    assert.equal(series.label, "Series B");
    assert.equal(series.stages[2].closed, true);
  });

  it("maps stages to open, won and lost", () => {
    assert.equal(stageStatus({ closed: false, probability: 0.9, label: "Verbal" }), "OPEN");
    assert.equal(stageStatus({ closed: true, probability: 1, label: "Closed won" }), "WON");
    assert.equal(stageStatus({ closed: true, probability: 0, label: "Closed lost" }), "LOST");
    assert.equal(stageStatus({ closed: true, probability: 0.8, label: "Closed lost" }), "LOST", "inconsistent odds: the label decides");
    assert.equal(stageStatus({ closed: true, probability: 0.8, label: "Signed" }), "WON");
    assert.equal(stageStatus({ closed: true, probability: null, label: "Archive" }), "LOST");
  });

  it("detects stage renames and reorders, skipping ambiguous swaps", () => {
    const previous = {
      a: { pipeline: "Sales", stage: "Demo", order: 1 },
      b: { pipeline: "Sales", stage: "Proposal", order: 2 },
      c: { pipeline: "Sales", stage: "Won", order: 3 },
      x: { pipeline: "Sales", stage: "One", order: 4 },
      y: { pipeline: "Sales", stage: "Two", order: 5 },
    };
    const current = {
      a: { pipeline: "Sales", stage: "Demo held", order: 1 },
      b: { pipeline: "Sales", stage: "Proposal", order: 3 },
      c: { pipeline: "Sales", stage: "Won", order: 3 },
      x: { pipeline: "Sales", stage: "Two", order: 4 },
      y: { pipeline: "Sales", stage: "One", order: 5 },
      n: { pipeline: "Sales", stage: "New", order: 6 },
    };
    assert.deepEqual(stageRelabels(previous, current), [
      { from: previous.a, to: current.a },
      { from: previous.b, to: current.b },
    ]);
  });
});

describe("mapDeal", () => {
  it("maps an open deal: stage, probability, dates, owner", () => {
    const d = mapDeal(hsDeal("9001", {}), lookup());
    assert.equal(d.externalId, "9001");
    assert.equal(d.name, "Brightwater platform license");
    assert.equal(d.type, "SALES");
    assert.equal(d.status, "OPEN");
    assert.equal(d.stage, "Negotiation");
    assert.equal(d.stageOrder, 3);
    assert.equal(d.probability, 70);
    assert.equal(d.value, 1_400_000);
    assert.equal(d.pipeline, "Pharma sales");
    assert.equal(d.expectedClose?.toISOString(), "2026-11-14T00:00:00.000Z");
    assert.equal(d.nextStep, "Send redlined MSA");
    assert.equal(d.hubspotOwnerId, "501");
    assert.equal(d.modifiedAt?.toISOString(), "2026-10-07T16:00:00.000Z");
    assert.equal(d.lastActivityAt?.toISOString(), "2026-10-07T15:59:00.000Z", "a stage move after the last logged activity counts");
    assert.equal(d.createdAt?.toISOString(), "2026-09-01T10:00:00.000Z");
  });

  it("uses notes_last_updated, else hs_lastmodifieddate, as last activity", () => {
    const withNotes = mapDeal(hsDeal("1", { hs_v2_date_entered_current_stage: "2026-09-01T00:00:00Z" }), lookup());
    assert.equal(withNotes.lastActivityAt?.toISOString(), "2026-10-05T12:00:00.000Z");
    const noNotes = mapDeal(hsDeal("1", { notes_last_updated: null, hs_v2_date_entered_current_stage: null }), lookup());
    assert.equal(noNotes.lastActivityAt?.toISOString(), "2026-10-07T16:00:00.000Z");
  });

  it("sets 100% when won and 0% when lost; HubSpot's closed flags win", () => {
    assert.deepEqual(pick(mapDeal(hsDeal("1", { dealstage: "closedwon" }), lookup())), { status: "WON", probability: 100 });
    assert.deepEqual(pick(mapDeal(hsDeal("1", { dealstage: "closedlost" }), lookup())), { status: "LOST", probability: 0 });
    assert.deepEqual(pick(mapDeal(hsDeal("1", { dealstage: "qualified", hs_is_closed_won: "true" }), lookup())), { status: "WON", probability: 100 });
    assert.deepEqual(pick(mapDeal(hsDeal("1", { dealstage: "negotiation", hs_is_closed_lost: "false" }), lookup())), { status: "OPEN", probability: 70 });
  });

  it("types deals by pipeline and falls back when the stage is unknown", () => {
    const investor = mapDeal(hsDeal("2", { dealstage: "1002", pipeline: "778899", amount: "2500000" }), lookup());
    assert.deepEqual({ type: investor.type, stage: investor.stage, probability: investor.probability, pipeline: investor.pipeline }, { type: "FUNDRAISING", stage: "Term sheet", probability: 80, pipeline: "Series B" });
    assert.equal(mapDeal(hsDeal("2", { dealstage: "1002", pipeline: "778899" }), lookup({ "778899": "PARTNERSHIP" })).type, "PARTNERSHIP");

    const orphan = mapDeal(hsDeal("3", { dealstage: "gone", pipeline: "default", hs_deal_stage_probability: "0.35", dealname: null, amount: "" }), lookup());
    assert.deepEqual(
      { stage: orphan.stage, status: orphan.status, probability: orphan.probability, name: orphan.name, value: orphan.value },
      { stage: "gone", status: "OPEN", probability: 35, name: "HubSpot deal 3", value: null },
    );
  });

  it("prefers the amount in company currency", () => {
    assert.equal(mapDeal(hsDeal("4", { amount: "1000000", amount_in_home_currency: "1085000.5" }), lookup()).value, 1_085_000.5);
  });

  it("reads close dates as calendar days", () => {
    assert.equal(closeDay("2026-11-14T00:00:00Z", "America/Los_Angeles")?.toISOString(), "2026-11-14T00:00:00.000Z", "date-picker values are midnight UTC");
    assert.equal(closeDay("2026-11-14T03:30:00Z", "America/Los_Angeles")?.toISOString(), "2026-11-13T00:00:00.000Z", "instants count on the portal's day");
    assert.equal(closeDay("1794614400000", "UTC")?.toISOString(), "2026-11-14T00:00:00.000Z", "epoch milliseconds");
    assert.equal(closeDay("2026-11-14", "UTC")?.toISOString(), "2026-11-14T00:00:00.000Z");
    assert.equal(closeDay(null, "UTC"), null);
    assert.equal(closeDay("soon", "UTC"), null);
  });

  it("chooses the company type from the deal", () => {
    assert.equal(companyTypeFor("FUNDRAISING", "OPEN"), "INVESTOR");
    assert.equal(companyTypeFor("PARTNERSHIP", "WON"), "PARTNER");
    assert.equal(companyTypeFor("SALES", "WON"), "CUSTOMER");
    assert.equal(companyTypeFor("SALES", "OPEN"), "PROSPECT");
    assert.equal(companyTypeFor("SALES", "LOST"), "PROSPECT");
  });
});

function pick(d: MappedDeal) {
  return { status: d.status, probability: d.probability };
}

describe("decideDealSignals", () => {
  const since = new Date("2026-10-07T11:55:00Z").getTime();
  const stored = { stage: "Proposal", pipeline: "Pharma sales", status: "OPEN" as const, stageOrder: 2 };

  it("stays quiet on the first sync", () => {
    const deal = mapDeal(hsDeal("1", { createdate: "2026-10-08T09:00:00Z" }), lookup());
    assert.deepEqual(decideDealSignals({ deal, previous: null, initial: true, newSince: null, now: NOW }), []);
    assert.deepEqual(decideDealSignals({ deal, previous: stored, initial: true, newSince: null, now: NOW }), []);
  });

  it("signals a stage move with stageFrom/stageTo and a summary", () => {
    const deal = mapDeal(hsDeal("9001", {}), lookup());
    const [s, ...rest] = decideDealSignals({ deal, previous: stored, initial: false, newSince: since, now: NOW });
    assert.equal(rest.length, 0);
    assert.equal(s.externalId, "hubspot:deal:9001:stage:negotiation");
    assert.equal(s.title, "Deal advanced: Brightwater platform license → Negotiation");
    assert.equal(s.occurredAt.toISOString(), "2026-10-07T15:59:00.000Z");
    assert.equal(s.metadata.signalType, "deal_stage_change");
    assert.equal(s.metadata.stageFrom, "Proposal");
    assert.equal(s.metadata.stageTo, "Negotiation");
    assert.equal(s.metadata.importance, 3);
    assert.equal(s.metadata.summary, "$1.4M at 70% · expected close Nov 14");
    assert.equal(s.metadata.recommendation, undefined);
    assert.ok(!("recommendation" in s.metadata), "undefined keys are dropped from metadata");
    assert.match(s.body ?? "", /Proposal → Negotiation\. Next step: Send redlined MSA/);
  });

  it("weights fundraising moves higher and flags moves backwards", () => {
    const investor = mapDeal(hsDeal("2", { dealstage: "1002", pipeline: "778899" }), lookup());
    const [up] = decideDealSignals({ deal: investor, previous: { stage: "Intro", pipeline: "Series B", status: "OPEN", stageOrder: 0 }, initial: false, newSince: since, now: NOW });
    assert.equal(up.metadata.importance, 4);
    assert.equal(up.title, "Investor advanced: Brightwater platform license → Term sheet");

    const back = mapDeal(hsDeal("3", { dealstage: "qualified" }), lookup());
    const [down] = decideDealSignals({ deal: back, previous: { ...stored, stage: "Negotiation", stageOrder: 3 }, initial: false, newSince: since, now: NOW });
    assert.equal(down.title, "Deal moved back: Brightwater platform license → Qualified");
    assert.match(String(down.metadata.recommendation), /what changed/);
  });

  it("signals wins and losses at importance 4", () => {
    const won = mapDeal(hsDeal("5", { dealstage: "closedwon" }), lookup());
    const [w] = decideDealSignals({ deal: won, previous: stored, initial: false, newSince: since, now: NOW });
    assert.equal(w.metadata.signalType, "deal_won");
    assert.equal(w.metadata.importance, 4);
    assert.equal(w.externalId, "hubspot:deal:5:stage:closedwon");
    assert.equal(w.title, "Won: Brightwater platform license ($1.4M)");
    assert.equal(w.metadata.summary, "$1.4M · closed Nov 14");

    const lost = mapDeal(hsDeal("6", { dealstage: "1004", pipeline: "778899", closed_lost_reason: "Too early for their fund" }), lookup());
    const [l] = decideDealSignals({ deal: lost, previous: { stage: "Term sheet", pipeline: "Series B", status: "OPEN", stageOrder: 1 }, initial: false, newSince: since, now: NOW });
    assert.equal(l.metadata.signalType, "deal_lost");
    assert.equal(l.metadata.importance, 4);
    assert.equal(l.title, "Investor passed: Brightwater platform license ($1.4M)");
    assert.equal(l.metadata.summary, "$1.4M · reason: Too early for their fund");
  });

  it("ignores unchanged stages and moves between closed stages of the same outcome", () => {
    const deal = mapDeal(hsDeal("7", {}), lookup());
    assert.deepEqual(decideDealSignals({ deal, previous: { ...stored, stage: "Negotiation" }, initial: false, newSince: since, now: NOW }), []);
    const lostAgain = mapDeal(hsDeal("7", { dealstage: "closedlost" }), lookup());
    assert.deepEqual(decideDealSignals({ deal: lostAgain, previous: { ...stored, stage: "Lost (old)", status: "LOST" }, initial: false, newSince: since, now: NOW }), []);
  });

  it("signals deals created since the cursor as opportunities", () => {
    const fresh = mapDeal(hsDeal("8", { createdate: "2026-10-08T09:00:00Z", dealstage: "qualified" }), lookup());
    const [o] = decideDealSignals({ deal: fresh, previous: null, initial: false, newSince: since, now: NOW });
    assert.equal(o.externalId, "hubspot:deal:8:created");
    assert.equal(o.metadata.signalType, "opportunity");
    assert.equal(o.metadata.importance, 3);
    assert.equal(o.title, "New deal: Brightwater platform license ($1.4M)");
    assert.equal(o.occurredAt.toISOString(), "2026-10-08T09:00:00.000Z");

    const investor = mapDeal(hsDeal("9", { createdate: "2026-10-08T09:00:00Z", dealstage: "1001", pipeline: "778899", amount: null }), lookup());
    assert.equal(decideDealSignals({ deal: investor, previous: null, initial: false, newSince: since, now: NOW })[0].title, "New investor conversation: Brightwater platform license");

    const old = mapDeal(hsDeal("10", { createdate: "2025-01-01T00:00:00Z" }), lookup());
    assert.deepEqual(decideDealSignals({ deal: old, previous: null, initial: false, newSince: since, now: NOW }), [], "an old deal seen for the first time is imported quietly");

    const wonOnCreate = mapDeal(hsDeal("11", { createdate: "2026-10-08T09:00:00Z", dealstage: "closedwon" }), lookup());
    assert.equal(decideDealSignals({ deal: wonOnCreate, previous: null, initial: false, newSince: since, now: NOW })[0].metadata.signalType, "deal_won");
  });

  it("never dates a signal in the future", () => {
    const deal = mapDeal(hsDeal("12", { hs_v2_date_entered_current_stage: "2026-10-09T00:00:00Z" }), lookup());
    assert.equal(decideDealSignals({ deal, previous: stored, initial: false, newSince: since, now: NOW })[0].occurredAt.toISOString(), NOW.toISOString());
  });

  it("summarizes deals with partial data", () => {
    assert.equal(dealSummary({ value: null, probability: 40, status: "OPEN", expectedClose: null, lostReason: null }), "40% probability");
    assert.equal(dealSummary({ value: 250_000, probability: null, status: "OPEN", expectedClose: null, lostReason: null }), "$250K");
    assert.equal(dealSummary({ value: null, probability: null, status: "LOST", expectedClose: null, lostReason: null }), undefined);
  });

  it("compares stage and pipeline", () => {
    assert.equal(stageChanged(null, { stage: "A", pipeline: "P" }), false);
    assert.equal(stageChanged({ stage: "A", pipeline: "P" }, { stage: "A", pipeline: "P" }), false);
    assert.equal(stageChanged({ stage: "A", pipeline: "P" }, { stage: "B", pipeline: "P" }), true);
    assert.equal(stageChanged({ stage: "A", pipeline: "P" }, { stage: "A", pipeline: "Q" }), true);
  });
});

// ─── HTTP ────────────────────────────────────────────────────────────────────

// Deliberately not shaped like a real HubSpot key, so secret scanners stay quiet.
const KEY = "test-hubspot-service-key-0123456789";

describe("hubspotConnector.verifyKey", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("returns the portal and confirmed scopes, sending the key as a Bearer token", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /api\.hubapi\.com\/account-info\/v3\/details$/, () => json({ portalId: 4455667, accountType: "STANDARD", uiDomain: "app-eu1.hubspot.com", timeZone: "Europe/Berlin", companyCurrency: "USD" })],
        ["GET", /\/crm\/v3\/objects\/deals$/, () => json({ results: [] })],
        ["GET", /\/crm\/v3\/objects\/companies$/, () => json({ results: [] })],
        ["GET", /\/crm\/v3\/owners$/, () => json({ results: [] })],
      ]),
    );
    restore = stub.restore;
    const v = await hubspotConnector.verifyKey!(KEY);
    assert.deepEqual(v, {
      accountName: "HubSpot 4455667",
      externalAccountId: "4455667",
      settings: { portalId: "4455667", uiDomain: "app-eu1.hubspot.com", timeZone: "Europe/Berlin", currency: "USD" },
      scopes: ["crm.objects.deals.read", "crm.objects.companies.read", "crm.objects.owners.read"],
    });
    assert.equal(stub.requests.length, 4);
    for (const r of stub.requests) assert.equal(r.headers.get("authorization"), `Bearer ${KEY}`);
    assert.equal(stub.requests[1].url.searchParams.get("limit"), "1");
    assert.ok(!JSON.stringify(v).includes(KEY));
  });

  it("rejects a revoked or unknown key (401) without echoing it", async () => {
    const stub = stubFetch(() => json({ status: "error", category: "INVALID_AUTHENTICATION" }, { status: 401 }));
    restore = stub.restore;
    await assert.rejects(hubspotConnector.verifyKey!(KEY), (error: Error) => {
      assert.ok(error instanceof KeyRejectedError);
      assert.match(error.message, /^HubSpot rejected the key\. Create a service key in HubSpot → Development → Keys → Service keys/);
      assert.ok(!error.message.includes(KEY));
      return true;
    });
    assert.equal(stub.requests.length, 1, "no refresh for a key");
  });

  it("names the missing scopes (403)", async () => {
    const missingScopes = { status: "error", category: "MISSING_SCOPES", errors: [{ message: "One or more of the following scopes are required.", context: { requiredGranularScopes: ["x"] } }] };
    const stub = stubFetch(
      routes([
        ["GET", /\/account-info\/v3\/details$/, () => json(missingScopes, { status: 403 })],
        ["GET", /\/crm\/v3\/objects\/deals$/, () => json({ results: [] })],
        ["GET", /\/crm\/v3\/objects\/companies$/, () => json(missingScopes, { status: 403 })],
        ["GET", /\/crm\/v3\/owners$/, () => json(missingScopes, { status: 403 })],
      ]),
    );
    restore = stub.restore;
    await assert.rejects(hubspotConnector.verifyKey!(KEY), (error: Error) => {
      assert.ok(error instanceof KeyRejectedError);
      assert.equal(
        error.message,
        "The HubSpot key is missing the scopes crm.objects.companies.read, crm.objects.owners.read. Add them to the service key in HubSpot → Development → Keys → Service keys, then connect again.",
      );
      return true;
    });
  });

  it("accepts a key that cannot read account details", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /\/account-info\/v3\/details$/, () => json({ status: "error", category: "MISSING_SCOPES" }, { status: 403 })],
        ["GET", /\/crm\/v3\/(objects\/(deals|companies)|owners)$/, () => json({ results: [] })],
      ]),
    );
    restore = stub.restore;
    const v = await hubspotConnector.verifyKey!(KEY);
    assert.deepEqual({ accountName: v.accountName, externalAccountId: v.externalAccountId, settings: v.settings }, { accountName: null, externalAccountId: null, settings: {} });
  });
});

describe("HubSpot reads", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("reads deal pipelines", async () => {
    const stub = stubFetch(routes([["GET", /\/crm\/v3\/pipelines\/deals$/, () => json({ results: PIPELINES })]]));
    restore = stub.restore;
    const pipelines = await fetchPipelines(fakeContext({ provider: "HUBSPOT" }));
    assert.deepEqual(pipelines.map((p) => [p.id, p.stages.length]), [
      ["default", 5],
      ["778899", 4],
    ]);
  });

  it("pages owners, active then deactivated", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/crm\/v3\/owners$/,
          (req) => {
            const archived = req.url.searchParams.get("archived");
            if (archived === "true") return json({ results: [{ id: "503", email: "Former@CytoHub.example", archived: true }] });
            return req.url.searchParams.get("after") === "p2"
              ? json({ results: [{ id: "502", email: "priya@cytohub.example" }, { id: "queue", email: null }] })
              : json({ results: [{ id: "501", email: " CEO@cytohub.example " }], paging: { next: { after: "p2" } } });
          },
        ],
      ]),
    );
    restore = stub.restore;
    const owners = await fetchOwners(fakeContext({ provider: "HUBSPOT" }));
    assert.deepEqual([...owners], [
      ["501", "ceo@cytohub.example"],
      ["502", "priya@cytohub.example"],
      ["503", "former@cytohub.example"],
    ]);
    assert.deepEqual(stub.requests.map((r) => `${r.url.searchParams.get("archived")}:${r.url.searchParams.get("after") ?? ""}:${r.url.searchParams.get("limit")}`), ["false::100", "false:p2:100", "true::100"]);
  });

  it("links each deal to its primary company", async () => {
    assert.equal(primaryCompanyId([{ toObjectId: "1", associationTypes: [{ typeId: 341 }] }, { toObjectId: "2", associationTypes: [{ typeId: 5, label: "Primary" }] }]), "2");
    assert.equal(primaryCompanyId([{ toObjectId: "1", associationTypes: [{ typeId: 341, label: null }] }]), "1");
    assert.equal(primaryCompanyId([]), null);

    const stub = stubFetch(
      routes([
        [
          "POST",
          /\/crm\/v4\/associations\/deals\/companies\/batch\/read$/,
          () =>
            json(
              {
                status: "COMPLETE",
                results: [
                  { from: { id: "9001" }, to: [{ toObjectId: 7001, associationTypes: [{ category: "HUBSPOT_DEFINED", typeId: 5, label: "Primary" }] }] },
                  { from: { id: "9002" }, to: [{ toObjectId: 7001, associationTypes: [{ category: "HUBSPOT_DEFINED", typeId: 341, label: null }] }] },
                ],
                numErrors: 1,
                errors: [{ status: "error", category: "OBJECT_NOT_FOUND", context: { fromObjectId: ["9003"] } }],
              },
              { status: 207 },
            ),
        ],
        ["POST", /\/crm\/v3\/objects\/companies\/batch\/read$/, () => json({ status: "COMPLETE", results: [{ id: "7001", properties: { name: "Brightwater Therapeutics", domain: "brightwater.example", hs_object_id: "7001" } }] })],
      ]),
    );
    restore = stub.restore;
    const companies = await fetchDealCompanies(fakeContext({ provider: "HUBSPOT" }), ["9001", "9002", "9003"]);
    assert.deepEqual(companies.get("9001"), { id: "7001", name: "Brightwater Therapeutics", domain: "brightwater.example" });
    assert.equal(companies.get("9002")?.id, "7001");
    assert.equal(companies.has("9003"), false);
    assert.deepEqual(JSON.parse(stub.requests[0].body ?? "{}"), { inputs: [{ id: "9001" }, { id: "9002" }, { id: "9003" }] });
    assert.deepEqual(JSON.parse(stub.requests[1].body ?? "{}"), { properties: ["name", "domain"], inputs: [{ id: "7001" }] });
  });
});

describe("searchDeals", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 12, minute)).toISOString();
  const result = (id: string, minute: number) => ({ id, properties: { dealname: `Deal ${id}`, hs_lastmodifieddate: at(minute) }, createdAt: at(0), updatedAt: at(minute), archived: false });

  async function collect(gen: AsyncGenerator<HubSpotDeal[]>) {
    const pages: string[][] = [];
    for await (const page of gen) pages.push(page.map((d) => d.id));
    return pages;
  }

  it("filters on hs_lastmodifieddate, sorts ascending and pages with after", async () => {
    const stub = stubFetch(
      routes([
        [
          "POST",
          /\/crm\/v3\/objects\/deals\/search$/,
          (req) => {
            const body = JSON.parse(req.body ?? "{}") as { after?: string };
            return body.after === "100" ? json({ total: 101, results: [result("3", 9)] }) : json({ total: 101, results: [result("1", 5), result("2", 7)], paging: { next: { after: "100", link: "https://api.hubapi.com/…" } } });
          },
        ],
      ]),
    );
    restore = stub.restore;
    const since = Date.UTC(2026, 9, 7, 12, 0);
    const pages = await collect(searchDeals(fakeContext({ provider: "HUBSPOT" }), { since, spacingMs: 0 }));
    assert.deepEqual(pages, [["1", "2"], ["3"]]);
    const first = JSON.parse(stub.requests[0].body ?? "{}");
    assert.deepEqual(first.filterGroups, [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(since) }] }]);
    assert.deepEqual(first.sorts, [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }]);
    assert.equal(first.limit, 100);
    assert.ok(first.properties.includes("hs_deal_stage_probability") && first.properties.includes("notes_last_updated") && first.properties.includes("hubspot_owner_id"));
    assert.equal(first.after, undefined);
    assert.equal(JSON.parse(stub.requests[1].body ?? "{}").after, "100");
  });

  it("reads everything on the first sync (no filter)", async () => {
    const stub = stubFetch(routes([["POST", /\/deals\/search$/, () => json({ total: 0, results: [] })]]));
    restore = stub.restore;
    assert.deepEqual(await collect(searchDeals(fakeContext({ provider: "HUBSPOT" }), { since: null, spacingMs: 0 })), []);
    assert.equal(JSON.parse(stub.requests[0].body ?? "{}").filterGroups, undefined);
  });

  it("advances the time window instead of paging past 10,000 results", async () => {
    const bodies: { after?: string; filterGroups?: { filters: { operator: string; value: string }[] }[] }[] = [];
    const stub = stubFetch(
      routes([
        [
          "POST",
          /\/deals\/search$/,
          (req) => {
            const body = JSON.parse(req.body ?? "{}");
            bodies.push(body);
            if (bodies.length === 1) return json({ total: 25_000, results: [result("a", 1), result("b", 2)], paging: { next: { after: "9900" } } });
            if (bodies.length === 2) return json({ total: 25_000, results: [result("c", 3), result("d", 4)], paging: { next: { after: "10000" } } });
            return json({ total: 3, results: [result("d", 4), result("e", 6)] });
          },
        ],
      ]),
    );
    restore = stub.restore;
    const pages = await collect(searchDeals(fakeContext({ provider: "HUBSPOT" }), { since: null, spacingMs: 0 }));
    assert.deepEqual(pages, [["a", "b"], ["c", "d"], ["d", "e"]]);
    assert.equal(bodies[1].after, "9900");
    assert.equal(bodies[2].after, undefined, "a fresh query, not page 101");
    assert.deepEqual(bodies[2].filterGroups?.[0].filters[0], { propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(Date.parse(at(4))) });
    assert.equal(stub.requests.length, 3);
  });

  it("steps past a single timestamp shared by 10,000 deals", async () => {
    const notes: string[] = [];
    let n = 0;
    const stub = stubFetch(
      routes([
        [
          "POST",
          /\/deals\/search$/,
          () => {
            n++;
            if (n === 1) return json({ results: [result("x", 4)], paging: { next: { after: "10000" } } });
            return json({ results: [result("y", 8)] });
          },
        ],
      ]),
    );
    restore = stub.restore;
    const since = Date.parse(at(4));
    const pages = await collect(searchDeals(fakeContext({ provider: "HUBSPOT" }), { since, spacingMs: 0, note: (m) => notes.push(m) }));
    assert.deepEqual(pages, [["x"], ["y"]]);
    const filters = stub.requests.map((r) => JSON.parse(r.body ?? "{}").filterGroups[0].filters[0]);
    assert.deepEqual(filters.map((f: { operator: string; value: string }) => `${f.operator} ${f.value}`), [`GTE ${since}`, `GT ${since}`]);
    assert.equal(notes.length, 1);
  });

  it("spaces search calls to stay under the rate limit", async () => {
    const times: number[] = [];
    const stub = stubFetch(
      routes([
        [
          "POST",
          /\/deals\/search$/,
          (req) => {
            times.push(Date.now());
            const after = Number(JSON.parse(req.body ?? "{}").after ?? 0);
            return json({ results: [result(String(after), 1)], ...(after < 200 ? { paging: { next: { after: String(after + 100) } } } : {}) });
          },
        ],
      ]),
    );
    restore = stub.restore;
    await collect(searchDeals(fakeContext({ provider: "HUBSPOT" }), { since: null, spacingMs: 60 }));
    assert.equal(times.length, 3);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 55, `gap ${times[i] - times[i - 1]}ms`);
  });
});

describe("hubspotConnector.sync", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  function syncContext(): ConnectorSyncContext {
    return {
      http: fakeContext({ provider: "HUBSPOT" }),
      connection: { id: "conn_hs", provider: "HUBSPOT", label: "HubSpot", accountEmail: null, externalAccountId: "4455667", settings: {}, defaultSensitivity: "INTERNAL", syncFrequency: "HOURLY", sourceKey: "hubspot" },
      cursor: null,
      initial: true,
      now: NOW,
      runId: "run_1",
      async saveCursor() {},
      async saveSettings() {},
      count() {},
      note() {},
    } as unknown as ConnectorSyncContext;
  }

  it("turns a missing deals scope into a reconnect-needed error", async () => {
    const stub = stubFetch(routes([["GET", /\/crm\/v3\/pipelines\/deals$/, () => json({ status: "error", category: "MISSING_SCOPES" }, { status: 403 })]]));
    restore = stub.restore;
    await assert.rejects(hubspotConnector.sync(syncContext()), (error: Error) => {
      assert.ok(error instanceof ProviderAuthError);
      assert.match(error.message, /HubSpot refused access \(GET api\.hubapi\.com\/crm\/v3\/pipelines\/deals → 403 \(MISSING_SCOPES\)\)/);
      assert.match(error.message, /crm\.objects\.deals\.read/);
      return true;
    });
  });

  it("explains a revoked key", async () => {
    const stub = stubFetch(() => json({ status: "error" }, { status: 401 }));
    restore = stub.restore;
    await assert.rejects(hubspotConnector.sync(syncContext()), (error: Error) => error instanceof ProviderAuthError && /HubSpot rejected the key/.test(error.message));
  });
});
