import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { emailDirection, isAutomatedEmail } from "../../normalize/email";
import { type NormalizedEmail, ProviderAuthError } from "../../types";
import { type RecordedRequest, fakeContext, json, routes, stubFetch } from "../test-helpers";
import { CHAT_READ_REQUIRED, type GraphChatMessage, type TeamsChatContext, type TeamsMember, chatSubject, mapChatMessage, teamsChatProvider } from "./teams";

const ME = "11111111-1111-4111-8111-111111111111";
const KAREN = "22222222-2222-4222-8222-222222222222";
const MARCUS = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "ceo@cytohub.example";

const roster: TeamsMember[] = [
  // The account's own roster address differs from the connection's: its messages still use the connection's.
  { userId: ME, name: "Robert Bauer", email: "robert.bauer@cytohub.example" },
  { userId: KAREN, name: "Karen Liu", email: "karen@brightwater.example" },
  { userId: MARCUS, name: "Marcus Hale", email: "marcus@cytohub.example" },
];

const chatContext = (over: Partial<TeamsChatContext> = {}): TeamsChatContext => ({
  chat: { id: "19:abc@thread.v2", topic: null, chatType: "group", webUrl: "https://teams.microsoft.com/l/chat/19%3Aabc%40thread.v2/0", lastReadAt: "2026-10-06T09:30:00Z" },
  members: roster,
  meId: ME,
  accountEmail: ACCOUNT,
  ...over,
});

const message: GraphChatMessage = {
  id: "1728205200000",
  chatId: "19:abc@thread.v2",
  messageType: "message",
  createdDateTime: "2026-10-06T09:00:00.000Z",
  lastModifiedDateTime: "2026-10-06T09:00:00.000Z",
  deletedDateTime: null,
  webUrl: null,
  from: { user: { id: KAREN, displayName: "Karen Liu", userIdentityType: "aadUser" }, application: null },
  body: {
    contentType: "html",
    content: '<p><at id="0">Robert</at> can you sign off clause 7.3 by Friday? <emoji id="1f44d_thumbsup" alt="&#128077;" title="Thumbs up"></emoji></p><attachment id="att-1"></attachment>',
  },
  attachments: [
    { id: "att-1", contentType: "reference", contentUrl: "https://brightwater.sharepoint.example/MSA_v5_redline.docx", name: "MSA_v5_redline.docx" },
    { id: "1728200000000", contentType: "messageReference", contentUrl: null, name: null },
  ],
};

const map = (m: Partial<GraphChatMessage>, over: Partial<TeamsChatContext> = {}) => mapChatMessage({ ...message, ...m }, chatContext(over));

