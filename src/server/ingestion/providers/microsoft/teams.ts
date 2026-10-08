/**
 * Microsoft Teams chats adapter (Microsoft Graph, delegated `Chat.Read`).
 *
 * 1:1, group and meeting chats flow through the email pipeline: each chat is
 * a thread (`teams:<chatId>`), each chat message a message. Channel messages
 * are out of scope (they need admin-consented permissions).
 *
 * A sync "round" reads everything modified since `since`:
 *   1. List /me/chats with `$expand=lastMessagePreview`, newest activity first,
 *      and keep chats whose last message is newer than `since`. Once an older
 *      chat shows up in a sorted page the remaining chats are older too, so
 *      listing stops early. If the service ignores or rejects the ordering we
 *      fall back to listing every chat.
 *   2. For each active chat, page through
 *      /chats/{id}/messages?$orderby=lastModifiedDateTime desc&$filter=lastModifiedDateTime gt <since>
 *      and resolve senders from /chats/{id}/members (the full roster:
 *      `$expand=members` on the chat list stops at 25 members).
 * Each listChanges call does a bounded number of requests (≈ one page of
 * messages) and keeps the rest of the round in the cursor. When the round is
 * complete, `since` moves to the newest lastModifiedDateTime seen (never past
 * the round's start) minus a small overlap; content hashes make the re-reads
 * idempotent. Edits and reactions also bump lastModifiedDateTime.
 */
import { z } from "zod";
import { htmlToText, tidyText } from "../../normalize/email";
import { type ChangeSet, type EmailProvider, type NormalizedEmail, type Participant, ProviderAuthError, type ProviderContext, type SyncCursor } from "../../types";
import { ProviderHttpError, providerJson } from "../http";
import { GRAPH, type DeltaPage, graphDeltaPage } from "./graph";

export const CHAT_READ_REQUIRED = "Teams chats need the Chat.Read permission. Reconnect Teams chats and accept it (your Microsoft 365 admin may need to approve it).";

/** Graph caps both chat and message pages at 50. */
const CHATS_PER_PAGE = 50;
/** Requests per listChanges call; the sync loop calls again while hasMore. */
const MAX_REQUESTS_PER_CALL = 10;
const MEMBER_PAGES = 3;
const OVERLAP_MS = 5 * 60_000;

const identity = z.object({ id: z.string().nullish(), displayName: z.string().nullish() });

export const graphChatMessageSchema = z.object({
  id: z.string(),
  chatId: z.string().nullish(),
  messageType: z.string().nullish(),
  createdDateTime: z.string().nullish(),
  lastModifiedDateTime: z.string().nullish(),
  lastEditedDateTime: z.string().nullish(),
  deletedDateTime: z.string().nullish(),
  importance: z.string().nullish(),
  webUrl: z.string().nullish(),
  from: z
    .object({
      user: identity.extend({ userIdentityType: z.string().nullish() }).nullish(),
      application: identity.extend({ applicationIdentityType: z.string().nullish() }).nullish(),
    })
    .nullish(),
  body: z.object({ contentType: z.string().nullish(), content: z.string().nullish() }).nullish(),
  attachments: z.array(z.object({ id: z.string().nullish(), contentType: z.string().nullish(), contentUrl: z.string().nullish(), name: z.string().nullish() })).nullish(),
});
export type GraphChatMessage = z.infer<typeof graphChatMessageSchema>;

const graphChatSchema = z.object({
  id: z.string(),
  topic: z.string().nullish(),
  chatType: z.string().nullish(),
  webUrl: z.string().nullish(),
  viewpoint: z.object({ lastMessageReadDateTime: z.string().nullish() }).nullish(),
  // null: no message was ever sent; absent: the expansion was not applied.
  lastMessagePreview: z.object({ createdDateTime: z.string().nullish() }).nullable().optional(),
});
type GraphChat = z.infer<typeof graphChatSchema>;

const graphMemberSchema = z.object({ displayName: z.string().nullish(), userId: z.string().nullish(), email: z.string().nullish() });

const pendingChatSchema = z.object({
  id: z.string(),
  topic: z.string().nullish(),
  chatType: z.string().nullish(),
  webUrl: z.string().nullish(),
  lastReadAt: z.string().nullish(),
  /** Next page of this chat's messages once reading has started. */
  messagesLink: z.string().optional(),
});
export type TeamsChat = z.infer<typeof pendingChatSchema>;

