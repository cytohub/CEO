/**
 * Gmail adapter (read-only, `gmail.readonly`).
 *
 *   initial:      users.getProfile (historyId to resume from) →
 *                 users.messages.list q=newer_than:<days>d → messages.get?format=full
 *   incremental:  users.history.list from historyId (messageAdded, messageDeleted,
 *                 labelAdded); 404 → CursorExpiredError (full resync)
 *   push:         users.watch to a Pub/Sub topic (only when GOOGLE_PUBSUB_TOPIC is set)
 *
 * The MIME tree is walked to find the readable body (text/plain preferred,
 * HTML converted otherwise) and attachment metadata; attachment bytes are
 * fetched lazily via attachments.get only when retention allows storing them.
 */
import { z } from "zod";
import { DAY_MS } from "@/lib/dates";
import { decodeBytes, decodeMimeWords, htmlToText, parseAddress, parseAddressList, tidyText } from "../../normalize/email";
import { CursorExpiredError, type ChangeSet, type EmailProvider, type NormalizedAttachment, type NormalizedEmail, type ProviderContext, type SyncCursor, type WebhookSubscriber } from "../../types";
import { ProviderHttpError, mapLimit, providerJson, providerSend } from "../http";

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

// ─── Payload schemas (only the fields we use) ────────────────────────────────

const headerSchema = z.object({ name: z.string(), value: z.string() });

export interface GmailPart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: z.object({ size: z.number().optional(), data: z.string().optional(), attachmentId: z.string().optional() }).optional(),
    parts: z.array(partSchema).optional(),
  }),
);

export const gmailMessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  historyId: z.string().optional(),
  internalDate: z.string().optional(),
  payload: partSchema.optional(),
});
export type GmailMessage = z.infer<typeof gmailMessageSchema>;

const listSchema = z.object({
  messages: z.array(z.object({ id: z.string(), threadId: z.string().optional() })).optional(),
  nextPageToken: z.string().optional(),
});