describe("mapChatMessage", () => {
  it("maps a chat message: roster addresses, thread ids, HTML text, shared files, read state", () => {
    const email = map({}) as NormalizedEmail;
    assert.equal(email.externalId, "teams:19:abc@thread.v2:1728205200000");
    assert.equal(email.threadExternalId, "teams:19:abc@thread.v2");
    assert.equal(email.internetMessageId, null);
    assert.deepEqual(email.from, { name: "Karen Liu", email: "karen@brightwater.example" });
    assert.deepEqual(email.to, [
      { name: "Robert Bauer", email: ACCOUNT },
      { name: "Marcus Hale", email: "marcus@cytohub.example" },
    ]);
    assert.deepEqual(email.cc, []);
    assert.equal(email.subject, "Teams chat with Karen Liu, Marcus Hale");
    assert.equal(email.sentAt.toISOString(), "2026-10-06T09:00:00.000Z");
    assert.equal(email.bodyText, "Robert can you sign off clause 7.3 by Friday? 👍\n[file: MSA_v5_redline.docx]");
    assert.deepEqual(email.attachments, []);
    assert.deepEqual(email.labels, ["Teams", "group"]);
    assert.equal(email.folder, "teams");
    assert.equal(email.webUrl, "https://teams.microsoft.com/l/chat/19%3Aabc%40thread.v2/0", "falls back to the chat link");
    assert.equal(email.isRead, true, "sent before the account last read the chat");
    assert.equal(isAutomatedEmail(email), false);
    assert.equal(emailDirection(email, { accountEmail: ACCOUNT, ceoEmail: null }), "INBOUND");
    const later = map({ createdDateTime: "2026-10-06T10:00:00Z", webUrl: "https://teams.microsoft.com/l/message/x" }) as NormalizedEmail;
    assert.equal(later.isRead, false, "sent after the last read time");
    assert.equal(later.webUrl, "https://teams.microsoft.com/l/message/x");
  });

  it("the account's own messages come from the connection address", () => {
    const email = map({ from: { user: { id: ME, displayName: "Robert Bauer" } }, body: { contentType: "text", content: "Will do.\r\nSending tonight." }, attachments: [] }) as NormalizedEmail;
    assert.deepEqual(email.from, { name: "Robert Bauer", email: ACCOUNT });
    assert.deepEqual(email.to.map((p) => p.email), ["karen@brightwater.example", "marcus@cytohub.example"]);
    assert.equal(email.bodyText, "Will do.\nSending tonight.");
    assert.equal(email.isRead, true);
    assert.equal(emailDirection(email, { accountEmail: ACCOUNT, ceoEmail: null }), "OUTBOUND");
  });

  it("bot and app messages are automated", () => {
    const email = map({ from: { user: null, application: { id: "A1B2C3D4-0000-4000-8000-000000000000", displayName: "Workflows", applicationIdentityType: "bot" } } }) as NormalizedEmail;
    assert.deepEqual(email.from, { name: "Workflows", email: "no-reply+a1b2c3d4-0000-4000-8000-000000000000@teams.invalid" });
    assert.equal(email.headers?.["auto-submitted"], "auto-generated");
    assert.equal(isAutomatedEmail(email), true);
    assert.equal(email.to.length, 3, "everyone in the chat received it");
  });

  it("senders missing from the roster keep their name with a stable stand-in address", () => {
    const email = map({ from: { user: { id: "99999999-9999-4999-8999-999999999999", displayName: "Guest Reviewer" } } }) as NormalizedEmail;
    assert.deepEqual(email.from, { name: "Guest Reviewer", email: "teams-user-99999999-9999-4999-8999-999999999999@unknown.invalid" });
    assert.equal(email.to.length, 3);
  });

  it("skips system events and empty messages; reports deleted messages", () => {
    assert.equal(map({ messageType: "systemEventMessage", from: null, body: { contentType: "html", content: "<systemEventMessage/>" } }), null);
    assert.equal(map({ messageType: "unknownFutureValue" }), null);
    assert.equal(map({ body: { contentType: "html", content: "<p> </p>" }, attachments: [] }), null);
    assert.deepEqual(map({ deletedDateTime: "2026-10-06T09:05:00Z", body: { contentType: "html", content: "" } }), { deleted: "teams:19:abc@thread.v2:1728205200000" });
  });
});

describe("chatSubject", () => {
  const self = { meId: ME, accountEmail: ACCOUNT };
  it("uses the topic, else the other members' names", () => {
    assert.equal(chatSubject({ topic: " Brightwater MSA ", chatType: "group" }, roster, self), "Brightwater MSA");
    assert.equal(chatSubject({ topic: "Q4 board prep", chatType: "meeting" }, roster, self), "Q4 board prep");
    assert.equal(chatSubject({ topic: null, chatType: "meeting" }, roster, self), "Teams meeting chat");
    assert.equal(chatSubject({ topic: null, chatType: "oneOnOne" }, roster.slice(0, 2), self), "Teams chat with Karen Liu");
    const crowd = ["Ana", "Ben", "Cai", "Dee", "Eli"].map((name, i) => ({ userId: `u${i}`, name, email: null }));
    assert.equal(chatSubject({ topic: null, chatType: "group" }, [roster[0], ...crowd], self), "Teams chat with Ana, Ben, Cai and 2 others");
    assert.equal(chatSubject({ topic: null, chatType: "oneOnOne" }, [roster[0]], self), "Teams chat");
  });
});