const cursorSchema = z.object({
  /** Messages modified after this instant (ISO) are read in the current round. */
  since: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
  /** When the current round's chat listing started. */
  roundStartedAt: z.string().optional(),
  /** Newest lastModifiedDateTime seen in the current round. */
  newest: z.string().optional(),
  /** Next page of /me/chats. */
  chatsLink: z.string().optional(),
  /** The chat listing of the current round is complete. */
  listed: z.boolean().optional(),
  /** Active chats still to read in the current round, most recent first. */
  pendingChats: z.array(pendingChatSchema),
  /** The signed-in user's Graph id (stable for the connection). */
  meId: z.string().optional(),
  /** The service did not honor `$orderby` on the chat list: list every chat. */
  unordered: z.boolean().optional(),
  /** Chat messages have been read successfully at least once (Chat.Read is in place). */
  readOk: z.boolean().optional(),
});
type TeamsCursor = z.infer<typeof cursorSchema>;

export interface TeamsMember {
  userId: string | null;
  name: string | null;
  email: string | null;
}

export interface TeamsChatContext {
  chat: TeamsChat;
  members: TeamsMember[];
  meId: string | null;
  accountEmail: string | null;
}

const EMOJI = /<emoji\b[^>]*?\balt="([^"]*)"[^>]*>(?:\s*<\/emoji\s*>)?/gi;

/** Epoch ms, or NaN when missing or unparseable. */
function safeTime(value: string | null | undefined): number {
  return value ? Date.parse(value) : NaN;
}

function isMe(member: TeamsMember, c: Pick<TeamsChatContext, "meId" | "accountEmail">): boolean {
  if (c.meId && member.userId === c.meId) return true;
  return Boolean(c.accountEmail && member.email && member.email.trim().toLowerCase() === c.accountEmail.toLowerCase());
}

function participant(name: string | null | undefined, email: string): Participant {
  const n = name?.trim();
  return { name: n && n.toLowerCase() !== email ? n : null, email };
}

/** A chat member as a mail participant; the connected account is always its own address. Null without a usable email. */
function memberParticipant(member: TeamsMember, c: TeamsChatContext): Participant | null {
  const email = (isMe(member, c) ? (c.accountEmail ?? member.email) : member.email)?.trim().toLowerCase();
  if (!email || !email.includes("@")) return null;
  return participant(member.name, email);
}

/** Graph ids (GUIDs) as the local part of a non-routable stand-in address. */
function idSlug(id: string | null | undefined): string {
  return (id ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 64);
}

/** "Teams chat with Karen Liu, Marcus Hale" for chats without a topic. Pure. */
export function chatSubject(chat: Pick<TeamsChat, "topic" | "chatType">, members: TeamsMember[], self: Pick<TeamsChatContext, "meId" | "accountEmail">): string {
  const topic = chat.topic?.trim();
  if (topic) return topic;
  if (chat.chatType === "meeting") return "Teams meeting chat";
  const names = members.filter((m) => !isMe(m, self)).map((m) => m.name?.trim() || m.email?.trim()).filter((n): n is string => Boolean(n));
  if (!names.length) return "Teams chat";
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `Teams chat with ${shown} and ${names.length - 3} others` : `Teams chat with ${shown}`;
}

/** Plain text of a chat message, with shared files listed as "[file: name]". */
function messageText(m: GraphChatMessage): string {
  const content = m.body?.content ?? "";
  const text = (m.body?.contentType ?? "html").toLowerCase() === "html" ? htmlToText(content.replace(EMOJI, "$1")) : tidyText(content);
  // Files shared in a chat are "reference" attachments pointing at OneDrive / SharePoint.
  const files = (m.attachments ?? []).filter((a) => a.contentType === "reference").map((a) => `[file: ${a.name?.trim() || "attachment"}]`);
  return tidyText([text, ...files].filter(Boolean).join("\n"));
}

/**
 * Map a chat message. `{ deleted }` for deleted messages, null for system
 * events, typing indicators and empty messages. Pure.
 */