const historyMessage = z.object({ id: z.string(), threadId: z.string().optional(), labelIds: z.array(z.string()).optional() });
const historySchema = z.object({
  history: z
    .array(
      z.object({
        id: z.string().optional(),
        messagesAdded: z.array(z.object({ message: historyMessage })).optional(),
        messagesDeleted: z.array(z.object({ message: historyMessage })).optional(),
        labelsAdded: z.array(z.object({ message: historyMessage, labelIds: z.array(z.string()).optional() })).optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().optional(),
  historyId: z.string().optional(),
});

const profileSchema = z.object({ emailAddress: z.string().optional(), historyId: z.string() });
const attachmentSchema = z.object({ data: z.string().optional(), size: z.number().optional() });
const watchSchema = z.object({ historyId: z.string().optional(), expiration: z.string().optional() });

const cursorSchema = z.object({
  mode: z.enum(["initial", "incremental"]),
  historyId: z.string().optional(),
  startHistoryId: z.string().optional(),
  pageToken: z.string().optional(),
});
type GmailCursor = z.infer<typeof cursorSchema>;

// ─── MIME parsing (pure) ─────────────────────────────────────────────────────

/** Labels that are never ingested: drafts and chats are not mail; spam and trash are noise. */
const SKIP_LABELS = new Set(["DRAFT", "CHAT", "SPAM", "TRASH"]);

const KEPT_HEADERS = ["list-unsubscribe", "list-id", "precedence", "auto-submitted", "x-auto-response-suppress", "x-autoreply", "x-autorespond"];

function headerValue(headers: { name: string; value: string }[] | undefined, name: string): string | null {
  const h = headers?.find((x) => x.name.toLowerCase() === name);
  return h ? h.value : null;
}

function contentTypeParam(value: string | null, param: string): string | null {
  if (!value) return null;
  const m = value.match(new RegExp(`${param}\\s*=\\s*"?([^";]+)"?`, "i"));
  return m ? m[1].trim() : null;
}

function decodeBody(data: string, charset: string | null): string {
  return decodeBytes(Buffer.from(data, "base64url"), charset);
}

interface WalkResult {
  plain: string[];
  html: string[];
  attachments: { filename: string; mimeType: string; size: number; attachmentId: string | null; inlineData: string | null }[];
}

function walk(part: GmailPart, out: WalkResult) {
  const mimeType = (part.mimeType ?? "").toLowerCase();
  const disposition = headerValue(part.headers, "content-disposition") ?? "";
  const filename = decodeMimeWords(part.filename || contentTypeParam(disposition, "filename") || contentTypeParam(headerValue(part.headers, "content-type"), "name") || "").trim();

  if (part.parts?.length) {
    for (const child of part.parts) walk(child, out);
    return;
  }
  const isAttachment = Boolean(filename) && (Boolean(part.body?.attachmentId) || /attachment/i.test(disposition) || !mimeType.startsWith("text/"));
  if (isAttachment) {
    out.attachments.push({
      filename,
      mimeType: mimeType || "application/octet-stream",
      size: part.body?.size ?? 0,
      attachmentId: part.body?.attachmentId ?? null,
      inlineData: part.body?.data ?? null,
    });
    return;
  }
  const data = part.body?.data;
  if (!data) return;
  const charset = contentTypeParam(headerValue(part.headers, "content-type"), "charset");
  if (mimeType === "text/plain" || (!mimeType && !filename)) out.plain.push(decodeBody(data, charset));
  else if (mimeType === "text/html") out.html.push(decodeBody(data, charset));
}

/** Readable body + attachment metadata from a Gmail MIME tree. */
export function parseGmailPayload(payload: GmailPart | undefined): { bodyText: string; attachments: WalkResult["attachments"] } {
  const out: WalkResult = { plain: [], html: [], attachments: [] };
  if (payload) walk(payload, out);
  const plain = out.plain.map((t) => tidyText(t)).filter(Boolean);
  const bodyText = plain.length ? plain.join("\n\n") : out.html.map(htmlToText).filter(Boolean).join("\n\n");
  return { bodyText, attachments: out.attachments };
}

/**
 * Map a Gmail message (format=full) to a NormalizedEmail. Returns null for
 * drafts, chats, spam and trash. `fetchAttachment` downloads one attachment.
 */
export function parseGmailMessage(message: GmailMessage, opts: { fetchAttachment?: (messageId: string, attachmentId: string) => Promise<Buffer> } = {}): NormalizedEmail | null {
  const labels = message.labelIds ?? [];
  if (labels.some((l) => SKIP_LABELS.has(l))) return null;
  const headers = message.payload?.headers ?? [];
  const get = (name: string) => headerValue(headers, name);

  const from = parseAddress(get("from") ?? "") ?? parseAddress(get("sender") ?? "") ?? { name: null, email: "unknown@unknown.invalid" };
  const dateHeader = get("date");
  const headerTime = dateHeader ? Date.parse(dateHeader) : NaN;
  const internal = message.internalDate ? Number(message.internalDate) : NaN;
  const sentAt = new Date(Number.isFinite(headerTime) ? headerTime : Number.isFinite(internal) ? internal : 0);

  const { bodyText, attachments } = parseGmailPayload(message.payload);
  const selected: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const v = get(name);
    if (v) selected[name] = v.slice(0, 1000);
  }

  const normalizedAttachments: NormalizedAttachment[] = attachments.map((a) => ({
    externalId: a.attachmentId ?? `${message.id}:${a.filename}`,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: a.size,
    fetch: a.inlineData
      ? async () => Buffer.from(a.inlineData!, "base64url")
      : a.attachmentId && opts.fetchAttachment
        ? () => opts.fetchAttachment!(message.id, a.attachmentId!)
        : undefined,
  }));

  return {
    externalId: message.id,
    threadExternalId: message.threadId,
    internetMessageId: get("message-id")?.trim() || null,
    inReplyTo: get("in-reply-to")?.trim() || null,
    from,
    to: parseAddressList(get("to")),
    cc: parseAddressList(get("cc")),
    bcc: parseAddressList(get("bcc")),
    replyTo: parseAddressList(get("reply-to"))[0] ?? null,
    subject: decodeMimeWords(get("subject") ?? "").trim() || "(no subject)",
    sentAt,
    bodyText,
    labels,
    folder: labels.includes("SENT") ? "SENT" : labels.includes("INBOX") ? "INBOX" : null,
    isRead: !labels.includes("UNREAD"),
    headers: selected,
    attachments: normalizedAttachments,
    webUrl: `https://mail.google.com/mail/#all/${encodeURIComponent(message.id)}`,
    raw: message,
  };
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

function parseCursor(cursor: SyncCursor | null): GmailCursor | null {
  if (!cursor) return null;
  const parsed = cursorSchema.safeParse(cursor);
  return parsed.success ? parsed.data : null;
}

async function getMessage(ctx: ProviderContext, id: string): Promise<GmailMessage | null> {
  try {
    return await providerJson(ctx, `${GMAIL}/messages/${encodeURIComponent(id)}`, gmailMessageSchema, { query: { format: "full" } });
  } catch (error) {
    // Deleted between listing and fetching.
    if (error instanceof ProviderHttpError && error.status === 404) return null;
    throw error;
  }
}

async function fetchAttachment(ctx: ProviderContext, messageId: string, attachmentId: string): Promise<Buffer> {
  const res = await providerJson(ctx, `${GMAIL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, attachmentSchema);
  return Buffer.from(res.data ?? "", "base64url");
}

async function fetchMessages(ctx: ProviderContext, ids: string[]): Promise<{ items: NormalizedEmail[]; missing: string[] }> {
  const fetched = await mapLimit(ids, 5, (id) => getMessage(ctx, id));
  const items: NormalizedEmail[] = [];
  const missing: string[] = [];
  fetched.forEach((m, i) => {
    if (!m) return missing.push(ids[i]);
    const email = parseGmailMessage(m, { fetchAttachment: (mid, aid) => fetchAttachment(ctx, mid, aid) });
    if (email) items.push(email);
    // Drafts / spam / trash are treated as "not in the mailbox".
    else missing.push(m.id);
  });
  return { items, missing };
}

async function initialPage(ctx: ProviderContext, state: GmailCursor, opts: { pageSize: number; initialSince: Date }): Promise<ChangeSet<NormalizedEmail>> {
  const days = Math.max(1, Math.ceil((ctx.now.getTime() - opts.initialSince.getTime()) / DAY_MS));
  const list = await providerJson(ctx, `${GMAIL}/messages`, listSchema, {
    query: { q: `newer_than:${days}d -in:chats -in:drafts`, maxResults: Math.min(500, opts.pageSize), pageToken: state.pageToken },
  });
  const ids = (list.messages ?? []).map((m) => m.id);
  const { items } = await fetchMessages(ctx, ids);
  if (list.nextPageToken) {
    return { items, deletedExternalIds: [], cursor: { mode: "initial", startHistoryId: state.startHistoryId, pageToken: list.nextPageToken }, hasMore: true };
  }
  // Resume from the history id captured before listing, so nothing that arrived meanwhile is missed.
  return { items, deletedExternalIds: [], cursor: { mode: "incremental", historyId: state.startHistoryId }, hasMore: false };
}

async function incrementalPage(ctx: ProviderContext, state: GmailCursor, opts: { pageSize: number }): Promise<ChangeSet<NormalizedEmail>> {
  const startHistoryId = state.historyId!;
  let res: z.infer<typeof historySchema>;
  try {
    res = await providerJson(ctx, `${GMAIL}/history`, historySchema, {
      query: {
        startHistoryId,
        maxResults: Math.min(500, opts.pageSize),
        pageToken: state.pageToken,
        historyTypes: ["messageAdded", "messageDeleted", "labelAdded"],
      },
    });
  } catch (error) {
    if (error instanceof ProviderHttpError && error.status === 404) throw new CursorExpiredError("Gmail history id is too old; full resync required");
    throw error;
  }

  const added = new Set<string>();
  const deleted = new Set<string>();
  for (const h of res.history ?? []) {
    for (const a of h.messagesAdded ?? []) {
      const labels = a.message.labelIds ?? [];
      if (labels.some((l) => l === "DRAFT" || l === "CHAT")) continue;
      added.add(a.message.id);
      deleted.delete(a.message.id);
    }
    for (const d of h.messagesDeleted ?? []) {
      deleted.add(d.message.id);
      added.delete(d.message.id);
    }
    for (const l of h.labelsAdded ?? []) {
      const labels = l.labelIds ?? [];
      if (labels.includes("TRASH") || labels.includes("SPAM")) {
        deleted.add(l.message.id);
        added.delete(l.message.id);
      } else if (labels.includes("INBOX") || labels.includes("SENT")) {
        // Moved back into the mailbox (e.g. un-archived): refetch. Other label churn (STARRED, IMPORTANT…) is ignored.
        added.add(l.message.id);
      }
    }
  }

  const { items, missing } = await fetchMessages(ctx, [...added]);
  for (const id of missing) deleted.add(id);

  if (res.nextPageToken) {
    return { items, deletedExternalIds: [...deleted], cursor: { mode: "incremental", historyId: startHistoryId, pageToken: res.nextPageToken }, hasMore: true };
  }
  return { items, deletedExternalIds: [...deleted], cursor: { mode: "incremental", historyId: res.historyId ?? startHistoryId }, hasMore: false };
}

export const gmailProvider: EmailProvider & WebhookSubscriber = {
  kind: "EMAIL",

  async listChanges(ctx, cursor, opts) {
    let state = parseCursor(cursor);
    if (!state || (state.mode === "incremental" && !state.historyId)) {
      const profile = await providerJson(ctx, `${GMAIL}/profile`, profileSchema);
      state = { mode: "initial", startHistoryId: profile.historyId };
    }
    return state.mode === "initial" ? initialPage(ctx, state, opts) : incrementalPage(ctx, state, opts);
  },

  /** Gmail push goes to Pub/Sub; the Pub/Sub push subscription then calls /api/webhooks/google. */
  async subscribe(ctx) {
    const topicName = process.env.GOOGLE_PUBSUB_TOPIC;
    if (!topicName) throw new Error("Gmail push needs GOOGLE_PUBSUB_TOPIC");
    const res = await providerJson(ctx, `${GMAIL}/watch`, watchSchema, {
      method: "POST",
      json: { topicName, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "include" },
    });
    const expiresAt = res.expiration ? new Date(Number(res.expiration)) : new Date(ctx.now.getTime() + 6 * DAY_MS);
    return { channelId: `gmail-watch:${ctx.connection.accountEmail ?? ctx.connection.id}`, expiresAt };
  },

  async unsubscribe(ctx) {
    await providerSend(ctx, `${GMAIL}/stop`, { method: "POST" });
  },
};
