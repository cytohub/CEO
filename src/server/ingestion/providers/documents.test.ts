import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import type { NormalizedDocumentRef } from "../types";
import { fakeContext, json, routes, stubFetch } from "./test-helpers";

// The OneDrive adapter imports the job queue (Prisma client); no connection is opened in these tests.
process.env.DATABASE_URL ??= "postgresql://unused:unused@127.0.0.1:1/unused";

type DriveModule = typeof import("./google/drive");
type GraphDriveModule = typeof import("./microsoft/drive");
type DropboxModule = typeof import("./dropbox");
let gdrive: DriveModule;
let msdrive: GraphDriveModule;
let dropbox: DropboxModule;

before(async () => {
  gdrive = await import("./google/drive");
  msdrive = await import("./microsoft/drive");
  dropbox = await import("./dropbox");
});

describe("Google Drive", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("exports Google Docs to Office formats and skips folders, shortcuts and unsupported files", async () => {
    const stub = stubFetch(routes([["GET", /\/drive\/v3\/files\/doc1\/export$/, () => new Response(Buffer.from("PK-docx"))]]));
    restore = stub.restore;
    const ctx = fakeContext({ provider: "GOOGLE_DRIVE" });
    const doc = gdrive.mapDriveFile(ctx, { id: "doc1", name: "Board memo", mimeType: "application/vnd.google-apps.document", version: "42", modifiedTime: "2026-10-05T12:00:00Z", owners: [{ displayName: "Jonas Weber" }] })!;
    assert.equal(doc.mimeType, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    assert.equal(doc.versionTag, "v42");
    assert.equal(doc.author, "Jonas Weber");
    assert.equal((await doc.download()).toString(), "PK-docx");
    assert.equal(stub.requests[0].url.searchParams.get("mimeType"), doc.mimeType);

    const pdf = gdrive.mapDriveFile(ctx, { id: "p1", name: "Deck v7.pdf", mimeType: "application/pdf", md5Checksum: "abc", size: "1000", modifiedTime: "2026-10-05T12:00:00Z" })!;
    assert.equal(pdf.versionTag, "abc");
    assert.equal(gdrive.mapDriveFile(ctx, { id: "f", name: "Folder", mimeType: "application/vnd.google-apps.folder" }), null);
    assert.equal(gdrive.mapDriveFile(ctx, { id: "s", name: "Shortcut", mimeType: "application/vnd.google-apps.shortcut" }), null);
    assert.equal(gdrive.mapDriveFile(ctx, { id: "v", name: "lab.mp4", mimeType: "video/mp4" }), null);
    assert.equal(gdrive.mapDriveFile(ctx, { id: "t", name: "old.pdf", mimeType: "application/pdf", trashed: true }), null);
    assert.equal(gdrive.mapDriveFile(ctx, { id: "form", name: "Survey", mimeType: "application/vnd.google-apps.form" }), null);
  });

  it("initial listing captures the start token, then follows changes (removed/trashed → deleted)", async () => {
    const stub = stubFetch(
      routes([
        ["GET", /\/drive\/v3\/changes\/startPageToken$/, () => json({ startPageToken: "100" })],
        ["GET", /\/drive\/v3\/files$/, () => json({ files: [{ id: "p1", name: "Model v12.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", modifiedTime: "2026-10-05T12:00:00Z" }] })],
        [
          "GET",
          /\/drive\/v3\/changes$/,
          () =>
            json({
              changes: [
                { fileId: "gone", removed: true },
                { fileId: "trashed", file: { id: "trashed", name: "x.pdf", mimeType: "application/pdf", trashed: true } },
                { fileId: "p2", file: { id: "p2", name: "Notes.md", mimeType: "text/markdown", modifiedTime: "2026-10-06T12:00:00Z" } },
              ],
              newStartPageToken: "101",
            }),
        ],
      ]),
    );
    restore = stub.restore;
    const ctx = fakeContext({ provider: "GOOGLE_DRIVE" });
    const first = await gdrive.googleDriveProvider.listChanges(ctx, null, { pageSize: 50 });
    assert.deepEqual(first.items.map((i) => i.externalId), ["p1"]);
    assert.deepEqual(first.cursor, { phase: "changes", pageToken: "100" });
    assert.match(stub.requests.find((r) => r.url.pathname.endsWith("/files"))!.url.searchParams.get("q")!, /modifiedTime > '/);
    const next = await gdrive.googleDriveProvider.listChanges(ctx, first.cursor, { pageSize: 50 });
    assert.deepEqual(next.items.map((i) => i.externalId), ["p2"]);
    assert.deepEqual(next.deletedExternalIds, ["gone", "trashed"]);
    assert.deepEqual(next.cursor, { phase: "changes", pageToken: "101" });
  });
});

describe("OneDrive / SharePoint", () => {
  it("maps delta items: cTag version, path, pre-authenticated download without our token", async () => {
    const stub = stubFetch(() => new Response(Buffer.from("%PDF")));
    try {
      const ctx = fakeContext({ provider: "ONEDRIVE" });
      const res = msdrive.mapDriveItem(ctx, {
        id: "01ABC",
        name: "Series B deck v7.pdf",
        file: { mimeType: "application/pdf" },
        size: 2048,
        lastModifiedDateTime: "2026-10-05T10:00:00Z",
        eTag: '"{E},2"',
        cTag: '"c:{E},5"',
        parentReference: { driveId: "b!drive", path: "/drive/root:/Fundraising/Series B" },
        createdBy: { user: { displayName: "Jonas Weber" } },
        "@microsoft.graph.downloadUrl": "https://public.sharepoint.example/download?token=abc",
      }) as { ref: NormalizedDocumentRef };
      assert.equal(res.ref.versionTag, '"c:{E},5"');
      assert.equal(res.ref.path, "/Fundraising/Series B/Series B deck v7.pdf");
      assert.equal(res.ref.author, "Jonas Weber");
      assert.equal((await res.ref.download()).toString(), "%PDF");
      assert.equal(stub.requests[0].headers.get("authorization"), null);
    } finally {
      stub.restore();
    }
  });

  it("deleted → deletion; folders, packages and old files (first listing) are skipped", () => {
    const ctx = fakeContext({ provider: "SHAREPOINT" }, { now: new Date("2026-10-06T00:00:00Z") });
    assert.deepEqual(msdrive.mapDriveItem(ctx, { id: "x", deleted: { state: "deleted" } }), { deleted: "x" });
    assert.equal(msdrive.mapDriveItem(ctx, { id: "f", name: "Board", folder: { childCount: 3 } }), null);
    assert.equal(msdrive.mapDriveItem(ctx, { id: "n", name: "Notebook", package: { type: "oneNote" } }), null);
    const old = { id: "o", name: "2019 plan.docx", file: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }, lastModifiedDateTime: "2019-01-01T00:00:00Z" };
    assert.equal(msdrive.mapDriveItem(ctx, old, { skipOlderThan: new Date("2025-10-06T00:00:00Z") }), null);
    assert.ok(msdrive.mapDriveItem(ctx, old, { skipOlderThan: null }));
  });
});

