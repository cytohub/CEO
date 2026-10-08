/**
 * Read AI connector: meeting reports arrive by signed webhook after each
 * meeting (src/app/api/webhooks/read-ai/route.ts), so there is nothing to poll.
 *
 * - Every delivery is signed: X-Read-Signature is the HMAC-SHA256 of the raw
 *   body, keyed with the webhook's signing key (base64, decoded to bytes).
 *   The key is stored encrypted on the connection like any other key.
 * - A report becomes a MEETING_NOTES source item through ingestMeetingNote:
 *   summary, action items, key questions, topics and chapter summaries; the
 *   transcript only when there is no summary. Workspace webhooks can also
 *   send meeting_start, which carries no report and is ignored.
 *
 * Payload fields follow Read AI's published webhook schema; transcript shapes
 * vary (speaker blocks, plain strings), so every field is read leniently.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { safeEqual } from "@/server/security/crypto";
import type { MeetingNoteInput } from "./meeting-notes";
import type { BusinessConnector } from "./types";

export const MAX_TRANSCRIPT_CHARS = 60_000;
const MAX_SIGNATURE_LENGTH = 256;
const MAX_KEY_LENGTH = 4096;

// ─── Signature ───────────────────────────────────────────────────────────────

/** Standard or URL-safe base64, padded or not; null when it isn't base64. */
function decodeBase64(value: string): Buffer | null {
  const v = value.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!v || !/^[A-Za-z0-9+/]+$/.test(v) || v.length % 4 === 1) return null;
  const bytes = Buffer.from(v, "base64");
  return bytes.length ? bytes : null;
}

/**
 * Does X-Read-Signature match HMAC-SHA256(raw body) under the signing key?
 * Accepts a hex or base64 digest, optionally prefixed "sha256=". Malformed
 * input of any kind is a mismatch.
 */
export function verifyReadAiSignature(rawBody: Buffer, header: string | null, signingKey: string): boolean {
  try {
    if (!header || header.length > MAX_SIGNATURE_LENGTH || !signingKey || signingKey.length > MAX_KEY_LENGTH) return false;
    const key = decodeBase64(signingKey);
    if (!key || key.length < 16) return false;
    const presented = header.trim().replace(/^sha256=/i, "");
    const given = /^[0-9a-f]{64}$/i.test(presented) ? Buffer.from(presented, "hex") : decodeBase64(presented);
    if (!given || given.length !== 32) return false;
    const expected = createHmac("sha256", key).update(rawBody).digest();
    return safeEqual(given.toString("hex"), expected.toString("hex"));
  } catch {
    return false;
  }
}

// ─── Request body ────────────────────────────────────────────────────────────

/** The raw request body, or null when it is larger than `maxBytes` (stops reading at the cap). */
export async function readCappedBody(request: Request, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

// ─── Payload ─────────────────────────────────────────────────────────────────

const str = z.string().nullish().catch(null);
const stamp = z.union([z.string(), z.number()]).nullish().catch(null);
const list = z.array(z.unknown()).nullish().catch(null);

const payloadSchema = z.object({
  session_id: z.union([z.string(), z.number()]).nullish().catch(null),
  trigger: str,
  title: str,
  start_time: stamp,
  end_time: stamp,
  participants: list,
  owner: z.unknown().optional(),
  summary: str,
  action_items: list,
  key_questions: list,
  topics: list,
  chapter_summaries: list,
  report_url: str,
  transcript: z.unknown().optional(),
});

const personSchema = z.object({ name: str, first_name: str, last_name: str, email: str });
const textItemSchema = z.union([z.string(), z.object({ text: str, title: str, name: str, description: str })]);
const chapterSchema = z.object({ title: str, description: str, summary: str, topics: list });
const speakerSchema = z.union([z.string(), z.object({ name: str })]).nullish().catch(null);
const blockSchema = z.union([z.string(), z.object({ speaker: speakerSchema, speaker_name: str, name: str, words: str, text: str })]);

type Person = z.infer<typeof personSchema>;

/** Elements of a loosely typed array that match `schema`. */
function each<T>(items: unknown[] | null | undefined, schema: z.ZodType<T>): T[] {
  const out: T[] = [];
  for (const item of items ?? []) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function clean(value: string | null | undefined): string | null {
  const v = value?.replace(/\s+/g, " ").trim();
  return v || null;
}

function itemText(item: z.infer<typeof textItemSchema>): string | null {
  return typeof item === "string" ? clean(item) : clean(item.text ?? item.title ?? item.name ?? item.description);
}

/** ISO strings, or Unix time in seconds or milliseconds (numbers or numeric strings). */
export function parseReadAiTime(value: string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const numeric = typeof value === "number" ? value : /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : null;
  const t = numeric != null ? (numeric > 1e11 ? numeric : numeric * 1000) : Date.parse(value as string);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return d.getUTCFullYear() >= 2000 && d.getUTCFullYear() < 2200 ? d : null;
}

function personName(p: Person): string | null {
  return clean(p.name) ?? clean([p.first_name, p.last_name].filter(Boolean).join(" "));
}

function attendeesOf(participants: unknown[] | null | undefined, owner: unknown): MeetingNoteInput["attendees"] {
  const out: MeetingNoteInput["attendees"] = [];
  const seen = new Set<string>();
  for (const p of each([...(participants ?? []), owner], personSchema)) {
    const email = clean(p.email)?.toLowerCase() ?? null;
    const name = personName(p);
    const key = email ?? (name ? `name:${name.toLowerCase()}` : null);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email: email && email.includes("@") ? email : null });
  }
  return out;
}

