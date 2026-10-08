import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { MAX_TRANSCRIPT_CHARS, parseReadAiTime, readAiConnector, readAiNote, readAiTranscriptText, readCappedBody, verifyReadAiSignature } from "./read-ai";
import type { ConnectorSyncContext } from "./types";

// ─── Signature ───────────────────────────────────────────────────────────────

const KEY_BYTES = randomBytes(32);
const KEY = KEY_BYTES.toString("base64");
const BODY = Buffer.from(JSON.stringify({ session_id: "01J9ZK", trigger: "meeting_end", title: "Pilot review" }));
const digest = (body: Buffer, key: Buffer = KEY_BYTES) => createHmac("sha256", key).update(body).digest();

describe("verifyReadAiSignature", () => {
  it("accepts the hex digest Read AI sends, in either case and with a sha256= prefix", () => {
    const hex = digest(BODY).toString("hex");
    assert.equal(verifyReadAiSignature(BODY, hex, KEY), true);
    assert.equal(verifyReadAiSignature(BODY, hex.toUpperCase(), KEY), true);
    assert.equal(verifyReadAiSignature(BODY, `sha256=${hex}`, KEY), true);
    assert.equal(verifyReadAiSignature(BODY, ` ${hex} `, KEY), true);
  });

  it("accepts a base64 or base64url digest", () => {
    assert.equal(verifyReadAiSignature(BODY, digest(BODY).toString("base64"), KEY), true);
    assert.equal(verifyReadAiSignature(BODY, digest(BODY).toString("base64url"), KEY), true);
    assert.equal(verifyReadAiSignature(BODY, `sha256=${digest(BODY).toString("base64")}`, KEY), true);
  });

  it("decodes the signing key from base64 (not its text) and accepts URL-safe or unpadded keys", () => {
    const keyedWithText = createHmac("sha256", KEY).update(BODY).digest("hex");
    assert.equal(verifyReadAiSignature(BODY, keyedWithText, KEY), false);
    assert.equal(verifyReadAiSignature(BODY, digest(BODY).toString("hex"), KEY_BYTES.toString("base64url")), true);
    assert.equal(verifyReadAiSignature(BODY, digest(BODY).toString("hex"), KEY.replace(/=+$/, "")), true);
  });

  it("rejects a different body, a different key, or a truncated digest", () => {
    const hex = digest(BODY).toString("hex");
    assert.equal(verifyReadAiSignature(Buffer.from(`${BODY.toString()} `), hex, KEY), false);
    assert.equal(verifyReadAiSignature(BODY, hex, randomBytes(32).toString("base64")), false);
    assert.equal(verifyReadAiSignature(BODY, hex.slice(0, 63), KEY), false);
    assert.equal(verifyReadAiSignature(BODY, hex.slice(0, 32), KEY), false);
  });

  it("returns false for malformed input", () => {
    const hex = digest(BODY).toString("hex");
    assert.equal(verifyReadAiSignature(BODY, null, KEY), false);
    assert.equal(verifyReadAiSignature(BODY, "", KEY), false);
    assert.equal(verifyReadAiSignature(BODY, "not a signature!", KEY), false);
    assert.equal(verifyReadAiSignature(BODY, "z".repeat(64), KEY), false);
    assert.equal(verifyReadAiSignature(BODY, "a".repeat(5000), KEY), false);
    assert.equal(verifyReadAiSignature(BODY, hex, ""), false);
    assert.equal(verifyReadAiSignature(BODY, hex, "not base64 at all!"), false);
    assert.equal(verifyReadAiSignature(BODY, createHmac("sha256", Buffer.from("c2hvcnQ=", "base64")).update(BODY).digest("hex"), "c2hvcnQ="), false, "keys shorter than 16 bytes");
  });

  it("matches Read AI's documented verification for a known vector", () => {
    // Same steps as Read AI's sample code: base64-decode the key, HMAC-SHA256 the raw body, hex digest.
    const key = "GHx4YT/StkcArjYPypjFG48FbZvgzBuDBOz5pCecbro=";
    const body = Buffer.from('{"session_id":"SESSIONID","trigger":"meeting_end"}');
    const expected = createHmac("sha256", Buffer.from(key, "base64")).update(body).digest("hex");
    assert.equal(verifyReadAiSignature(body, expected, key), true);
  });
});

