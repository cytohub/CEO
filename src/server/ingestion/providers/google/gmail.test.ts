import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CursorExpiredError } from "../../types";
import { fakeContext, json, routes, stubFetch } from "../test-helpers";
import { type GmailMessage, gmailProvider, parseGmailMessage } from "./gmail";

const b64 = (s: string, encoding: BufferEncoding = "utf8") => Buffer.from(s, encoding).toString("base64url");

/** A realistic Gmail format=full payload: mixed → alternative(plain, html) + PDF attachment + inline CSV. */
function realisticMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
  return {
    id: "18f2a1b2c3d4e5f6",
    threadId: "18f2a0000000aaaa",
    labelIds: ["INBOX", "UNREAD", "IMPORTANT", "CATEGORY_PERSONAL"],
    snippet: "Thanks for the update on the SOW…",
    historyId: "998877",
    internalDate: String(Date.parse("2026-10-06T08:00:05Z")),
    payload: {
      partId: "",
      mimeType: "multipart/mixed",
      filename: "",
      headers: [
        { name: "From", value: "=?UTF-8?B?RHIuIEhlbnJpayBTw7hyZW5zZW4=?= <Henrik@Calder.example>" },
        { name: "To", value: '"CEO" <ceo@cytohub.example>' },
        { name: "Cc", value: "Priya Raman <priya@cytohub.example>, priya@cytohub.example" },
        { name: "Subject", value: "Re: Calder paid validation study" },
        { name: "Date", value: "Tue, 6 Oct 2026 04:00:00 -0400" },
        { name: "Message-ID", value: "<CAF=abc123@mail.calder.example>" },
        { name: "In-Reply-To", value: "<calder-2@cytohub.example>" },
        { name: "List-Unsubscribe", value: "" },
        { name: "X-Unrelated", value: "ignored" },
      ],
      body: { size: 0 },
      parts: [
        {
          partId: "0",
          mimeType: "multipart/alternative",
          filename: "",
          headers: [{ name: "Content-Type", value: 'multipart/alternative; boundary="b2"' }],
          body: { size: 0 },
          parts: [
            {
              partId: "0.0",
              mimeType: "text/plain",
              filename: "",
              headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }],
              body: {
                size: 300,
                data: b64(
                  "Hi,\r\n\r\nThanks for the update on the SOW. One more request from our side: please send the revised data package by Friday. Once we review it, we can discuss expanding the study.\r\n\r\nBest regards,\r\nHenrik\r\n\r\nOn Mon, Oct 5, 2026 at 6:00 AM CEO <ceo@cytohub.example> wrote:\r\n> We will provide the updated SOW next week.\r\n",
                ),
              },
            },
            {
              partId: "0.1",
              mimeType: "text/html",
              filename: "",
              headers: [{ name: "Content-Type", value: 'text/html; charset="UTF-8"' }],
              body: { size: 400, data: b64("<div>Hi,</div><div>HTML version should not be used</div>") },
            },
          ],
        },
        {
          partId: "1",
          mimeType: "application/pdf",
          filename: "Calder_data_request.pdf",
          headers: [
            { name: "Content-Type", value: 'application/pdf; name="Calder_data_request.pdf"' },
            { name: "Content-Disposition", value: 'attachment; filename="Calder_data_request.pdf"' },
          ],
          body: { size: 48213, attachmentId: "ANGjdJ8-att-1" },
        },
        {
          partId: "2",
          mimeType: "text/csv",
          filename: "panel.csv",
          headers: [{ name: "Content-Disposition", value: 'attachment; filename="panel.csv"' }],
          body: { size: 27, data: b64("compound,ic50\nCAL-0412,12.4") },
        },
      ],
    },
    ...overrides,
  };
}

describe("parseGmailMessage", () => {
  it("maps headers, prefers text/plain, and collects attachment metadata", async () => {
    const fetched: string[] = [];
    const email = parseGmailMessage(realisticMessage(), {
      fetchAttachment: async (mid, aid) => {
        fetched.push(`${mid}/${aid}`);
        return Buffer.from("%PDF-1.4");
      },
    });
    assert.ok(email);
    assert.equal(email.externalId, "18f2a1b2c3d4e5f6");
    assert.equal(email.threadExternalId, "18f2a0000000aaaa");
    assert.deepEqual(email.from, { name: "Dr. Henrik Sørensen", email: "henrik@calder.example" });
    assert.deepEqual(email.to, [{ name: "CEO", email: "ceo@cytohub.example" }]);
    assert.deepEqual(email.cc, [{ name: "Priya Raman", email: "priya@cytohub.example" }]);
    assert.equal(email.subject, "Re: Calder paid validation study");
    assert.equal(email.sentAt.toISOString(), "2026-10-06T08:00:00.000Z");
    assert.equal(email.internetMessageId, "<CAF=abc123@mail.calder.example>");
    assert.equal(email.inReplyTo, "<calder-2@cytohub.example>");
    assert.match(email.bodyText, /please send the revised data package by Friday/);
    assert.doesNotMatch(email.bodyText, /HTML version/);
    assert.equal(email.isRead, false);
    assert.equal(email.folder, "INBOX");
    assert.deepEqual(Object.keys(email.headers ?? {}), [], "empty List-Unsubscribe and unrelated headers are dropped");

    assert.equal(email.attachments.length, 2);
    const [pdf, csv] = email.attachments;
    assert.deepEqual({ ...pdf, fetch: undefined }, { externalId: "ANGjdJ8-att-1", filename: "Calder_data_request.pdf", mimeType: "application/pdf", sizeBytes: 48213, fetch: undefined });
    assert.equal((await pdf.fetch!()).toString(), "%PDF-1.4");
    assert.deepEqual(fetched, ["18f2a1b2c3d4e5f6/ANGjdJ8-att-1"]);
    assert.equal((await csv.fetch!()).toString(), "compound,ic50\nCAL-0412,12.4", "inline attachment data needs no request");
  });

  it("converts HTML-only bodies and honors the declared charset", () => {
    const html = realisticMessage({
      payload: {
        mimeType: "text/html",
        headers: [
          { name: "From", value: "Karen Liu <karen@brightwater.example>" },
          { name: "Subject", value: "=?iso-8859-1?Q?Caf=E9?=" },
          { name: "Content-Type", value: "text/html; charset=ISO-8859-1" },
        ],
        body: { size: 60, data: b64("<p>Clause 7.3 is open.</p><p>Café at 9?</p>", "latin1") },
      },
    });
    const email = parseGmailMessage(html)!;
    assert.equal(email.subject, "Café");
    assert.equal(email.bodyText, "Clause 7.3 is open.\n\nCafé at 9?");
    assert.equal(email.sentAt.toISOString(), "2026-10-06T08:00:05.000Z", "falls back to internalDate without a Date header");
  });

  it("skips drafts, chats, spam and trash", () => {
    for (const label of ["DRAFT", "CHAT", "SPAM", "TRASH"]) assert.equal(parseGmailMessage(realisticMessage({ labelIds: ["INBOX", label] })), null, label);
  });

  it("marks sent mail", () => {
    const sent = parseGmailMessage(realisticMessage({ labelIds: ["SENT"] }))!;
    assert.equal(sent.folder, "SENT");
    assert.equal(sent.isRead, true);
  });
});

