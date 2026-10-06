import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { CursorExpiredError, type NormalizedCalendarEvent } from "../../types";
import { fakeContext, json, routes, stubFetch } from "../test-helpers";
import { type GraphEvent, mapGraphEvent } from "./calendar";
import { parseGraphDateTime } from "./graph";
import { type GraphMessage, mapGraphMessage, outlookMailProvider } from "./mail";

const message: GraphMessage = {
  id: "AAMkAGI2-msg-1",
  internetMessageId: "<BN6PR11MB1234@namprd11.prod.outlook.example>",
  conversationId: "AAQkAGI2-conv-1",
  subject: "RE: Brightwater MSA v5: clause 7.3",
  body: { contentType: "text", content: "Hi,\r\n\r\nLegal will return clause 7.3 by Friday.\r\n\r\nThanks,\r\nKaren" },
  from: { emailAddress: { name: "Karen Liu", address: "Karen@Brightwater.example" } },
  toRecipients: [{ emailAddress: { name: "CEO", address: "ceo@cytohub.example" } }],
  ccRecipients: [{ emailAddress: { name: "priya@cytohub.example", address: "priya@cytohub.example" } }, { emailAddress: { name: "Nobody", address: null } }],
  sentDateTime: "2026-10-06T00:00:00Z",
  receivedDateTime: "2026-10-06T00:00:02Z",
  isRead: false,
  hasAttachments: true,
  webLink: "https://outlook.office365.com/owa/?ItemID=AAMkAGI2",
  categories: ["Deals"],
};