export function mapChatMessage(m: GraphChatMessage, c: TeamsChatContext): NormalizedEmail | { deleted: string } | null {
  const externalId = `teams:${c.chat.id}:${m.id}`;
  if (m.deletedDateTime) return { deleted: externalId };
  if (m.messageType !== "message") return null;
  const bodyText = messageText(m);
  if (!bodyText) return null;

  const user = m.from?.user;
  const app = m.from?.application;
  const headers: Record<string, string> = {};
  let from: Participant;
  let senderId: string | null = null;
  let own = false;
  if (user) {
    // The sender's address comes from the chat roster; the connected account is always its own address.
    senderId = user.id ?? null;
    const member = senderId ? c.members.find((x) => x.userId === senderId) : undefined;
    own = Boolean(c.meId && senderId === c.meId) || Boolean(member && isMe(member, c));
    const email = (own ? (c.accountEmail ?? member?.email) : member?.email)?.trim().toLowerCase();
    // External or anonymous users can come without an address: a stable, non-routable stand-in.
    const slug = idSlug(senderId);
    from = participant(user.displayName ?? member?.name, email?.includes("@") ? email : slug ? `teams-user-${slug}@unknown.invalid` : "unknown@unknown.invalid");
  } else if (app) {
    // Bots, connectors and workflows: automated, like no-reply mail.
    const slug = idSlug(app.id);
    from = participant(app.displayName ?? "Teams app", slug ? `no-reply+${slug}@teams.invalid` : "no-reply@teams.invalid");
    headers["auto-submitted"] = "auto-generated";
  } else {
    from = { name: null, email: "unknown@unknown.invalid" };
  }

  const to: Participant[] = [];
  for (const member of c.members) {
    if (senderId && member.userId === senderId) continue;
    const p = memberParticipant(member, c);
    if (p && p.email !== from.email && !to.some((t) => t.email === p.email)) to.push(p);
  }

  const sentAt = new Date(m.createdDateTime ?? m.lastModifiedDateTime ?? 0);
  const lastRead = safeTime(c.chat.lastReadAt);
  return {
    externalId,
    threadExternalId: `teams:${c.chat.id}`,
    internetMessageId: null,
    inReplyTo: null,
    from,
    to,
    cc: [],
    subject: chatSubject(c.chat, c.members, c),
    sentAt,
    bodyText,
    labels: ["Teams", c.chat.chatType ?? "chat"],
    folder: "teams",
    isRead: own ? true : Number.isNaN(lastRead) ? null : sentAt.getTime() <= lastRead,
    headers,
    attachments: [],
    webUrl: m.webUrl ?? c.chat.webUrl ?? null,
    // Parsed through the schema above: reactions, history, cards and hosted content are dropped.
    raw: m,
  };
}

// ─── Graph requests ──────────────────────────────────────────────────────────

function chatsUrl(ordered: boolean) {
  const u = new URL(`${GRAPH}/me/chats`);
  u.searchParams.set("$expand", "lastMessagePreview");
  if (ordered) u.searchParams.set("$orderby", "lastMessagePreview/createdDateTime desc");
  u.searchParams.set("$top", String(CHATS_PER_PAGE));
  return u.toString();
}

function messagesUrl(chatId: string, since: string, pageSize: number) {
  const u = new URL(`${GRAPH}/chats/${encodeURIComponent(chatId)}/messages`);
  u.searchParams.set("$top", String(Math.min(50, Math.max(10, pageSize))));
  // Graph applies a lastModifiedDateTime filter only with the matching $orderby.
  u.searchParams.set("$orderby", "lastModifiedDateTime desc");
  u.searchParams.set("$filter", `lastModifiedDateTime gt ${since}`);
  return u.toString();
}

interface CallState {
  requests: number;
  items: NormalizedEmail[];
  deleted: string[];
  /** Chats skipped with 403 in this call. */
  forbidden: number;
  rosters: Map<string, TeamsMember[]>;
}

function isForbidden(error: unknown): boolean {
  return error instanceof ProviderHttpError && error.status === 403;
}

async function listChatsPage(ctx: ProviderContext, state: TeamsCursor, call: CallState) {
  const ordered = !state.unordered;
  state.roundStartedAt ??= ctx.now.toISOString();
  call.requests++;
  let page: DeltaPage<GraphChat>;
  try {
    page = await graphDeltaPage(ctx, state.chatsLink ?? chatsUrl(ordered), graphChatSchema);
  } catch (error) {
    if (isForbidden(error)) throw new ProviderAuthError(CHAT_READ_REQUIRED);
    if (error instanceof ProviderHttpError && error.status === 400 && ordered && !state.chatsLink) {
      state.unordered = true;
      ctx.log("teams: chat list ordering rejected; listing every chat");
      return;
    }
    throw error;
  }

  const since = Date.parse(state.since);
  let previous = Infinity;
  let sorted = true;
  let reachedOlder = false;
  for (const chat of page.items) {
    const preview = chat.lastMessagePreview;
    if (preview === null) continue;
    const at = safeTime(preview?.createdDateTime);
    if (!Number.isNaN(at)) {
      if (at > previous) sorted = false;
      previous = at;
      if (at <= since) {
        reachedOlder = true;
        continue;
      }
    }
    // Active since the window start, or activity unknown: read it.
    state.pendingChats.push({ id: chat.id, topic: chat.topic, chatType: chat.chatType, webUrl: chat.webUrl, lastReadAt: chat.viewpoint?.lastMessageReadDateTime ?? null });
  }
  if (ordered && !sorted) {
    state.unordered = true;
    ctx.log("teams: chat list came back unordered; listing every chat");
  }
  const stop = ordered && sorted && reachedOlder;
  state.chatsLink = stop ? undefined : (page.nextLink ?? undefined);
  state.listed = stop || !page.nextLink;
}