describe("Dropbox", () => {
  let restore: () => void = () => {};
  afterEach(() => restore());

  it("maps files, reports deletions by path, and escapes the API arg", async () => {
    const stub = stubFetch(routes([["POST", /content\.dropboxapi\.com\/2\/files\/download$/, () => new Response(Buffer.from("csv"))]]));
    restore = stub.restore;
    const ctx = fakeContext({ provider: "DROPBOX" });
    const file = dropbox.mapDropboxEntry(ctx, {
      ".tag": "file",
      id: "id:a4ayc_80_OEAAAAAAAAAXw",
      name: "Runway – scenarios.csv",
      path_display: "/Finance/Runway – scenarios.csv",
      server_modified: "2026-10-05T12:00:00Z",
      rev: "015f",
      size: 100,
      content_hash: "e3b0c442",
    }) as { ref: NormalizedDocumentRef };
    assert.equal(file.ref.versionTag, "e3b0c442");
    assert.equal(file.ref.path, "/Finance/Runway – scenarios.csv");
    await file.ref.download();
    assert.equal(stub.requests[0].headers.get("dropbox-api-arg"), '{"path":"id:a4ayc_80_OEAAAAAAAAAXw"}');
    assert.equal(dropbox.dropboxApiArg({ path: "/Runway – x" }), '{"path":"/Runway \\u2013 x"}');
    assert.deepEqual(dropbox.mapDropboxEntry(ctx, { ".tag": "deleted", name: "old.pdf", path_lower: "/finance/old.pdf" }), { deleted: "path:/finance/old.pdf" });
    assert.equal(dropbox.mapDropboxEntry(ctx, { ".tag": "folder", name: "Finance", id: "id:f" }), null);
    assert.equal(dropbox.mapDropboxEntry(ctx, { ".tag": "file", name: "photo.heic", id: "id:p" }), null);
  });

  it("list_folder then continue; a reset cursor means a full resync", async () => {
    const stub = stubFetch(
      routes([
        ["POST", /\/2\/files\/list_folder$/, () => json({ entries: [{ ".tag": "file", id: "id:1", name: "a.pdf", path_display: "/a.pdf", server_modified: "2026-10-05T00:00:00Z" }], cursor: "c1", has_more: false })],
        ["POST", /\/2\/files\/list_folder\/continue$/, () => json({ error_summary: "reset/..", error: { ".tag": "reset" } }, { status: 409 })],
      ]),
    );
    restore = stub.restore;
    const ctx = fakeContext({ provider: "DROPBOX" });
    const first = await dropbox.dropboxProvider.listChanges(ctx, null, { pageSize: 100 });
    assert.deepEqual(first.cursor, { cursor: "c1", initialDone: true });
    assert.equal(JSON.parse(stub.requests[0].body!).recursive, true);
    const { CursorExpiredError } = await import("../types");
    await assert.rejects(() => dropbox.dropboxProvider.listChanges(ctx, first.cursor, { pageSize: 100 }), CursorExpiredError);
  });
});
