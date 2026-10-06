/**
 * Outlook Mail adapter (Microsoft Graph, delegated `Mail.Read`).
 *
 * Delta query per folder (Inbox and Sent Items), each with its own
 * deltaLink in the cursor. One page from one folder per call; a sync "round"
 * visits every folder once. Bodies come as text (`Prefer:
 * outlook.body-content-type="text"`); `@removed` entries become deletions.
 * Headers needed for automation detection (List-Unsubscribe, Precedence…)
 * and attachment metadata are fetched for the page in one JSON batch.
 */
import { z } from "zod";
import { htmlToText, tidyText } from "../../normalize/email";
import type { ChangeSet, EmailProvider, NormalizedAttachment, NormalizedEmail, ProviderContext, SyncCursor, WebhookSubscriber } from "../../types";
import { providerBuffer } from "../http";
import { GRAPH, SUBSCRIPTION_MINUTES, createGraphSubscription, deleteGraphSubscription, graphBatch, graphDeltaPage, graphRecipient, recipientToParticipant } from "./graph";

const FOLDERS = ["inbox", "sentitems"] as const;
type Folder = (typeof FOLDERS)[number];
const FOLDER_LABEL: Record<Folder, string> = { inbox: "INBOX", sentitems: "SENT" };

const SELECT = [
  "id",
  "internetMessageId",
  "conversationId",
  "subject",
  "body",
  "from",
  "sender",
  "toRecipients",
  "ccRecipients",
  "bccRecipients",
  "replyTo",
  "sentDateTime",
  "receivedDateTime",
  "isRead",
  "isDraft",
  "hasAttachments",
  "webLink",
  "categories",
].join(",");

export const graphMessageSchema = z.object({
  id: z.string(),
  "@removed": z.object({ reason: z.string().optional() }).optional(),
  internetMessageId: z.string().nullish(),
  conversationId: z.string().nullish(),
  subject: z.string().nullish(),
  body: z.object({ contentType: z.string().nullish(), content: z.string().nullish() }).nullish(),
  from: graphRecipient.nullish(),
  sender: graphRecipient.nullish(),
  toRecipients: z.array(graphRecipient).nullish(),
  ccRecipients: z.array(graphRecipient).nullish(),
  bccRecipients: z.array(graphRecipient).nullish(),
  replyTo: z.array(graphRecipient).nullish(),
  sentDateTime: z.string().nullish(),
  receivedDateTime: z.string().nullish(),
  isRead: z.boolean().nullish(),
  isDraft: z.boolean().nullish(),
  hasAttachments: z.boolean().nullish(),
  webLink: z.string().nullish(),
  categories: z.array(z.string()).nullish(),
});
export type GraphMessage = z.infer<typeof graphMessageSchema>;

const headersBody = z.object({ internetMessageHeaders: z.array(z.object({ name: z.string(), value: z.string() })).nullish() });
const attachmentsBody = z.object({
  value: z.array(
    z.object({
      "@odata.type": z.string().optional(),
      id: z.string(),
      name: z.string().nullish(),
      contentType: z.string().nullish(),
      size: z.number().nullish(),
      isInline: z.boolean().nullish(),
    }),
  ),
});
export type GraphAttachmentMeta = z.infer<typeof attachmentsBody>["value"][number];

const KEPT_HEADERS = new Set(["list-unsubscribe", "list-id", "precedence", "auto-submitted", "x-auto-response-suppress", "in-reply-to", "x-autoreply", "x-autorespond"]);

const folderState = z.object({ deltaLink: z.string().optional(), nextLink: z.string().optional() });
const cursorSchema = z.object({
  folders: z.object({ inbox: folderState.optional(), sentitems: folderState.optional() }),
  /** Folders still to visit in the current round. */
  round: z.array(z.enum(FOLDERS)),
});
type OutlookMailCursor = z.infer<typeof cursorSchema>;

