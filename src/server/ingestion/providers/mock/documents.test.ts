import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDocument } from "@/server/ingestion/documents/parse";
import { sha256 } from "@/server/security/crypto";
import type { NormalizedDocumentRef, ProviderContext, SyncCursor } from "../../types";
import { DOCUMENT_FIXTURES, buildDocumentFixtures } from "./document-fixtures";
import { mockDocumentProvider } from "./documents";
import { demoWorldFromSettings } from "./world";

const ANCHOR = "2026-10-06T13:00:00.000Z";
const HOUR = 3_600_000;

function ctxAt(hoursAfterAnchor: number, settings: Record<string, unknown> = { demoAnchor: ANCHOR, timezone: "America/New_York" }): ProviderContext {
  return {
    connection: { id: "conn_demo_docs", provider: "GOOGLE_DRIVE", mode: "DEMO", accountEmail: "ceo@cytohub.example", settings },
    now: new Date(Date.parse(ANCHOR) + hoursAfterAnchor * HOUR),
    getAccessToken: async () => "",
    log: () => {},
  };
}

async function syncAll(hours: number, cursor: SyncCursor | null, pageSize = 50) {
  const items: NormalizedDocumentRef[] = [];
  let c = cursor;
  for (let i = 0; i < 20; i++) {
    const page = await mockDocumentProvider.listChanges(ctxAt(hours), c, { pageSize });
    items.push(...page.items);
    c = page.cursor;
    if (!page.hasMore) break;
  }
  return { items, cursor: c };
}

describe("mock document provider", () => {
  it("first sync returns every document that exists before the anchor, at its latest visible version", async () => {
    const { items, cursor } = await syncAll(0, null);
    const ids = items.map((i) => i.externalId);
    assert.equal(new Set(ids).size, ids.length, "one ref per document");
    assert.ok(ids.includes("demo-doc:series-b-deck"));
    assert.ok(!ids.includes("demo-doc:halvorsen-nda"), "the NDA appears 20 h after the anchor");
    assert.ok(!ids.includes("demo-doc:lumen-recovery"));
    const deck = items.find((i) => i.externalId === "demo-doc:series-b-deck")!;
    assert.equal(deck.versionTag, "rev-1");
    assert.equal(cursor?.revealedUntil, ANCHOR);
    assert.equal(items.length, 12);
  });

  it("pages with a cursor without losing or repeating documents", async () => {
    const paged = await syncAll(0, null, 5);
    const once = await syncAll(0, null, 50);
    assert.deepEqual(paged.items.map((i) => i.externalId).sort(), once.items.map((i) => i.externalId).sort());
  });

  it("later syncs reveal new documents and new versions only", async () => {
    const first = await syncAll(0, null);
    const empty = await syncAll(1, first.cursor);
    assert.equal(empty.items.length, 0);
    const later = await syncAll(7, empty.cursor);
    assert.deepEqual(later.items.map((i) => i.externalId).sort(), ["demo-doc:lumen-recovery", "demo-doc:series-b-deck"]);
    const deck = later.items.find((i) => i.externalId === "demo-doc:series-b-deck")!;
    assert.equal(deck.versionTag, "rev-2");
    const text = (await parseDocument(await deck.download(), { filename: deck.title })).text;
    assert.match(text, /Raising \$40M/);
    const day2 = await syncAll(31, later.cursor);
    assert.deepEqual(day2.items.map((i) => i.externalId).sort(), ["demo-doc:financial-model", "demo-doc:halvorsen-nda"]);
  });

  it("generates deterministic bytes per anchor (re-sync is byte-identical)", async () => {
    const w = demoWorldFromSettings({ demoAnchor: ANCHOR });
    const a = buildDocumentFixtures(w);
    const b = buildDocumentFixtures(demoWorldFromSettings({ demoAnchor: ANCHOR }));
    for (let i = 0; i < a.length; i++) assert.equal(sha256(await a[i].item!.download()), sha256(await b[i].item!.download()), a[i].key);
    const other = buildDocumentFixtures(demoWorldFromSettings({ demoAnchor: "2026-11-02T13:00:00.000Z" }));
    const memo = (f: typeof a) => f.find((x) => x.key === "q4-operating-memo@1")!.item!;
    assert.notEqual(sha256(await memo(a).download()), sha256(await memo(other).download()), "dates inside documents follow the anchor");
  });

  it("covers every format with consistent metadata", () => {
    const refs = buildDocumentFixtures(demoWorldFromSettings({ demoAnchor: ANCHOR }));
    assert.equal(DOCUMENT_FIXTURES.length, 14);
    const types = new Set(refs.map((r) => r.item!.mimeType));
    for (const t of ["application/pdf", "text/csv", "text/markdown", "text/plain", "image/png"]) assert.ok(types.has(t), t);
    for (const r of refs) {
      assert.ok(r.item!.sizeBytes! > 0);
      assert.ok(r.item!.path!.endsWith(r.item!.title));
      assert.ok(r.item!.webUrl!.startsWith("https://drive.example.com/cytohub/"));
      assert.equal(r.revealAt.getTime(), r.item!.modifiedAt.getTime());
    }
  });

  it("fails loudly without a demo anchor", async () => {
    await assert.rejects(mockDocumentProvider.listChanges(ctxAt(0, {}), null, { pageSize: 10 }), /demoAnchor/);
  });
});