// ─── listChanges ─────────────────────────────────────────────────────────────

const CHAT_A = "19:chat-a@thread.v2";
const CHAT_B = "19:chat-b@thread.v2";
const CHAT_EMPTY = "19:chat-empty@thread.v2";
const CHAT_OLD = "19:chat-old@thread.v2";
const CHAT_GONE = "19:chat-gone@thread.v2";

function graphChat(id: string, lastMessageAt: string | null) {
  return {
    id,
    topic: null,
    chatType: "oneOnOne",
    webUrl: `https://teams.microsoft.com/l/chat/${encodeURIComponent(id)}/0`,
    viewpoint: { isHidden: false, lastMessageReadDateTime: "2026-10-06T08:30:00Z" },
    lastMessagePreview: lastMessageAt ? { id: "p", createdDateTime: lastMessageAt, isDeleted: false, messageType: "message" } : null,
  };
}

function graphMessage(id: string, at: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    messageType: "message",
    createdDateTime: at,
    lastModifiedDateTime: at,
    deletedDateTime: null,
    webUrl: null,
    from: { user: { id: KAREN, displayName: "Karen Liu", userIdentityType: "aadUser" }, application: null, device: null },
    body: { contentType: "text", content: `Message ${id}` },
    attachments: [],
    reactions: [{ reactionType: "like", user: { id: ME } }],
    messageHistory: [],
    ...extra,
  };
}

const graphRoster = [
  { "@odata.type": "#microsoft.graph.aadUserConversationMember", id: "m-me", roles: [], displayName: "Robert Bauer", userId: ME, email: ACCOUNT },
  { "@odata.type": "#microsoft.graph.aadUserConversationMember", id: "m-karen", roles: [], displayName: "Karen Liu", userId: KAREN, email: "Karen@Brightwater.example" },
];

const chatIdOf = (req: RecordedRequest) => decodeURIComponent(req.url.pathname.split("/")[3] ?? "");
const isChatList = (req: RecordedRequest) => req.url.pathname === "/v1.0/me/chats";
const isMessages = (req: RecordedRequest, chatId?: string) => /\/messages$/.test(req.url.pathname) && (!chatId || chatIdOf(req) === chatId);

const NOW = new Date("2026-10-06T14:00:00Z");
const INITIAL = new Date("2026-09-06T14:00:00Z");