describe("mapGraphMessage", () => {
  it("maps recipients, conversation, folder labels, headers and attachments", async () => {
    const fetched: string[] = [];
    const email = mapGraphMessage(message, {
      folder: "inbox",
      headers: [
        { name: "List-Unsubscribe", value: "<mailto:u@x>" },
        { name: "In-Reply-To", value: "<prev@cytohub.example>" },
        { name: "Received", value: "from mail…" },
      ],
      attachments: [
        { "@odata.type": "#microsoft.graph.fileAttachment", id: "att-1", name: "MSA_v5_redline.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 52000, isInline: false },
        { "@odata.type": "#microsoft.graph.fileAttachment", id: "img-1", name: "logo.png", contentType: "image/png", size: 2000, isInline: true },
        { "@odata.type": "#microsoft.graph.itemAttachment", id: "item-1", name: "Fwd message", size: 9000, isInline: false },
      ],
      fetchAttachment: async (id) => {
        fetched.push(id);
        return Buffer.from("PK");
      },
    })!;
    assert.equal(email.externalId, "AAMkAGI2-msg-1");
    assert.equal(email.threadExternalId, "AAQkAGI2-conv-1");
    assert.deepEqual(email.from, { name: "Karen Liu", email: "karen@brightwater.example" });
    assert.deepEqual(email.cc, [{ name: null, email: "priya@cytohub.example" }]);
    assert.equal(email.sentAt.toISOString(), "2026-10-06T00:00:00.000Z");
    assert.equal(email.bodyText, "Hi,\n\nLegal will return clause 7.3 by Friday.\n\nThanks,\nKaren");
    assert.deepEqual(email.labels, ["INBOX", "Deals"]);
    assert.equal(email.inReplyTo, "<prev@cytohub.example>");
    assert.deepEqual(email.headers, { "list-unsubscribe": "<mailto:u@x>", "in-reply-to": "<prev@cytohub.example>" });
    assert.deepEqual(email.attachments.map((a) => a.filename), ["MSA_v5_redline.docx"]);
    await email.attachments[0].fetch!();
    assert.deepEqual(fetched, ["att-1"]);
  });

  it("converts HTML bodies when the text preference is ignored; skips removed and drafts", () => {
    const html = mapGraphMessage({ ...message, body: { contentType: "html", content: "<p>Hello <b>there</b></p>" } }, { folder: "sentitems" })!;
    assert.equal(html.bodyText, "Hello there");
    assert.equal(html.folder, "SENT");
    assert.equal(mapGraphMessage({ ...message, "@removed": { reason: "deleted" } }, { folder: "inbox" }), null);
    assert.equal(mapGraphMessage({ ...message, isDraft: true }, { folder: "inbox" }), null);
  });
});

describe("outlookMailProvider.listChanges", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("visits Inbox then Sent Items with a deltaLink per folder, batching headers and attachments", async () => {
    const stub = stubFetch(
      routes([
        [
          "GET",
          /\/me\/mailFolders\/inbox\/messages\/delta$/,
          (req) =>
            req.url.searchParams.get("$deltatoken")
              ? json({ value: [{ id: "x-removed", "@removed": { reason: "deleted" } }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=i2" })
              : json({ value: [message], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=i1" }),
        ],
        [
          "GET",
          /\/me\/mailFolders\/sentitems\/messages\/delta$/,
          () => json({ value: [{ ...message, id: "sent-1", hasAttachments: false }], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=s1" }),
        ],
        [
          "POST",
          /\/v1\.0\/\$batch$/,
          (req) => {
            const body = JSON.parse(req.body ?? "{}") as { requests: { id: string }[] };
            return json({
              responses: body.requests.map((r) =>
                r.id.startsWith("h:")
                  ? { id: r.id, status: 200, body: { internetMessageHeaders: [{ name: "Precedence", value: "bulk" }] } }
                  : { id: r.id, status: 200, body: { value: [{ "@odata.type": "#microsoft.graph.fileAttachment", id: "att-1", name: "a.pdf", contentType: "application/pdf", size: 10, isInline: false }] } },
              ),
            });
          },
        ],
      ]),
    );
    restore = stub.restore;
    const ctx = fakeContext({ provider: "OUTLOOK_MAIL" });
    const opts = { pageSize: 50, initialSince: new Date("2026-07-08T14:00:00Z") };

    const p1 = await outlookMailProvider.listChanges(ctx, null, opts);
    assert.equal(p1.items[0].headers?.precedence, "bulk");
    assert.equal(p1.items[0].attachments[0].filename, "a.pdf");
    assert.equal(p1.hasMore, true, "Sent Items still to visit in this round");
    const first = stub.requests[0];
    assert.match(first.url.searchParams.get("$filter") ?? "", /^receivedDateTime ge 2026-07-08T14:00:00Z$/);
    assert.match(first.headers.get("prefer") ?? "", /outlook\.body-content-type="text"/);

    const p2 = await outlookMailProvider.listChanges(ctx, p1.cursor, opts);
    assert.deepEqual(p2.items.map((i) => i.externalId), ["sent-1"]);
    assert.equal(p2.hasMore, false);
    const batchCalls = stub.requests.filter((r) => r.method === "POST");
    assert.equal(batchCalls.length, 1, "sent mail with no attachments needs no batch");

    const p3 = await outlookMailProvider.listChanges(ctx, p2.cursor, opts);
    assert.deepEqual(p3.deletedExternalIds, ["x-removed"]);
    assert.equal(p3.hasMore, true);
    assert.equal(stub.requests.at(-1)!.url.searchParams.get("$deltatoken"), "i1", "the next round resumes from the stored deltaLink");
  });

  it("refuses paging links to other hosts and maps 410 to CursorExpiredError", async () => {
    restore = stubFetch(routes([["GET", /delta$/, () => json({ error: { code: "SyncStateNotFound" } }, { status: 410 })]])).restore;
    const ctx = fakeContext({ provider: "OUTLOOK_MAIL" });
    const opts = { pageSize: 50, initialSince: new Date(0) };
    await assert.rejects(() => outlookMailProvider.listChanges(ctx, { folders: { inbox: { deltaLink: "https://evil.example/steal" } }, round: ["inbox"] }, opts), /Refusing to follow/);
    await assert.rejects(() => outlookMailProvider.listChanges(ctx, null, opts), CursorExpiredError);
  });
});

describe("parseGraphDateTime", () => {
  it("parses UTC, offsets and IANA zones", () => {
    assert.equal(parseGraphDateTime("2026-10-08T14:00:00.0000000", "UTC").toISOString(), "2026-10-08T14:00:00.000Z");
    assert.equal(parseGraphDateTime("2026-10-08T10:00:00.0000000", "America/New_York").toISOString(), "2026-10-08T14:00:00.000Z");
    assert.equal(parseGraphDateTime("2026-12-08T10:00:00", "America/New_York").toISOString(), "2026-12-08T15:00:00.000Z");
    assert.equal(parseGraphDateTime("2026-10-08T10:00:00-04:00").toISOString(), "2026-10-08T14:00:00.000Z");
    assert.equal(parseGraphDateTime("2026-10-08T14:00:00", "Pacific Standard Time").toISOString(), "2026-10-08T14:00:00.000Z", "Windows zone names fall back to UTC");
  });
});

describe("mapGraphEvent", () => {
  const graphEvent: GraphEvent = {
    id: "AAMkAGI2-evt-1",
    iCalUId: "040000008200E00074C5B7101A82E008",
    type: "occurrence",
    seriesMasterId: "AAMkAGI2-series",
    subject: "Brightwater — MSA negotiation",
    body: { contentType: "text", content: "Close clause 7.3." },
    start: { dateTime: "2026-10-07T13:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-10-07T14:00:00.0000000", timeZone: "UTC" },
    location: { displayName: "Microsoft Teams Meeting" },
    onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0" },
    organizer: { emailAddress: { name: "Priya Raman", address: "priya@cytohub.example" } },
    attendees: [
      { emailAddress: { name: "Karen Liu", address: "karen@brightwater.example" }, status: { response: "accepted" }, type: "required" },
      { emailAddress: { name: "Marcus Hale", address: "marcus@cytohub.example" }, status: { response: "tentativelyAccepted" }, type: "optional" },
      { emailAddress: { name: "Board Room", address: "boardroom@cytohub.example" }, status: { response: "accepted" }, type: "resource" },
    ],
    isCancelled: false,
    isOrganizer: false,
    responseStatus: { response: "accepted" },
    lastModifiedDateTime: "2026-10-01T10:00:00Z",
    webLink: "https://outlook.office365.com/owa/?itemid=evt",
  };

  it("maps times, attendees (minus rooms), the mailbox owner's response and the Teams link", () => {
    const e = mapGraphEvent(graphEvent) as NormalizedCalendarEvent;
    assert.equal(e.startsAt.toISOString(), "2026-10-07T13:00:00.000Z");
    assert.equal(e.isRecurring, true);
    assert.equal(e.seriesId, "AAMkAGI2-series");
    assert.equal(e.ceoResponse, "ACCEPTED");
    assert.equal(e.conferenceUrl, graphEvent.onlineMeeting!.joinUrl);
    assert.deepEqual(
      e.attendees.map((a) => [a.email, a.responseStatus, a.optional]),
      [
        ["karen@brightwater.example", "ACCEPTED", false],
        ["marcus@cytohub.example", "TENTATIVE", true],
      ],
    );
  });

  it("cancelled, organizer, removed and series masters", () => {
    assert.equal((mapGraphEvent({ ...graphEvent, isCancelled: true }) as NormalizedCalendarEvent).status, "CANCELLED");
    assert.equal((mapGraphEvent({ ...graphEvent, isOrganizer: true, responseStatus: { response: "organizer" } }) as NormalizedCalendarEvent).ceoResponse, "ORGANIZER");
    assert.deepEqual(mapGraphEvent({ id: "gone", "@removed": { reason: "deleted" } }), { deleted: "gone" });
    assert.equal(mapGraphEvent({ ...graphEvent, type: "seriesMaster" }), null);
  });
});
