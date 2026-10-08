import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DAY_MS } from "@/lib/dates";
import { fakeContext, json, routes, stubFetch } from "../providers/test-helpers";
import { ProviderAuthError, type PipelineContext } from "../types";
import { type DocusignDeps, type DocusignEnvelope, counterpartyEmail, docusignAccountUrl, envelopeSignals, listEnvelopes, syncDocusign } from "./docusign";
import type { SignalInput } from "./helpers";
import type { ConnectorSyncContext, SyncCounter } from "./types";

const NOW = new Date("2026-10-08T12:00:00Z");
const CEO = "ceo@cytohub.example";
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS).toISOString();

function envelope(overrides: Partial<DocusignEnvelope> = {}): DocusignEnvelope {
  return {
    envelopeId: "env-1",
    status: "sent",
    emailSubject: "Brightwater MSA v5",
    sentDateTime: daysAgo(2),
    statusChangedDateTime: daysAgo(2),
    sender: { userName: "Karen Liu", email: "karen@brightwater.example" },
    recipients: {
      signers: [
        { name: "Karen Liu", email: "karen@brightwater.example", status: "completed", routingOrder: "1" },
        { name: "Alex Rivera", email: "CEO@cytohub.example", status: "delivered", routingOrder: "2", sentDateTime: daysAgo(1) },
      ],
    },
    ...overrides,
  };
}

const opts = (o: Partial<Parameters<typeof envelopeSignals>[1]> = {}) => ({ ceoEmail: CEO, now: NOW, initial: false, stallDays: 7, ...o });