describe("gmailProvider.listChanges", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("initial sync: captures the history id, lists recent mail, pages, then switches to history", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /gmail\.googleapis\.com\/gmail\/v1\/users\/me\/profile$/, () => json({ emailAddress: "ceo@cytohub.example", historyId: "5000" })],
        [
          "GET",
          /\/users\/me\/messages$/,
          (req) => (req.url.searchParams.get("pageToken") ? json({ messages: [{ id: "m2" }] }) : json({ messages: [{ id: "m1" }, { id: "gone" }], nextPageToken: "p2" })),
        ],
        ["GET", /\/messages\/gone$/, () => json({ error: { code: 404 } }, { status: 404 })],
        ["GET", /\/messages\/m\d$/, (req) => json(realisticMessage({ id: req.url.pathname.split("/").pop()!, threadId: "t1" }))],
      ]),
    );
    restore = stub.restore;
    const ctx = fakeContext();
    const first = await gmailProvider.listChanges(ctx, null, { pageSize: 2, initialSince: new Date("2026-07-08T14:00:00Z") });
    assert.deepEqual(first.items.map((i) => i.externalId), ["m1"]);
    assert.equal(first.hasMore, true);
    assert.deepEqual(first.cursor, { mode: "initial", startHistoryId: "5000", pageToken: "p2" });
    const listReq = stub.requests.find((r) => r.url.pathname.endsWith("/messages"))!;
    assert.equal(listReq.url.searchParams.get("q"), "newer_than:90d -in:chats -in:drafts");
    assert.equal(listReq.headers.get("authorization"), "Bearer access-token");

    const second = await gmailProvider.listChanges(ctx, first.cursor, { pageSize: 2, initialSince: new Date("2026-07-08T14:00:00Z") });
    assert.deepEqual(second.items.map((i) => i.externalId), ["m2"]);
    assert.equal(second.hasMore, false);
    assert.deepEqual(second.cursor, { mode: "incremental", historyId: "5000" });
  });

  it("incremental sync: added, deleted, trashed and label changes", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/users\/me\/history$/,
          () =>
            json({
              history: [
                { messagesAdded: [{ message: { id: "new1", labelIds: ["INBOX"] } }, { message: { id: "draft1", labelIds: ["DRAFT"] } }] },
                { messagesDeleted: [{ message: { id: "old1" } }] },
                { labelsAdded: [{ message: { id: "old2" }, labelIds: ["TRASH"] }, { message: { id: "old3" }, labelIds: ["STARRED"] }] },
              ],
              historyId: "5100",
            }),
        ],
        ["GET", /\/messages\/new1$/, () => json(realisticMessage({ id: "new1" }))],
      ]),
    );
    restore = stub.restore;
    const res = await gmailProvider.listChanges(fakeContext(), { mode: "incremental", historyId: "5000" }, { pageSize: 50, initialSince: new Date(0) });
    assert.deepEqual(res.items.map((i) => i.externalId), ["new1"]);
    assert.deepEqual(res.deletedExternalIds.sort(), ["old1", "old2"]);
    assert.deepEqual(res.cursor, { mode: "incremental", historyId: "5100" });
    const historyReq = stub.requests[0];
    assert.equal(historyReq.url.searchParams.get("startHistoryId"), "5000");
    assert.deepEqual(historyReq.url.searchParams.getAll("historyTypes"), ["messageAdded", "messageDeleted", "labelAdded"]);
    assert.ok(!stub.requests.some((r) => r.url.pathname.endsWith("/old3")), "label churn does not refetch");
  });

  it("a 404 on history means the cursor expired", async () => {
    restore = stubFetch(routes([["GET", /\/history$/, () => json({ error: { code: 404, status: "NOT_FOUND" } }, { status: 404 })]])).restore;
    await assert.rejects(() => gmailProvider.listChanges(fakeContext(), { mode: "incremental", historyId: "1" }, { pageSize: 10, initialSince: new Date(0) }), CursorExpiredError);
  });
});