/** "Speaker: words" lines from speaker blocks, strings or a plain string, capped at `max` characters. */
export function readAiTranscriptText(transcript: unknown, max = MAX_TRANSCRIPT_CHARS): string {
  let blocks: unknown[] = [];
  if (typeof transcript === "string") blocks = transcript.split(/\r?\n/);
  else if (Array.isArray(transcript)) blocks = transcript;
  else if (transcript && typeof transcript === "object") {
    const t = transcript as Record<string, unknown>;
    if (Array.isArray(t.speaker_blocks)) blocks = t.speaker_blocks;
    else if (Array.isArray(t.blocks)) blocks = t.blocks;
    else if (typeof t.text === "string") blocks = t.text.split(/\r?\n/);
  }
  const lines: string[] = [];
  let length = 0;
  for (const block of each(blocks, blockSchema)) {
    let line: string | null;
    if (typeof block === "string") line = clean(block);
    else {
      const said = clean(block.words ?? block.text);
      const speaker = clean(typeof block.speaker === "string" ? block.speaker : (block.speaker?.name ?? block.speaker_name ?? block.name));
      line = said ? (speaker ? `${speaker}: ${said}` : said) : null;
    }
    if (!line) continue;
    if (length + line.length + 1 > max) break;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n");
}

function bullets(items: unknown[] | null | undefined): string[] {
  return each(items, textItemSchema)
    .map(itemText)
    .filter((t): t is string => Boolean(t))
    .map((t) => `- ${t}`);
}

/**
 * The meeting note in a Read AI webhook payload, or null when there is none:
 * a meeting_start delivery (no report yet) or no session id.
 */
export function readAiNote(payload: unknown): MeetingNoteInput | null {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return null;
  const p = parsed.data;
  if (p.trigger?.trim().toLowerCase() === "meeting_start") return null;
  const sessionId = p.session_id == null ? null : String(p.session_id).trim().slice(0, 200);
  if (!sessionId) return null;

  const sections: string[] = [];
  const summary = p.summary?.trim();
  if (summary) sections.push(`## Summary\n\n${summary}`);
  const actions = bullets(p.action_items);
  if (actions.length) sections.push(`## Action items\n\n${actions.join("\n")}`);
  const questions = bullets(p.key_questions);
  if (questions.length) sections.push(`## Key questions\n\n${questions.join("\n")}`);
  const topics = bullets(p.topics);
  if (topics.length) sections.push(`## Topics\n\n${topics.join("\n")}`);
  const chapters = each(p.chapter_summaries, chapterSchema)
    .map((c) => {
      const title = clean(c.title);
      const body = c.description?.trim() || c.summary?.trim() || "";
      const chapterTopics = each(c.topics, textItemSchema)
        .map(itemText)
        .filter((t): t is string => Boolean(t));
      if (!title && !body) return null;
      return [`### ${title ?? "Chapter"}`, body, chapterTopics.length ? `Topics: ${chapterTopics.join(", ")}` : ""].filter(Boolean).join("\n\n");
    })
    .filter((c): c is string => Boolean(c));
  if (chapters.length) sections.push(`## Chapter summaries\n\n${chapters.join("\n\n")}`);
  if (!summary) {
    const transcript = readAiTranscriptText(p.transcript);
    if (transcript) sections.push(`## Transcript\n\n${transcript}`);
  }

  const url = p.report_url?.trim();
  return {
    externalId: `readai:${sessionId}`,
    title: clean(p.title) ?? "Read AI meeting",
    startsAt: parseReadAiTime(p.start_time),
    endsAt: parseReadAiTime(p.end_time),
    attendees: attendeesOf(p.participants, p.owner),
    calendarEventId: null,
    text: sections.join("\n\n"),
    url: url && url.startsWith("https://") ? url.slice(0, 2000) : null,
    updatedAt: parseReadAiTime(p.end_time),
  };
}

// ─── Connector ───────────────────────────────────────────────────────────────

export const readAiConnector: BusinessConnector = {
  provider: "READ_AI",
  async sync(ctx) {
    ctx.note("Read AI sends meeting reports by webhook after each meeting; nothing to poll.");
  },
};