describe("teamsChatProvider.listChanges", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("reads active chats newest first, pages messages across calls and advances since", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /\/v1\.0\/me$/, () => json({ id: ME })],
        [
          "GET",
          /\/v1\.0\/me\/chats$/,
          (req) => {
            const skip = req.url.searchParams.get("$skiptoken");
            if (!skip) {
              return json({
                value: [graphChat(CHAT_A, "2026-10-06T09:00:00Z"), graphChat(CHAT_EMPTY, null)],
                "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/chats?$expand=lastMessagePreview&$orderby=lastMessagePreview%2fcreatedDateTime+desc&$top=50&$skiptoken=p2",
              });
            }
            if (skip === "p2") {
              return json({
                value: [graphChat(CHAT_B, "2026-10-05T12:00:00Z"), graphChat(CHAT_OLD, "2026-08-01T10:00:00Z")],
                "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/chats?$skiptoken=p3",
              });
            }
            return json({ value: [graphChat("19:never@thread.v2", "2026-07-01T00:00:00Z")] });
          },
        ],
        [
          "GET",
          /\/chats\/[^/]+\/messages$/,
          (req) => {
            if (chatIdOf(req) === CHAT_A) {
              return req.url.searchParams.get("$skiptoken") === "a2"
                ? json({
                    value: [
                      graphMessage("a0", "2026-10-06T07:30:00Z", { deletedDateTime: "2026-10-06T07:30:00Z", body: { contentType: "html", content: "" } }),
                      graphMessage("a1", "2026-10-06T07:00:00Z"),
                    ],
                  })
                : json({
                    value: [
                      graphMessage("a3", "2026-10-06T09:00:00Z", { body: { contentType: "html", content: "<p>Can you send the <b>Q3 numbers</b>?</p>" } }),
                      graphMessage("a2", "2026-10-06T08:00:00Z", { messageType: "systemEventMessage", from: null, body: { contentType: "html", content: "<systemEventMessage/>" } }),
                    ],
                    // Graph's own links carry the chat id unencoded.
                    "@odata.nextLink": `https://graph.microsoft.com/v1.0/chats/${CHAT_A}/messages?$top=10&$skiptoken=a2`,
                  });
            }
            if (chatIdOf(req) === CHAT_B) return json({ value: [graphMessage("b1", "2026-10-05T12:00:00Z", { from: { user: { id: ME, displayName: "Robert Bauer" } } })] });
            return json({ error: { code: "NotFound" } }, { status: 404 });
          },
        ],
        ["GET", /\/chats\/[^/]+\/members$/, () => json({ value: graphRoster })],
      ]),
    );
    restore = stub.restore;
    const ctx = fakeContext({ provider: "TEAMS_CHAT", accountEmail: ACCOUNT }, { now: NOW });
    const opts = { pageSize: 1, initialSince: INITIAL };

    const p1 = await teamsChatProvider.listChanges(ctx, null, opts);
    assert.deepEqual(p1.items.map((i) => i.externalId), [`teams:${CHAT_A}:a3`]);
    assert.equal(p1.items[0].bodyText, "Can you send the Q3 numbers?");
    assert.deepEqual(p1.items[0].from, { name: "Karen Liu", email: "karen@brightwater.example" });
    assert.deepEqual(p1.items[0].to, [{ name: "Robert Bauer", email: ACCOUNT }]);
    assert.equal(p1.items[0].subject, "Teams chat with Karen Liu");
    assert.deepEqual(p1.items[0].labels, ["Teams", "oneOnOne"]);
    assert.equal(p1.items[0].isRead, false, "newer than the chat's last read time");
    assert.equal("reactions" in (p1.items[0].raw as object), false, "raw is trimmed");
    assert.equal(p1.hasMore, true, "chat A has another page");

    const list = stub.requests.find(isChatList)!;
    assert.equal(list.url.searchParams.get("$expand"), "lastMessagePreview");
    assert.equal(list.url.searchParams.get("$orderby"), "lastMessagePreview/createdDateTime desc");
    assert.equal(list.url.searchParams.get("$top"), "50");
    const firstMessages = stub.requests.find((r) => isMessages(r, CHAT_A))!;
    assert.equal(firstMessages.url.searchParams.get("$filter"), "lastModifiedDateTime gt 2026-09-06T14:00:00.000Z");
    assert.equal(firstMessages.url.searchParams.get("$orderby"), "lastModifiedDateTime desc");
    assert.equal(firstMessages.url.searchParams.get("$top"), "10");
    assert.equal(firstMessages.headers.get("authorization"), "Bearer access-token");

    const p2 = await teamsChatProvider.listChanges(ctx, p1.cursor, opts);
    assert.deepEqual(p2.items.map((i) => i.externalId), [`teams:${CHAT_A}:a1`]);
    assert.deepEqual(p2.deletedExternalIds, [`teams:${CHAT_A}:a0`]);
    assert.equal(p2.hasMore, true, "the chat list has another page");
    assert.equal(stub.requests.filter((r) => isMessages(r, CHAT_A)).at(-1)!.url.searchParams.get("$skiptoken"), "a2", "resumes from the stored nextLink");

    const p3 = await teamsChatProvider.listChanges(ctx, p2.cursor, opts);
    assert.deepEqual(p3.items.map((i) => i.externalId), [`teams:${CHAT_B}:b1`]);
    assert.equal(p3.items[0].from.email, ACCOUNT);
    assert.equal(p3.hasMore, false);
    assert.equal(p3.cursor.since, "2026-10-06T08:55:00.000Z", "newest change seen minus the overlap");
    assert.deepEqual(p3.cursor.pendingChats, []);

    assert.equal(stub.requests.filter((r) => r.url.pathname === "/v1.0/me").length, 1, "the account id is looked up once");
    assert.equal(stub.requests.filter(isChatList).some((r) => r.url.searchParams.get("$skiptoken") === "p3"), false, "listing stops at the first chat older than the window");
    assert.equal(stub.requests.some((r) => isMessages(r, CHAT_EMPTY) || isMessages(r, CHAT_OLD)), false, "inactive chats are not read");

    // The next round reads from the advanced window.
    const before = stub.requests.length;
    const p4 = await teamsChatProvider.listChanges(ctx, p3.cursor, { pageSize: 50, initialSince: INITIAL });
    assert.equal(stub.requests.slice(before).find((r) => isMessages(r, CHAT_A))!.url.searchParams.get("$filter"), "lastModifiedDateTime gt 2026-10-06T08:55:00.000Z");
    assert.equal(p4.hasMore, false);
  });

  it("lists every chat when the service returns them unordered", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /\/v1\.0\/me$/, () => json({ id: ME })],
        [
          "GET",
          /\/v1\.0\/me\/chats$/,
          (req) =>
            req.url.searchParams.get("$skiptoken") === "p2"
              ? json({ value: [graphChat(CHAT_B, "2026-10-05T12:00:00Z")] })
              : json({
                  value: [graphChat(CHAT_OLD, "2026-08-01T10:00:00Z"), graphChat(CHAT_A, "2026-10-06T09:00:00Z")],
                  "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/chats?$skiptoken=p2",
                }),
        ],
        ["GET", /\/chats\/[^/]+\/messages$/, (req) => json({ value: [graphMessage(`${chatIdOf(req) === CHAT_A ? "a" : "b"}1`, "2026-10-05T12:00:00Z")] })],
        ["GET", /\/chats\/[^/]+\/members$/, () => json({ value: graphRoster })],
      ]),
    );
    restore = stub.restore;
    const ctx = fakeContext({ provider: "TEAMS_CHAT", accountEmail: ACCOUNT }, { now: NOW });

    const p1 = await teamsChatProvider.listChanges(ctx, null, { pageSize: 50, initialSince: INITIAL });
    assert.deepEqual(p1.items.map((i) => i.externalId), [`teams:${CHAT_A}:a1`, `teams:${CHAT_B}:b1`]);
    assert.equal(p1.hasMore, false);
    assert.equal(p1.cursor.unordered, true);

    await teamsChatProvider.listChanges(ctx, p1.cursor, { pageSize: 50, initialSince: INITIAL });
    assert.equal(stub.requests.filter(isChatList).at(-1)!.url.searchParams.has("$orderby"), false, "later rounds list without ordering");
  });

  it("falls back to an unordered listing when the ordering is rejected", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /\/v1\.0\/me$/, () => json({ id: ME })],
        ["GET", /\/v1\.0\/me\/chats$/, (req) => (req.url.searchParams.has("$orderby") ? json({ error: { code: "BadRequest" } }, { status: 400 }) : json({ value: [graphChat(CHAT_A, "2026-10-06T09:00:00Z")] }))],
        ["GET", /\/chats\/[^/]+\/messages$/, () => json({ value: [graphMessage("a1", "2026-10-06T09:00:00Z")] })],
        ["GET", /\/chats\/[^/]+\/members$/, () => json({ value: graphRoster })],
      ]),
    );
    restore = stub.restore;
    const ctx = fakeContext({ provider: "TEAMS_CHAT", accountEmail: ACCOUNT }, { now: NOW });
    const p = await teamsChatProvider.listChanges(ctx, null, { pageSize: 50, initialSince: INITIAL });
    assert.deepEqual(p.items.map((i) => i.externalId), [`teams:${CHAT_A}:a1`]);
    assert.equal(p.cursor.unordered, true);
    assert.equal(stub.requests.filter(isChatList).length, 2);
  });

  it("403 on the chat list asks for a reconnect with Chat.Read", async () => {
    restore = stubFetch(
      routes([
        ["GET", /\/v1\.0\/me$/, () => json({ id: ME })],
        ["GET", /\/v1\.0\/me\/chats$/, () => json({ error: { code: "Forbidden", message: "Missing scope permissions on the request." } }, { status: 403 })],
      ]),
    ).restore;
    const ctx = fakeContext({ provider: "TEAMS_CHAT", accountEmail: ACCOUNT }, { now: NOW });
    await assert.rejects(
      () => teamsChatProvider.listChanges(ctx, null, { pageSize: 50, initialSince: INITIAL }),
      (error) => error instanceof ProviderAuthError && error.message === CHAT_READ_REQUIRED,
    );
  });

  it("403 on every chat's messages asks for a reconnect; one refused or vanished chat is skipped", async () => {
    const forbidden = () => json({ error: { code: "Forbidden" } }, { status: 403 });
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/chats\/[^/]+\/messages$/,
          (req) => (chatIdOf(req) === CHAT_B ? json({ value: [graphMessage("b1", "2026-10-06T09:00:00Z")] }) : chatIdOf(req) === CHAT_GONE ? json({ error: { code: "NotFound" } }, { status: 404 }) : forbidden()),
        ],
        ["GET", /\/chats\/[^/]+\/members$/, () => json({ value: graphRoster })],
      ]),
    );
    restore = stub.restore;
    const ctx = fakeContext({ provider: "TEAMS_CHAT", accountEmail: ACCOUNT }, { now: NOW });
    const opts = { pageSize: 50, initialSince: INITIAL };
    const cursor = (ids: string[], extra: Record<string, unknown> = {}) => ({
      since: "2026-10-01T00:00:00.000Z",
      roundStartedAt: NOW.toISOString(),
      listed: true,
      meId: ME,
      pendingChats: ids.map((id) => ({ id, chatType: "oneOnOne" })),
      ...extra,
    });

    await assert.rejects(
      () => teamsChatProvider.listChanges(ctx, cursor([CHAT_A, CHAT_OLD]), opts),
      (error) => error instanceof ProviderAuthError && error.message === CHAT_READ_REQUIRED,
    );

    const p = await teamsChatProvider.listChanges(ctx, cursor([CHAT_A, CHAT_GONE, CHAT_B]), opts);
    assert.deepEqual(p.items.map((i) => i.externalId), [`teams:${CHAT_B}:b1`]);
    assert.equal(p.hasMore, false);
    assert.equal(p.cursor.readOk, true);

    const later = await teamsChatProvider.listChanges(ctx, cursor([CHAT_A], { readOk: true }), opts);
    assert.deepEqual(later.items, [], "a chat refused after messages were readable is skipped");
    assert.equal(later.hasMore, false);
  });

  it("refuses paging links to other hosts", async () => {
    restore = stubFetch(() => json({ value: [] })).restore;
    const ctx = fakeContext({ provider: "TEAMS_CHAT", accountEmail: ACCOUNT }, { now: NOW });
    const opts = { pageSize: 50, initialSince: INITIAL };
    await assert.rejects(() => teamsChatProvider.listChanges(ctx, { since: INITIAL.toISOString(), meId: ME, pendingChats: [], chatsLink: "https://evil.example/steal" }, opts), /Refusing to follow/);
    await assert.rejects(
      () => teamsChatProvider.listChanges(ctx, { since: INITIAL.toISOString(), meId: ME, listed: true, pendingChats: [{ id: CHAT_A, messagesLink: "https://graph.microsoft.com.evil.example/v1.0/chats" }] }, opts),
      /Refusing to follow/,
    );
  });
});