describe("envelopeSignals", () => {
  it("asks the CEO to sign when their own signature is pending, on the first sync too", () => {
    for (const initial of [true, false]) {
      const [s, ...rest] = envelopeSignals(envelope(), opts({ initial }));
      assert.equal(rest.length, 0);
      assert.equal(s.externalId, "docusign:env-1:awaiting-ceo");
      assert.equal(s.kind, "DOCUMENT");
      assert.equal(s.title, "Waiting for your signature: Brightwater MSA v5");
      assert.equal(s.occurredAt.toISOString(), daysAgo(1));
      assert.equal(s.metadata?.signalType, "approval_request");
      assert.equal(s.metadata?.requiresCeo, true);
      assert.equal(s.metadata?.importance, 4);
      assert.equal(s.metadata?.urgency, 4);
      assert.equal(s.metadata?.recommendedAction, "Review and sign in DocuSign");
      assert.match(s.metadata?.whyCeo ?? "", /You are a signer/);
      assert.equal(s.personEmail, "karen@brightwater.example");
      assert.equal(s.counterpartyEmail, "karen@brightwater.example");
    }
  });

  it("stays quiet when it is not yet the CEO's turn, or the CEO already signed", () => {
    const notYet = envelope({
      recipients: { signers: [{ name: "Karen", email: "karen@brightwater.example", status: "sent", routingOrder: "1" }, { name: "CEO", email: CEO, status: "created", routingOrder: "2" }] },
    });
    assert.deepEqual(envelopeSignals(notYet, opts()), []);
    const signed = envelope({ recipients: { signers: [{ name: "CEO", email: CEO, status: "completed", routingOrder: "1" }] } });
    assert.deepEqual(envelopeSignals(signed, opts()), []);
    assert.deepEqual(envelopeSignals(envelope(), opts({ ceoEmail: null })), []);
  });

  it("flags envelopes the CEO sent that are unsigned after stallDays", () => {
    const env = envelope({
      sentDateTime: daysAgo(10),
      sender: { userName: "Alex Rivera", email: CEO },
      recipients: {
        signers: [
          { name: "Karen Liu", email: "karen@brightwater.example", status: "delivered", routingOrder: "1" },
          { name: "Sam Ortiz", email: "sam@brightwater.example", status: "created", routingOrder: "2" },
        ],
      },
    });
    const [s, ...rest] = envelopeSignals(env, opts({ initial: true }));
    assert.equal(rest.length, 0);
    assert.equal(s.externalId, "docusign:env-1:stalled");
    assert.equal(s.title, "Unsigned for 10 days: Brightwater MSA v5 (waiting on Karen Liu)");
    assert.equal(s.metadata?.signalType, "risk");
    assert.equal(s.metadata?.importance, 3);
    assert.match(s.metadata?.recommendation ?? "", /^Nudge Karen Liu or resend/);
    assert.equal(s.occurredAt.toISOString(), daysAgo(3), "became stalled stallDays after sending");
    assert.equal(s.personEmail, "karen@brightwater.example");

    assert.deepEqual(envelopeSignals({ ...env, sentDateTime: daysAgo(5) }, opts()), [], "not stalled yet");
    assert.equal(envelopeSignals({ ...env, sentDateTime: daysAgo(5) }, opts({ stallDays: 3 })).length, 1, "stallDays is configurable");
    assert.deepEqual(envelopeSignals({ ...env, sender: { userName: "Karen", email: "karen@brightwater.example" } }, opts()), [], "only envelopes the CEO sent");
  });

  it("does not report a stall when only the CEO's own signature is missing", () => {
    const env = envelope({
      sentDateTime: daysAgo(10),
      sender: { userName: "Alex Rivera", email: CEO },
      recipients: { signers: [{ name: "Karen", email: "karen@brightwater.example", status: "completed", routingOrder: "1" }, { name: "Alex", email: CEO, status: "sent", routingOrder: "2" }] },
    });
    assert.deepEqual(
      envelopeSignals(env, opts()).map((s) => s.externalId),
      ["docusign:env-1:awaiting-ceo"],
    );
  });

  it("reports completions, declines and voids", () => {
    const completed = envelopeSignals(envelope({ status: "completed", completedDateTime: daysAgo(1) }), opts());
    assert.equal(completed.length, 1);
    assert.equal(completed[0].externalId, "docusign:env-1:completed");
    assert.equal(completed[0].title, "Signed: Brightwater MSA v5");
    assert.equal(completed[0].metadata?.signalType, "development");
    assert.equal(completed[0].metadata?.importance, 3);
    assert.equal(completed[0].occurredAt.toISOString(), daysAgo(1));
    assert.equal(completed[0].personEmail, "karen@brightwater.example");

    const declined = envelopeSignals(
      envelope({
        status: "declined",
        declinedDateTime: daysAgo(1),
        recipients: { signers: [{ name: "Karen Liu", email: "karen@brightwater.example", status: "declined", routingOrder: "1", declinedReason: "Clause 7.3 is not acceptable" }] },
      }),
      opts(),
    );
    assert.equal(declined[0].externalId, "docusign:env-1:declined");
    assert.equal(declined[0].title, "Declined: Brightwater MSA v5 — Karen Liu, Clause 7.3 is not acceptable");
    assert.equal(declined[0].metadata?.signalType, "risk");
    assert.equal(declined[0].metadata?.importance, 4);
    assert.equal(declined[0].personEmail, "karen@brightwater.example");

    const voided = envelopeSignals(envelope({ status: "voided", voidedDateTime: daysAgo(1), voidedReason: "Wrong version" }), opts());
    assert.equal(voided[0].externalId, "docusign:env-1:voided");
    assert.equal(voided[0].title, "Voided: Brightwater MSA v5 — Wrong version");
    assert.equal(voided[0].metadata?.signalType, "risk");
    assert.equal(voided[0].metadata?.importance, 3);
  });

  it("keeps older history quiet on the first sync, but not afterwards", () => {
    const old = envelope({ status: "completed", completedDateTime: daysAgo(30), statusChangedDateTime: daysAgo(30) });
    assert.deepEqual(envelopeSignals(old, opts({ initial: true })), []);
    assert.equal(envelopeSignals(old, opts({ initial: false })).length, 1);
    const recentDecline = envelope({ status: "declined", statusChangedDateTime: daysAgo(6), recipients: { signers: [{ name: "Karen", email: "k@x.example", status: "declined" }] } });
    assert.equal(envelopeSignals(recentDecline, opts({ initial: true })).length, 1, "status changes within 7 days still count");
    assert.deepEqual(envelopeSignals(envelope({ status: "voided", voidedDateTime: daysAgo(8) }), opts({ initial: true })), []);
  });

  it("ignores drafts and unknown statuses", () => {
    assert.deepEqual(envelopeSignals(envelope({ status: "created" }), opts()), []);
    assert.deepEqual(envelopeSignals(envelope({ status: null }), opts()), []);
  });
});