// ─── Body ────────────────────────────────────────────────────────────────────

describe("readCappedBody", () => {
  it("returns the exact bytes under the cap", async () => {
    const body = await readCappedBody(new Request("https://x.example/", { method: "POST", body: BODY }), 1024);
    assert.ok(body?.equals(BODY));
  });

  it("refuses a declared or streamed body over the cap", async () => {
    const declared = new Request("https://x.example/", { method: "POST", body: "x".repeat(10), headers: { "content-length": "2048" } });
    assert.equal(await readCappedBody(declared, 1024), null);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i++) controller.enqueue(new Uint8Array(400));
        controller.close();
      },
    });
    const streamed = new Request("https://x.example/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    assert.equal(await readCappedBody(streamed, 1024), null);
  });
});

// ─── Payload ─────────────────────────────────────────────────────────────────

/** Read AI's documented example payload. */
const EXAMPLE = {
  session_id: "01J9ZKX3SESSION",
  trigger: "meeting_end",
  title: "Brightwater pilot review",
  start_time: "2026-10-06T15:00:00Z",
  end_time: "2026-10-06T16:00:00Z",
  participants: [
    { name: "Karen Liu", first_name: "Karen", last_name: "Liu", email: "Karen@Brightwater.example" },
    { name: "Participant Two", first_name: "Participant", last_name: "Two", email: null },
  ],
  owner: { name: "Alex Rivera", first_name: "Alex", last_name: "Rivera", email: "ceo@cytohub.example" },
  summary: "Brightwater agreed to the pilot scope and will return the MSA redline by Friday.",
  action_items: [{ text: "Karen to send the MSA redline" }, { text: "Alex to share phase-two pricing" }],
  key_questions: [{ text: "Who signs for Brightwater?" }],
  topics: [{ text: "Pilot scope" }, { text: "Pricing" }],
  report_url: "https://app.read.ai/analytics/meetings/01J9ZKX3SESSION",
  chapter_summaries: [{ title: "Scope", description: "Agreed on three sites.", topics: [{ text: "Pilot scope" }] }],
  transcript: {
    speaker_blocks: [
      { start_time: "1719514000000", end_time: "1719514001000", speaker: { name: "Karen Liu" }, words: "Good morning everyone!" },
      { start_time: "1719514002000", end_time: "1719514003000", speaker: { name: "Alex Rivera" }, words: "Hi!" },
    ],
    speakers: [{ name: "Karen Liu" }, { name: "Alex Rivera" }],
  },
  platform_meeting_id: "abc-defg-hij",
  platform: "meet",
  request_id: "01KKVQZ19X57NMNFTS8YXJNZE4",
};

