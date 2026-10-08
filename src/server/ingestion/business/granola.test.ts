import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { DAY_MS } from "@/lib/dates";
import { fakeContext, json, routes, stubFetch } from "../providers/test-helpers";
import { ProviderAuthError, type PipelineContext } from "../types";
import {
  type GranolaDeps,
  type GranolaNote,
  MAX_TRANSCRIPT_CHARS,
  granolaAttendees,
  granolaMeetingNote,
  granolaNoteText,
  pacer,
  syncGranola,
  transcriptText,
  verifyGranolaKey,
} from "./granola";
import type { MeetingNoteInput } from "./meeting-notes";
import { type ConnectorSyncContext, KeyRejectedError, type SyncCounter } from "./types";

const NOW = new Date("2026-10-08T12:00:00Z");
const SUMMARY = "Brightwater agreed to the pilot scope. Karen will send the redlined MSA by Friday; we owe pricing for phase two.";

function note(overrides: Partial<GranolaNote> = {}): GranolaNote {
  return {
    id: "not_1d3tmYTlCICgjy",
    title: "Brightwater pilot review",
    owner: { name: "Alex Rivera", email: "ceo@cytohub.example" },
    created_at: "2026-10-06T15:05:00Z",
    updated_at: "2026-10-06T16:10:00Z",
    deleted_at: null,
    web_url: "https://notes.granola.ai/d/not_1d3tmYTlCICgjy",
    calendar_event: {
      event_title: "Brightwater / CytoHub",
      invitees: [{ email: "Karen@Brightwater.example" }, { email: "sam@brightwater.example" }],
      organiser: "ceo@cytohub.example",
      calendar_event_id: "evt_abc123",
      scheduled_start_time: "2026-10-06T15:00:00Z",
      scheduled_end_time: "2026-10-06T16:00:00Z",
    },
    attendees: [
      { name: "Alex Rivera", email: "ceo@cytohub.example" },
      { name: "Karen Liu", email: "karen@brightwater.example" },
    ],
    summary_text: SUMMARY,
    summary_markdown: `### Outcome\n${SUMMARY}`,
    private_notes_text: null,
    private_notes_markdown: null,
    transcript: null,
    ...overrides,
  };
}

describe("granola mapping", () => {
  it("assembles summary and private notes as labelled sections", () => {
    assert.equal(granolaNoteText(note()), `## Summary\n\n### Outcome\n${SUMMARY}`);
    assert.equal(granolaNoteText(note({ summary_markdown: null, private_notes_markdown: "- ask about budget" })), `## Summary\n\n${SUMMARY}\n\n## My notes\n\n- ask about budget`);
    assert.equal(granolaNoteText(note({ summary_markdown: " ", summary_text: "", private_notes_text: "typed notes" })), "## My notes\n\ntyped notes");
    assert.equal(granolaNoteText(note({ summary_markdown: null, summary_text: "" })), "");
  });

  it("formats transcripts as speaker lines, capped", () => {
    const items = [
      { speaker: { source: "microphone", attribution: "me" }, text: "Thanks for joining." },
      { speaker: { source: "speaker", attribution: "them", name: "Karen Liu" }, text: "Happy to." },
      { speaker: { source: "microphone", diarization_label: "Speaker B" }, text: "  Quick   question " },
      { speaker: { source: "speaker" }, text: "" },
      { speaker: { source: "speaker" }, text: "Sure." },
    ];
    assert.equal(transcriptText(items, "Alex Rivera"), "Alex Rivera: Thanks for joining.\nKaren Liu: Happy to.\nSpeaker B: Quick question\nThem: Sure.");
    assert.equal(transcriptText(items, null, 45), "Me: Thanks for joining.\nKaren Liu: Happy to.");
    assert.equal(transcriptText(items, null, 44), "Me: Thanks for joining.", "whole lines only");
    const long = Array.from({ length: 5000 }, () => ({ speaker: { source: "speaker" }, text: "x".repeat(50) }));
    assert.ok(transcriptText(long).length <= MAX_TRANSCRIPT_CHARS);
  });

  it("merges attendees with calendar invitees", () => {
    assert.deepEqual(granolaAttendees(note()), [
      { name: "Alex Rivera", email: "ceo@cytohub.example" },
      { name: "Karen Liu", email: "karen@brightwater.example" },
      { name: null, email: "sam@brightwater.example" },
    ]);
  });

  it("maps a note to a meeting note", () => {
    const input = granolaMeetingNote(note(), "text");
    assert.equal(input.externalId, "granola:not_1d3tmYTlCICgjy");
    assert.equal(input.title, "Brightwater pilot review");
    assert.equal(input.startsAt?.toISOString(), "2026-10-06T15:00:00.000Z");
    assert.equal(input.endsAt?.toISOString(), "2026-10-06T16:00:00.000Z");
    assert.equal(input.calendarEventId, "evt_abc123");
    assert.equal(input.url, "https://notes.granola.ai/d/not_1d3tmYTlCICgjy");
    assert.equal(input.updatedAt?.toISOString(), "2026-10-06T16:10:00.000Z");

    const bare = granolaMeetingNote(note({ title: null, calendar_event: null, attendees: [], web_url: "javascript:alert(1)" }), "text");
    assert.equal(bare.title, "Granola meeting");
    assert.equal(bare.startsAt?.toISOString(), "2026-10-06T15:05:00.000Z", "falls back to created_at");
    assert.equal(bare.calendarEventId, null);
    assert.equal(bare.url, null);
    assert.deepEqual(bare.attendees, []);
  });
});