/** Map a Graph message (plus batched headers / attachment metadata). Pure. */
export function mapGraphMessage(
  m: GraphMessage,
  extras: { folder: Folder; headers?: { name: string; value: string }[] | null; attachments?: GraphAttachmentMeta[] | null; fetchAttachment?: (attachmentId: string) => Promise<Buffer> },
): NormalizedEmail | null {
  if (m["@removed"] || m.isDraft) return null;
  const from = recipientToParticipant(m.from) ?? recipientToParticipant(m.sender) ?? { name: null, email: "unknown@unknown.invalid" };
  const headers: Record<string, string> = {};
  for (const h of extras.headers ?? []) {
    const key = h.name.toLowerCase();
    if (KEPT_HEADERS.has(key)) headers[key] = h.value.slice(0, 1000);
  }
  const participants = (list: z.infer<typeof graphRecipient>[] | null | undefined) =>
    (list ?? []).map(recipientToParticipant).filter((p): p is { name: string | null; email: string } => p !== null);
  const sent = m.sentDateTime ?? m.receivedDateTime;
  const attachments: NormalizedAttachment[] = (extras.attachments ?? [])
    .filter((a) => !a.isInline && (a["@odata.type"] ?? "#microsoft.graph.fileAttachment") === "#microsoft.graph.fileAttachment")
    .map((a) => ({
      externalId: a.id,
      filename: a.name ?? "attachment",
      mimeType: a.contentType ?? "application/octet-stream",
      sizeBytes: a.size ?? 0,
      fetch: extras.fetchAttachment ? () => extras.fetchAttachment!(a.id) : undefined,
    }));
  const body = m.body?.content ?? "";
  return {
    externalId: m.id,
    threadExternalId: m.conversationId ?? m.id,
    internetMessageId: m.internetMessageId ?? null,
    inReplyTo: headers["in-reply-to"] ?? null,
    from,
    to: participants(m.toRecipients),
    cc: participants(m.ccRecipients),
    bcc: participants(m.bccRecipients),
    replyTo: participants(m.replyTo)[0] ?? null,
    subject: m.subject?.trim() || "(no subject)",
    sentAt: sent ? new Date(sent) : new Date(0),
    // Bodies are requested as text; convert defensively if a tenant ignores the preference.
    bodyText: (m.body?.contentType ?? "text").toLowerCase() === "html" ? htmlToText(body) : tidyText(body),
    labels: [FOLDER_LABEL[extras.folder], ...(m.categories ?? [])],
    folder: FOLDER_LABEL[extras.folder],
    isRead: m.isRead ?? null,
    headers,
    attachments,
    webUrl: m.webLink ?? null,
    raw: m,
  };
}

function initialUrl(folder: Folder, since: Date) {
  const u = new URL(`${GRAPH}/me/mailFolders/${folder}/messages/delta`);
  u.searchParams.set("$select", SELECT);
  // Message delta supports only receivedDateTime ge|gt as a filter.
  u.searchParams.set("$filter", `receivedDateTime ge ${since.toISOString().replace(/\.\d{3}Z$/, "Z")}`);
  return u.toString();
}

async function enrich(ctx: ProviderContext, messages: GraphMessage[], folder: Folder) {
  const requests: { id: string; url: string }[] = [];
  for (const m of messages) {
    if (m["@removed"] || m.isDraft) continue;
    // Sent mail is ours: automation headers only matter for incoming messages.
    if (folder === "inbox") requests.push({ id: `h:${m.id}`, url: `/me/messages/${encodeURIComponent(m.id)}?$select=internetMessageHeaders` });
    if (m.hasAttachments) requests.push({ id: `a:${m.id}`, url: `/me/messages/${encodeURIComponent(m.id)}/attachments?$select=id,name,contentType,size,isInline` });
  }
  return requests.length ? graphBatch(ctx, requests) : new Map<string, unknown>();
}

export const outlookMailProvider: EmailProvider & WebhookSubscriber = {
  kind: "EMAIL",

  async listChanges(ctx, cursor: SyncCursor | null, opts): Promise<ChangeSet<NormalizedEmail>> {
    const parsed = cursor ? cursorSchema.safeParse(cursor) : null;
    const state: OutlookMailCursor = parsed?.success ? structuredClone(parsed.data) : { folders: {}, round: [] };
    if (!state.round.length) state.round = [...FOLDERS];
    const folder = state.round[0];
    const fs = state.folders[folder] ?? {};
    const url = fs.nextLink ?? fs.deltaLink ?? initialUrl(folder, opts.initialSince);

    const page = await graphDeltaPage(ctx, url, graphMessageSchema, {
      prefer: [`odata.maxpagesize=${Math.min(100, Math.max(10, opts.pageSize))}`, 'outlook.body-content-type="text"'],
    });
    const extras = await enrich(ctx, page.items, folder);
    const items: NormalizedEmail[] = [];
    const deleted: string[] = [];
    for (const m of page.items) {
      if (m["@removed"]) {
        deleted.push(m.id);
        continue;
      }
      const h = headersBody.safeParse(extras.get(`h:${m.id}`));
      const a = attachmentsBody.safeParse(extras.get(`a:${m.id}`));
      const email = mapGraphMessage(m, {
        folder,
        headers: h.success ? h.data.internetMessageHeaders : null,
        attachments: a.success ? a.data.value : null,
        fetchAttachment: (attachmentId) => providerBuffer(ctx, `${GRAPH}/me/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(attachmentId)}/$value`),
      });
      if (email) items.push(email);
    }

    if (page.nextLink) {
      state.folders[folder] = { deltaLink: fs.deltaLink, nextLink: page.nextLink };
    } else {
      state.folders[folder] = { deltaLink: page.deltaLink ?? fs.deltaLink };
      state.round = state.round.slice(1);
    }
    return { items, deletedExternalIds: deleted, cursor: state, hasMore: state.round.length > 0 };
  },

  subscribe(ctx, opts) {
    return createGraphSubscription(ctx, { resource: "me/messages", changeType: "created,updated,deleted", minutes: SUBSCRIPTION_MINUTES.outlook, ...opts });
  },

  unsubscribe(ctx, channelId) {
    return deleteGraphSubscription(ctx, channelId);
  },
};