describe("readAiNote", () => {
  it("maps a meeting_end report to a meeting note", () => {
    const note = readAiNote(EXAMPLE)!;
    assert.equal(note.externalId, "readai:01J9ZKX3SESSION");
    assert.equal(note.title, "Brightwater pilot review");
    assert.equal(note.startsAt?.toISOString(), "2026-10-06T15:00:00.000Z");
    assert.equal(note.endsAt?.toISOString(), "2026-10-06T16:00:00.000Z");
    assert.equal(note.url, "https://app.read.ai/analytics/meetings/01J9ZKX3SESSION");
    assert.equal(note.calendarEventId, null);
    assert.deepEqual(note.attendees, [
      { name: "Karen Liu", email: "karen@brightwater.example" },
      { name: "Participant Two", email: null },
      { name: "Alex Rivera", email: "ceo@cytohub.example" },
    ]);
    assert.equal(
      note.text,
      [
        "## Summary\n\nBrightwater agreed to the pilot scope and will return the MSA redline by Friday.",
        "## Action items\n\n- Karen to send the MSA redline\n- Alex to share phase-two pricing",
        "## Key questions\n\n- Who signs for Brightwater?",
        "## Topics\n\n- Pilot scope\n- Pricing",
        "## Chapter summaries\n\n### Scope\n\nAgreed on three sites.\n\nTopics: Pilot scope",
      ].join("\n\n"),
      "no transcript when there is a summary",
    );
  });

  it("uses the transcript only when there is no summary", () => {
    const note = readAiNote({ ...EXAMPLE, summary: "", action_items: [], key_questions: null, topics: undefined, chapter_summaries: [] })!;
    assert.equal(note.text, "## Transcript\n\nKaren Liu: Good morning everyone!\nAlex Rivera: Hi!");
  });

  it("ignores meeting_start deliveries and payloads without a session id", () => {
    assert.equal(readAiNote({ session_id: "s1", trigger: "meeting_start", title: "Standup", start_time: "2026-10-06T15:00:00Z" }), null);
    assert.equal(readAiNote({ ...EXAMPLE, session_id: undefined }), null);
    assert.equal(readAiNote({ ...EXAMPLE, session_id: "  " }), null);
    assert.equal(readAiNote(null), null);
    assert.equal(readAiNote("meeting_end"), null);
    assert.equal(readAiNote([EXAMPLE]), null);
  });

  it("tolerates missing and oddly shaped fields", () => {
    const note = readAiNote({
      session_id: 12345,
      title: 42,
      start_time: 1759762800000,
      participants: "everyone",
      owner: "Alex",
      summary: { text: "nested" },
      action_items: ["Send the deck", { text: "  " }, 7, { title: "Book the follow-up" }],
      report_url: "http://insecure.example/report",
    })!;
    assert.equal(note.externalId, "readai:12345");
    assert.equal(note.title, "Read AI meeting");
    assert.equal(note.startsAt?.toISOString(), "2025-10-06T15:00:00.000Z");
    assert.equal(note.endsAt, null);
    assert.deepEqual(note.attendees, []);
    assert.equal(note.url, null);
    assert.equal(note.text, "## Action items\n\n- Send the deck\n- Book the follow-up");
    assert.equal(readAiNote({ session_id: "s2" })?.text, "");
  });
});

describe("readAiTranscriptText", () => {
  it("accepts speaker blocks, plain strings and objects with text/name fields", () => {
    assert.equal(readAiTranscriptText(["Hello there", "  ", "General Kenobi"]), "Hello there\nGeneral Kenobi");
    assert.equal(readAiTranscriptText([{ name: "Karen", text: "Hi" }, { speaker: "Alex", words: "Hello" }, { text: "No speaker" }, { speaker: { name: "X" } }]), "Karen: Hi\nAlex: Hello\nNo speaker");
    assert.equal(readAiTranscriptText("line one\nline two"), "line one\nline two");
    assert.equal(readAiTranscriptText({ text: "whole transcript" }), "whole transcript");
    assert.equal(readAiTranscriptText(42), "");
  });

  it("caps long transcripts at whole lines", () => {
    const blocks = Array.from({ length: 4000 }, (_, i) => ({ speaker: { name: "Karen Liu" }, words: `Sentence number ${i} about the pilot.` }));
    const text = readAiTranscriptText({ speaker_blocks: blocks });
    assert.ok(text.length <= MAX_TRANSCRIPT_CHARS);
    assert.ok(text.endsWith("pilot."));
  });
});

describe("parseReadAiTime", () => {
  it("reads ISO strings and Unix seconds or milliseconds", () => {
    assert.equal(parseReadAiTime("2026-10-06T15:00:00Z")?.toISOString(), "2026-10-06T15:00:00.000Z");
    assert.equal(parseReadAiTime("1719514000000")?.toISOString(), "2024-06-27T18:46:40.000Z");
    assert.equal(parseReadAiTime(1719514000)?.toISOString(), "2024-06-27T18:46:40.000Z");
    assert.equal(parseReadAiTime("yesterday"), null);
    assert.equal(parseReadAiTime(5), null);
    assert.equal(parseReadAiTime(null), null);
  });
});

describe("readAiConnector.sync", () => {
  it("has nothing to poll", async () => {
    const notes: string[] = [];
    await readAiConnector.sync({ note: (m: string) => notes.push(m) } as unknown as ConnectorSyncContext);
    assert.deepEqual(notes, ["Read AI sends meeting reports by webhook after each meeting; nothing to poll."]);
    assert.equal(readAiConnector.verifyKey, undefined);
  });
});