describe("pacer", () => {
  it("spaces consecutive calls", async () => {
    const waits: number[] = [];
    const pace = pacer(220, async (ms) => {
      waits.push(ms);
    });
    await pace();
    await pace();
    assert.equal(waits.length, 1);
    assert.ok(waits[0] > 150 && waits[0] <= 220);
  });
});

// ─── Sync ────────────────────────────────────────────────────────────────────

function syncContext(over: Partial<ConnectorSyncContext> = {}) {
  const counts: Record<SyncCounter, number> = { fetched: 0, created: 0, updated: 0, unchanged: 0, failed: 0 };
  const cursors: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const ctx: ConnectorSyncContext = {
    pipeline: {} as PipelineContext,
    http: fakeContext({ provider: "GRANOLA" }, { now: NOW, token: "grn_test_key" }),
    connection: {
      id: "conn_granola",
      provider: "GRANOLA",
      label: "Granola",
      accountEmail: "ceo@cytohub.example",
      externalAccountId: null,
      settings: {},
      defaultSensitivity: "CONFIDENTIAL",
      syncFrequency: "HOURLY",
      sourceKey: "granola",
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
  const ingested: MeetingNoteInput[] = [];
  const deps: GranolaDeps = {
    spacingMs: 0,
    async ingestMeetingNote(_ctx, input) {
      ingested.push(input);
      return input.text.length < 40 ? "skipped" : "created";
    },
  };
  return { deps, ingested };
}

const summary = (id: string, updated: string, extra: Record<string, unknown> = {}) => ({
  id,
  object: "note",
  title: id,
  owner: { name: "Alex", email: "ceo@cytohub.example" },
  created_at: updated,
  updated_at: updated,
  deleted_at: null,
  ...extra,
});

describe("syncGranola", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("pages notes changed in the window, skips deleted ones, falls back to the transcript, and saves the cursor per page", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /public-api\.granola\.ai\/v1\/notes$/,
          (req) =>
            req.url.searchParams.get("cursor") === "page-2"
              ? json({ notes: [summary("not_c", "2026-10-07T09:00:00Z"), summary("not_d", "2026-10-07T10:00:00Z", { deleted_at: "2026-10-07T10:00:00Z" })], hasMore: false, cursor: null })
              : json({ notes: [summary("not_a", "2026-10-05T09:00:00Z"), summary("not_b", "2026-10-06T16:10:00Z")], hasMore: true, cursor: "page-2" }),
        ],
        [
          "GET",
          /\/v1\/notes\/not_b$/,
          (req) =>
            req.url.searchParams.get("include") === "transcript"
              ? json({
                  ...note({ id: "not_b", summary_text: "", summary_markdown: null }),
                  transcript: [
                    { speaker: { source: "microphone", attribution: "me" }, text: "We should move the pilot start to November.", start_time: "x", end_time: "y" },
                    { speaker: { source: "speaker", attribution: "them" }, text: "Agreed, pending legal review.", start_time: "x", end_time: "y" },
                  ],
                })
              : json(note({ id: "not_b", summary_text: "", summary_markdown: null })),
        ],
        ["GET", /\/v1\/notes\/(not_a|not_c)$/, (req) => json(note({ id: req.url.pathname.split("/").pop()! }))],
      ]),
    );
    restore = stub.restore;
    const { ctx, counts, cursors } = syncContext();
    const { deps, ingested } = fakeDeps();
    await syncGranola(ctx, deps);

    const lists = stub.requests.filter((r) => r.url.pathname === "/v1/notes");
    const since = new Date(NOW.getTime() - 90 * DAY_MS).toISOString();
    assert.equal(lists[0].url.searchParams.get("updated_after"), since);
    assert.equal(lists[0].url.searchParams.get("page_size"), "30");
    assert.equal(lists[0].url.searchParams.get("cursor"), null);
    assert.equal(lists[1].url.searchParams.get("cursor"), "page-2");
    assert.equal(lists[1].url.searchParams.get("updated_after"), since);
    assert.equal(lists[0].headers.get("authorization"), "Bearer grn_test_key");

    assert.ok(!stub.requests.some((r) => r.url.pathname.endsWith("/not_d")), "deleted notes are not fetched");
    const detailA = stub.requests.find((r) => r.url.pathname === "/v1/notes/not_a")!;
    assert.equal(detailA.url.searchParams.get("include"), null, "no transcript unless needed");

    assert.deepEqual(
      ingested.map((n) => n.externalId),
      ["granola:not_a", "granola:not_b", "granola:not_c"],
    );
    assert.match(ingested[0].text, /^## Summary/);
    assert.equal(ingested[1].text, "## Transcript\n\nAlex Rivera: We should move the pilot start to November.\nThem: Agreed, pending legal review.");
    assert.equal(ingested[1].calendarEventId, "evt_abc123");

    assert.deepEqual(cursors, [
      { updatedAfter: since, resume: { cursor: "page-2", maxSeen: "2026-10-06T16:10:00.000Z" } },
      { updatedAfter: "2026-10-07T10:00:00.000Z" },
    ]);
    assert.deepEqual(counts, { fetched: 4, created: 3, updated: 0, unchanged: 1, failed: 0 });
  });

  it("resumes from a saved page position, and starts the window over if Granola rejects it", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/v1\/notes$/,
          (req) => (req.url.searchParams.get("cursor") === "stale" ? json({ error: "invalid cursor" }, { status: 400 }) : json({ notes: [], hasMore: false, cursor: null })),
        ],
      ]),
    );
    restore = stub.restore;
    const { ctx, cursors, notes } = syncContext({
      cursor: { updatedAfter: "2026-10-01T00:00:00.000Z", resume: { cursor: "stale", maxSeen: "2026-10-03T00:00:00.000Z" } },
      initial: false,
    });
    await syncGranola(ctx, fakeDeps().deps);
    assert.deepEqual(
      stub.requests.map((r) => r.url.searchParams.get("cursor")),
      ["stale", null],
    );
    assert.equal(stub.requests[1].url.searchParams.get("updated_after"), "2026-10-01T00:00:00.000Z");
    assert.deepEqual(cursors.at(-1), { updatedAfter: "2026-10-03T00:00:00.000Z" });
    assert.equal(notes.length, 1);
  });

  it("pages the transcript endpoint when the transcript is too large to inline", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /\/v1\/notes$/, () => json({ notes: [summary("not_big", "2026-10-07T09:00:00Z")], hasMore: false, cursor: null })],
        ["GET", /\/v1\/notes\/not_big\/transcript$/, (req) =>
          req.url.searchParams.get("cursor") === "t2"
            ? json({ transcript: [{ speaker: { source: "speaker", name: "Karen Liu" }, text: "And the pricing for phase two." }], hasMore: false, cursor: null })
            : json({ transcript: [{ speaker: { source: "speaker", name: "Karen Liu" }, text: "Let's walk through the pilot milestones." }], hasMore: true, cursor: "t2" })],
        ["GET", /\/v1\/notes\/not_big$/, (req) =>
          req.url.searchParams.get("include") === "transcript"
            ? json({ error: { code: "TRANSCRIPT_TOO_LARGE" } }, { status: 413 })
            : json(note({ id: "not_big", summary_text: "", summary_markdown: null }))],
      ]),
    );
    restore = stub.restore;
    const { ctx } = syncContext();
    const { deps, ingested } = fakeDeps();
    await syncGranola(ctx, deps);
    assert.equal(ingested[0].text, "## Transcript\n\nKaren Liu: Let's walk through the pilot milestones.\nKaren Liu: And the pricing for phase two.");
    const pages = stub.requests.filter((r) => r.url.pathname.endsWith("/transcript"));
    assert.deepEqual(pages.map((r) => r.url.searchParams.get("cursor")), [null, "t2"]);
  });

  it("keeps going past a note that cannot be read, and lists it again next time", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /\/v1\/notes$/, () => json({ notes: [summary("not_bad", "2026-10-05T09:00:00Z"), summary("not_gone", "2026-10-05T10:00:00Z"), summary("not_ok", "2026-10-07T09:00:00Z")], hasMore: false, cursor: null })],
        ["GET", /\/v1\/notes\/not_bad$/, () => json({ unexpected: true })],
        ["GET", /\/v1\/notes\/not_gone$/, () => json({ message: "Not found" }, { status: 404 })],
        ["GET", /\/v1\/notes\/not_ok$/, () => json(note({ id: "not_ok" }))],
      ]),
    );
    restore = stub.restore;
    const { ctx, counts, cursors, notes } = syncContext();
    const { deps, ingested } = fakeDeps();
    await syncGranola(ctx, deps);
    assert.deepEqual(ingested.map((n) => n.externalId), ["granola:not_ok"]);
    assert.deepEqual(counts, { fetched: 3, created: 1, updated: 0, unchanged: 1, failed: 1 });
    assert.deepEqual(cursors.at(-1), { updatedAfter: "2026-10-05T08:59:59.999Z" });
    assert.match(notes[0], /not_bad could not be read/);
  });

  it("stops on rejected credentials", async () => {
    const stub = stubFetch(() => new Response(null, { status: 401 }));
    restore = stub.restore;
    const { ctx, cursors } = syncContext();
    await assert.rejects(syncGranola(ctx, fakeDeps().deps), ProviderAuthError);
    assert.equal(cursors.length, 0);
  });
});