describe("counterpartyEmail", () => {
  it("is the first outside signer in routing order, else an outside sender", () => {
    const env = envelope({
      sender: { userName: "Priya", email: "priya@cytohub.example" },
      recipients: {
        signers: [
          { name: "Later", email: "later@acme.example", status: "created", routingOrder: "3" },
          { name: "Priya", email: "priya@cytohub.example", status: "completed", routingOrder: "1" },
          { name: "First", email: "first@brightwater.example", status: "sent", routingOrder: "2" },
        ],
      },
    });
    assert.equal(counterpartyEmail(env, CEO), "first@brightwater.example");
    assert.equal(counterpartyEmail(envelope({ recipients: { signers: [{ name: "CEO", email: CEO, status: "sent" }] } }), CEO), "karen@brightwater.example");
    assert.equal(counterpartyEmail(envelope({ sender: { email: CEO }, recipients: { signers: [{ email: "priya@cytohub.example" }] } }), CEO), null);
  });
});

describe("docusignAccountUrl", () => {
  it("re-validates the stored API host and account id", () => {
    assert.equal(docusignAccountUrl({ accountId: "1f2e3d4c-aaaa-bbbb-cccc-1234567890ab", baseUri: "https://na3.docusign.net" }), "https://na3.docusign.net/restapi/v2.1/accounts/1f2e3d4c-aaaa-bbbb-cccc-1234567890ab");
    assert.throws(() => docusignAccountUrl({}), ProviderAuthError);
    assert.throws(() => docusignAccountUrl({ accountId: "abc", baseUri: "https://evil.example" }), /Reconnect DocuSign/);
    assert.throws(() => docusignAccountUrl({ accountId: "../x", baseUri: "https://na3.docusign.net" }), ProviderAuthError);
  });
});

// ─── HTTP ────────────────────────────────────────────────────────────────────

const SETTINGS = { accountId: "acct-123", baseUri: "https://na3.docusign.net" };
const ACCOUNT_URL = "https://na3.docusign.net/restapi/v2.1/accounts/acct-123";

function syncContext(over: Partial<ConnectorSyncContext> = {}) {
  const counts: Record<SyncCounter, number> = { fetched: 0, created: 0, updated: 0, unchanged: 0, failed: 0 };
  const cursors: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const ctx: ConnectorSyncContext = {
    pipeline: {} as PipelineContext,
    http: fakeContext({ provider: "DOCUSIGN" }, { now: NOW }),
    connection: {
      id: "conn_ds",
      provider: "DOCUSIGN",
      label: "DocuSign",
      accountEmail: CEO,
      externalAccountId: "acct-123",
      settings: SETTINGS,
      defaultSensitivity: "CONFIDENTIAL",
      syncFrequency: "HOURLY",
      sourceKey: "docusign",
    },
    runId: "run_test",
    now: NOW,
    cursor: null,
    initial: true,
    async saveCursor(c) {
      cursors.push(c);
    },
    async saveSettings() {},
    count(counter, by = 1) {
      counts[counter] += by;
    },
    note(message) {
      notes.push(message);
    },
    ...over,
  };
  return { ctx, counts, cursors, notes };
}

function fakeDeps() {
  const emitted: SignalInput[] = [];
  const seen = new Set<string>();
  const companyLookups: string[] = [];
  const deps: DocusignDeps = {
    async emitSignal(_ctx, input) {
      emitted.push(input);
      if (seen.has(input.externalId)) return "unchanged";
      seen.add(input.externalId);
      return "created";
    },
    async findPersonByEmail(email) {
      return email === "karen@brightwater.example" ? "person_karen" : null;
    },
    async findCompanyIdByDomain(domain) {
      companyLookups.push(domain);
      return domain === "brightwater.example" ? "company_brightwater" : null;
    },
  };
  return { deps, emitted, companyLookups };
}