async function chatMembers(ctx: ProviderContext, chatId: string, call: CallState): Promise<TeamsMember[]> {
  const cached = call.rosters.get(chatId);
  if (cached) return cached;
  const members: TeamsMember[] = [];
  let url: string | null = `${GRAPH}/chats/${encodeURIComponent(chatId)}/members`;
  try {
    for (let i = 0; url && i < MEMBER_PAGES; i++) {
      call.requests++;
      const page: DeltaPage<z.infer<typeof graphMemberSchema>> = await graphDeltaPage(ctx, url, graphMemberSchema);
      for (const m of page.items) members.push({ userId: m.userId ?? null, name: m.displayName?.trim() || null, email: m.email?.trim().toLowerCase() || null });
      url = page.nextLink;
    }
  } catch (error) {
    // Without a roster senders keep their display names; addresses fall back to placeholders.
    if (!(error instanceof ProviderHttpError && (error.status === 403 || error.status === 404))) throw error;
    ctx.log(`teams: chat members unavailable (${error.status})`);
  }
  call.rosters.set(chatId, members);
  return members;
}

async function readChatPage(ctx: ProviderContext, state: TeamsCursor, call: CallState, pageSize: number) {
  const chat = state.pendingChats[0];
  call.requests++;
  let page: DeltaPage<GraphChatMessage>;
  try {
    page = await graphDeltaPage(ctx, chat.messagesLink ?? messagesUrl(chat.id, state.since, pageSize), graphChatMessageSchema);
  } catch (error) {
    if (error instanceof ProviderHttpError && (error.status === 404 || error.status === 403)) {
      // A chat that disappeared, or one this account can no longer open.
      state.pendingChats.shift();
      if (error.status === 403) call.forbidden++;
      ctx.log(`teams: skipped a chat (${error.status === 404 ? "no longer available" : "access denied"})`);
      return;
    }
    throw error;
  }
  state.readOk = true;

  for (const m of page.items) {
    const at = safeTime(m.lastModifiedDateTime ?? m.createdDateTime);
    if (!Number.isNaN(at) && (!state.newest || at > Date.parse(state.newest))) state.newest = new Date(at).toISOString();
  }
  const readable = page.items.some((m) => m.messageType === "message" && !m.deletedDateTime);
  const members = readable ? await chatMembers(ctx, chat.id, call) : [];
  const context: TeamsChatContext = { chat, members, meId: state.meId ?? null, accountEmail: ctx.connection.accountEmail?.toLowerCase() ?? null };
  const items: NormalizedEmail[] = [];
  for (const m of page.items) {
    const mapped = mapChatMessage(m, context);
    if (!mapped) continue;
    if ("deleted" in mapped) call.deleted.push(mapped.deleted);
    else items.push(mapped);
  }
  // Pages come newest first; hand them over oldest first.
  call.items.push(...items.reverse());

  if (page.nextLink) chat.messagesLink = page.nextLink;
  else state.pendingChats.shift();
}

/** Start the next round from the newest change seen, never past this round's start, minus an overlap. */
function nextRound(state: TeamsCursor, now: Date): TeamsCursor {
  const started = safeTime(state.roundStartedAt);
  const roundStart = Number.isNaN(started) ? now.getTime() : started;
  const newest = safeTime(state.newest);
  const next = Math.max(Date.parse(state.since), Math.min(roundStart, Number.isNaN(newest) ? roundStart : newest) - OVERLAP_MS);
  return { since: new Date(next).toISOString(), pendingChats: [], meId: state.meId, unordered: state.unordered, readOk: state.readOk };
}

const meSchema = z.object({ id: z.string() });

export const teamsChatProvider: EmailProvider = {
  kind: "EMAIL",

  async listChanges(ctx, cursor: SyncCursor | null, opts): Promise<ChangeSet<NormalizedEmail>> {
    const parsed = cursor ? cursorSchema.safeParse(cursor) : null;
    const state: TeamsCursor = parsed?.success ? structuredClone(parsed.data) : { since: opts.initialSince.toISOString(), pendingChats: [] };
    const call: CallState = { requests: 0, items: [], deleted: [], forbidden: 0, rosters: new Map() };

    if (!state.meId) {
      call.requests++;
      state.meId = (await providerJson(ctx, `${GRAPH}/me`, meSchema, { query: { $select: "id" } })).id;
    }
    while (call.requests < MAX_REQUESTS_PER_CALL && call.items.length < opts.pageSize) {
      if (state.pendingChats.length) await readChatPage(ctx, state, call, opts.pageSize);
      else if (!state.listed) await listChatsPage(ctx, state, call);
      else break;
    }
    // Every chat refused and none ever readable: the grant lacks Chat.Read, not one chat.
    if (call.forbidden && !state.readOk) throw new ProviderAuthError(CHAT_READ_REQUIRED);

    const done = Boolean(state.listed) && !state.pendingChats.length;
    return { items: call.items, deletedExternalIds: call.deleted, cursor: done ? nextRound(state, ctx.now) : state, hasMore: !done };
  },
};