// ─── Key check ───────────────────────────────────────────────────────────────

describe("verifyGranolaKey", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("returns the owner of the first note and never echoes the key", async () => {
    const stub = stubFetch(routes([["GET", /\/v1\/notes$/, () => json({ notes: [summary("not_a", "2026-10-05T09:00:00Z", { owner: { name: "Alex", email: "CEO@cytohub.example" } })], hasMore: true, cursor: "c" })]]));
    restore = stub.restore;
    const result = await verifyGranolaKey("grn_secret_key_123456");
    assert.deepEqual(result, { accountName: "ceo@cytohub.example", accountEmail: "ceo@cytohub.example", externalAccountId: null, scopes: ["notes:read"] });
    assert.equal(stub.requests[0].url.searchParams.get("page_size"), "1");
    assert.equal(stub.requests[0].headers.get("authorization"), "Bearer grn_secret_key_123456");
    assert.ok(!JSON.stringify(result).includes("grn_secret"));
  });

  it("names the workspace when there are no notes yet", async () => {
    const stub = stubFetch(routes([["GET", /\/v1\/notes$/, () => json({ notes: [], hasMore: false, cursor: null })]]));
    restore = stub.restore;
    const result = await verifyGranolaKey("grn_secret_key_123456");
    assert.equal(result.accountName, "Granola workspace");
    assert.equal(result.accountEmail, null);
  });

  it("explains a rejected key (401)", async () => {
    const stub = stubFetch(() => json({ message: "Unauthorized" }, { status: 401 }));
    restore = stub.restore;
    await assert.rejects(verifyGranolaKey("grn_secret_key_123456"), (e: unknown) => e instanceof KeyRejectedError && /Settings → Connectors → API keys/.test(e.message) && !e.message.includes("grn_secret"));
  });

  it("explains the plan requirement (403)", async () => {
    const stub = stubFetch(() => json({ message: "Forbidden" }, { status: 403 }));
    restore = stub.restore;
    await assert.rejects(verifyGranolaKey("grn_secret_key_123456"), (e: unknown) => e instanceof KeyRejectedError && /Business or Enterprise/.test(e.message));
  });
});