describe("listEnvelopes", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("pages with start_position until totalSetSize", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /na3\.docusign\.net\/restapi\/v2\.1\/accounts\/acct-123\/envelopes$/,
          (req) => {
            const start = Number(req.url.searchParams.get("start_position"));
            const ids = start < 4 ? [start, start + 1] : [start];
            return json({
              envelopes: ids.map((i) => ({ envelopeId: `e${i}`, status: "sent" })),
              resultSetSize: String(ids.length),
              totalSetSize: "5",
              startPosition: String(start),
              endPosition: String(start + ids.length - 1),
            });
          },
        ],
      ]),
    );
    restore = stub.restore;
    const pages = [];
    for await (const page of listEnvelopes({ http: fakeContext() }, ACCOUNT_URL, { from_date: "2026-07-10T12:00:00.000Z" }, { pageSize: 2 })) pages.push(page);
    assert.deepEqual(
      pages.map((p) => p.envelopes.map((e) => e.envelopeId)),
      [["e0", "e1"], ["e2", "e3"], ["e4"]],
    );
    assert.deepEqual(
      stub.requests.map((r) => r.url.searchParams.get("start_position")),
      ["0", "2", "4"],
    );
    const q = stub.requests[0].url.searchParams;
    assert.equal(q.get("from_date"), "2026-07-10T12:00:00.000Z");
    assert.equal(q.get("include"), "recipients");
    assert.equal(q.get("order_by"), "last_modified");
    assert.equal(q.get("order"), "asc");
    assert.equal(q.get("count"), "2");
    assert.equal(stub.requests[0].headers.get("authorization"), "Bearer access-token");
  });

  it("follows nextUri when totals are missing, skips malformed entries and stops on an empty page", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/envelopes$/,
          (req) =>
            req.url.searchParams.get("start_position") === "0"
              ? json({ envelopes: [{ envelopeId: "a" }, { status: "sent" }], nextUri: "/restapi/v2.1/accounts/acct-123/envelopes?start_position=2" })
              : json({ resultSetSize: "0", totalSetSize: "0", endPosition: "-1" }),
        ],
      ]),
    );
    restore = stub.restore;
    const pages = [];
    for await (const page of listEnvelopes({ http: fakeContext() }, ACCOUNT_URL, { from_date: "x" }, { pageSize: 2 })) pages.push(page);
    assert.equal(pages.length, 2);
    assert.deepEqual(pages[0].envelopes.map((e) => e.envelopeId), ["a"]);
    assert.equal(pages[0].skipped, 1);
    assert.equal(stub.requests[1].url.searchParams.get("start_position"), "2");
  });

  it("marks the last allowed page as truncated", async () => {
    const stub = stubFetch(routes([["GET", /\/envelopes$/, () => json({ envelopes: [{ envelopeId: "a" }], totalSetSize: "100", endPosition: "0" })]]));
    restore = stub.restore;
    const pages = [];
    for await (const page of listEnvelopes({ http: fakeContext() }, ACCOUNT_URL, { from_date: "x" }, { pageSize: 1, maxPages: 1 })) pages.push(page);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].truncated, true);
  });
});

describe("syncDocusign", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  const changed = [
    envelope(),
    envelope({ envelopeId: "env-2", status: "completed", completedDateTime: daysAgo(2), statusChangedDateTime: daysAgo(2) }),
    envelope({ envelopeId: "env-3", status: "completed", completedDateTime: daysAgo(40), statusChangedDateTime: "2026-08-29T09:30:00.1230000Z" }),
    envelope({
      envelopeId: "env-4",
      status: "sent",
      sentDateTime: daysAgo(12),
      statusChangedDateTime: daysAgo(12),
      sender: { userName: "Alex", email: CEO },
      recipients: { signers: [{ name: "Jo", email: "jo@newco.example", status: "sent", routingOrder: "1" }] },
    }),
  ];

  it("first sync: reads the last 90 days, signals current state, links existing companies only, saves the cursor", async () => {
    const stub = stubFetch(routes([["GET", /\/envelopes$/, () => json({ envelopes: changed, totalSetSize: "4", endPosition: "3" })]]));
    restore = stub.restore;
    const { ctx, counts, cursors } = syncContext();
    const { deps, emitted, companyLookups } = fakeDeps();
    await syncDocusign(ctx, deps);

    assert.equal(stub.requests.length, 1, "no outstanding pass on the first sync");
    assert.equal(stub.requests[0].url.searchParams.get("from_date"), daysAgo(90));
    assert.deepEqual(
      emitted.map((s) => s.externalId),
      ["docusign:env-1:awaiting-ceo", "docusign:env-2:completed", "docusign:env-4:stalled"],
      "the 40-day-old completion stays quiet",
    );
    assert.equal(emitted[0].companyId, "company_brightwater");
    assert.equal(emitted[0].personId, "person_karen");
    assert.equal(emitted[2].companyId, null, "unknown domains are not created");
    assert.ok(!companyLookups.includes("cytohub.example"), "the CEO's own domain is never a counterparty");
    assert.deepEqual(counts, { fetched: 4, created: 3, updated: 0, unchanged: 1, failed: 0 });
    assert.deepEqual(cursors.at(-1), { since: daysAgo(2) });
  });

  it("later syncs: read from the cursor, then re-check envelopes still out for signature", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/envelopes$/,
          (req) =>
            req.url.searchParams.get("status") === "sent,delivered"
              ? json({ envelopes: [changed[0], changed[3]], totalSetSize: "2", endPosition: "1" })
              : json({ envelopes: [changed[1]], totalSetSize: "1", endPosition: "0" }),
        ],
      ]),
    );
    restore = stub.restore;
    const { ctx, counts, cursors } = syncContext({ cursor: { since: daysAgo(3) }, initial: false });
    const { deps, emitted } = fakeDeps();
    await syncDocusign(ctx, deps);

    assert.equal(stub.requests[0].url.searchParams.get("from_date"), daysAgo(3));
    assert.equal(stub.requests[1].url.searchParams.get("status"), "sent,delivered");
    assert.equal(stub.requests[1].url.searchParams.get("from_date"), daysAgo(90));
    assert.deepEqual(
      emitted.map((s) => s.externalId),
      ["docusign:env-2:completed", "docusign:env-1:awaiting-ceo", "docusign:env-4:stalled"],
    );
    assert.equal(counts.fetched, 3);
    assert.deepEqual(cursors.at(-1), { since: daysAgo(2) });
  });

  it("keeps the cursor when nothing changed and counts repeats as unchanged", async () => {
    const stub = stubFetch(routes([["GET", /\/envelopes$/, () => json({ envelopes: [changed[1]], totalSetSize: "1", endPosition: "0" })]]));
    restore = stub.restore;
    const { deps } = fakeDeps();
    const first = syncContext({ cursor: { since: daysAgo(1) }, initial: false });
    await syncDocusign(first.ctx, deps);
    const second = syncContext({ cursor: { since: daysAgo(1) }, initial: false });
    await syncDocusign(second.ctx, deps);
    assert.equal(second.counts.created, 0);
    assert.equal(second.counts.unchanged, 1);
    assert.deepEqual(second.cursors.at(-1), { since: daysAgo(1) });
  });

  it("asks for a reconnect when the account settings are missing", async () => {
    const stub = stubFetch(() => null);
    restore = stub.restore;
    const { ctx } = syncContext();
    ctx.connection.settings = {};
    await assert.rejects(syncDocusign(ctx, fakeDeps().deps), ProviderAuthError);
    assert.equal(stub.requests.length, 0);
  });

  it("turns a rejected token into ProviderAuthError after one refresh", async () => {
    const stub = stubFetch(() => new Response(null, { status: 401 }));
    restore = stub.restore;
    const { ctx } = syncContext();
    await assert.rejects(syncDocusign(ctx, fakeDeps().deps), ProviderAuthError);
    assert.equal(stub.requests.length, 2);
  });
});
