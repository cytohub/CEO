/**
 * Google Drive adapter (read-only, `drive.readonly`).
 *
 *   initial:      changes.getStartPageToken (captured first), then files.list of
 *                 recent documents (settings.initialDays, default 365)
 *   incremental:  changes.list from the page token; removed / trashed → deleted
 *   push:         changes.watch channel (token = per-connection secret)
 *
 * Folders, shortcuts and unsupported formats are skipped. Google Docs,
 * Sheets and Slides are exported to DOCX / XLSX / PPTX; other files are
 * downloaded with alt=media. versionTag = md5Checksum (binary files) or the
 * Drive version number (Google files), so unchanged files are not downloaded.
 */
import { z } from "zod";
import { DAY_MS } from "@/lib/dates";
import { CursorExpiredError, type ChangeSet, type DocumentProvider, type NormalizedDocumentRef, type ProviderContext, type SyncCursor, type WebhookSubscriber } from "../../types";
import { GOOGLE_EXPORTS, MAX_DOCUMENT_BYTES, documentMimeType, isSupportedDocument } from "../doc-types";
import { ProviderHttpError, providerBuffer, providerJson } from "../http";
import { stopChannel, watchChannel } from "./channels";

const DRIVE = "https://www.googleapis.com/drive/v3";

const FILE_FIELDS = "id,name,mimeType,md5Checksum,version,size,createdTime,modifiedTime,trashed,webViewLink,owners(displayName,emailAddress),lastModifyingUser(displayName)";

export const driveFileSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  mimeType: z.string().optional(),
  md5Checksum: z.string().optional(),
  version: z.string().optional(),
  size: z.string().optional(),
  createdTime: z.string().optional(),
  modifiedTime: z.string().optional(),
  trashed: z.boolean().optional(),
  webViewLink: z.string().optional(),
  owners: z.array(z.object({ displayName: z.string().optional(), emailAddress: z.string().optional() })).optional(),
  lastModifyingUser: z.object({ displayName: z.string().optional() }).optional(),
});
export type DriveFile = z.infer<typeof driveFileSchema>;

const filesSchema = z.object({ files: z.array(driveFileSchema).optional(), nextPageToken: z.string().optional() });
const changesSchema = z.object({
  changes: z.array(z.object({ fileId: z.string().optional(), removed: z.boolean().optional(), file: driveFileSchema.optional() })).optional(),
  nextPageToken: z.string().optional(),
  newStartPageToken: z.string().optional(),
});
const startTokenSchema = z.object({ startPageToken: z.string() });

const cursorSchema = z.object({
  phase: z.enum(["initial", "changes"]),
  /** Changes token captured before the initial listing. */
  startPageToken: z.string().optional(),
  /** files.list page token (initial) or changes page token. */
  pageToken: z.string().optional(),
});

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";

/** Map a Drive file to a document ref, or null when it is not something we ingest. */
export function mapDriveFile(ctx: ProviderContext, f: DriveFile): NormalizedDocumentRef | null {
  const mime = f.mimeType ?? "";
  if (mime === FOLDER || mime === SHORTCUT || f.trashed) return null;
  const name = f.name ?? "Untitled";
  const exportAs = GOOGLE_EXPORTS[mime];
  if (!exportAs && (mime.startsWith("application/vnd.google-apps.") || !isSupportedDocument(name, mime))) return null;
  const size = f.size ? Number(f.size) : null;
  if (size && size > MAX_DOCUMENT_BYTES) return null;
  return {
    externalId: f.id,
    title: name,
    mimeType: exportAs ? exportAs.mimeType : documentMimeType(name, mime),
    sizeBytes: size,
    createdAt: f.createdTime ? new Date(f.createdTime) : null,
    modifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : ctx.now,
    author: f.owners?.[0]?.displayName ?? f.lastModifyingUser?.displayName ?? null,
    path: null,
    webUrl: f.webViewLink ?? null,
    versionTag: f.md5Checksum ?? (f.version ? `v${f.version}` : null),
    download: () =>
      exportAs
        ? providerBuffer(ctx, `${DRIVE}/files/${encodeURIComponent(f.id)}/export`, { query: { mimeType: exportAs.mimeType }, maxBytes: MAX_DOCUMENT_BYTES })
        : providerBuffer(ctx, `${DRIVE}/files/${encodeURIComponent(f.id)}`, { query: { alt: "media", supportsAllDrives: true }, maxBytes: MAX_DOCUMENT_BYTES }),
    raw: f,
  };
}

async function startPageToken(ctx: ProviderContext): Promise<string> {
  const res = await providerJson(ctx, `${DRIVE}/changes/startPageToken`, startTokenSchema, { query: { supportsAllDrives: true } });
  return res.startPageToken;
}

export const googleDriveProvider: DocumentProvider & WebhookSubscriber = {
  kind: "DOCUMENTS",

  async listChanges(ctx, cursor: SyncCursor | null, opts): Promise<ChangeSet<NormalizedDocumentRef>> {
    const parsed = cursor ? cursorSchema.safeParse(cursor) : null;
    let state = parsed?.success ? parsed.data : null;
    if (!state) state = { phase: "initial", startPageToken: await startPageToken(ctx) };
    const pageSize = Math.min(1000, Math.max(10, opts.pageSize));

    if (state.phase === "initial") {
      const days = Number(ctx.connection.settings.initialDays ?? 365);
      const since = new Date(ctx.now.getTime() - (Number.isFinite(days) && days > 0 ? days : 365) * DAY_MS).toISOString();
      const res = await providerJson(ctx, `${DRIVE}/files`, filesSchema, {
        query: {
          q: `trashed = false and mimeType != '${FOLDER}' and modifiedTime > '${since}'`,
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize,
          pageToken: state.pageToken,
          orderBy: "modifiedTime desc",
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        },
      });
      const items = (res.files ?? []).map((f) => mapDriveFile(ctx, f)).filter((r): r is NormalizedDocumentRef => r !== null);
      if (res.nextPageToken) return { items, deletedExternalIds: [], cursor: { ...state, pageToken: res.nextPageToken }, hasMore: true };
      return { items, deletedExternalIds: [], cursor: { phase: "changes", pageToken: state.startPageToken ?? (await startPageToken(ctx)) }, hasMore: false };
    }

    let res: z.infer<typeof changesSchema>;
    try {
      res = await providerJson(ctx, `${DRIVE}/changes`, changesSchema, {
        query: {
          pageToken: state.pageToken ?? (await startPageToken(ctx)),
          pageSize,
          includeRemoved: true,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
        },
      });
    } catch (error) {
      if (error instanceof ProviderHttpError && (error.status === 404 || error.status === 410)) throw new CursorExpiredError("Google Drive page token expired; full resync required");
      throw error;
    }
    const items: NormalizedDocumentRef[] = [];
    const deleted: string[] = [];
    for (const c of res.changes ?? []) {
      const id = c.fileId ?? c.file?.id;
      if (!id) continue;
      if (c.removed || c.file?.trashed) {
        deleted.push(id);
        continue;
      }
      const ref = c.file ? mapDriveFile(ctx, c.file) : null;
      if (ref) items.push(ref);
    }
    if (res.nextPageToken) return { items, deletedExternalIds: deleted, cursor: { phase: "changes", pageToken: res.nextPageToken }, hasMore: true };
    return { items, deletedExternalIds: deleted, cursor: { phase: "changes", pageToken: res.newStartPageToken ?? state.pageToken }, hasMore: false };
  },

  async subscribe(ctx, opts) {
    const token = await startPageToken(ctx);
    return watchChannel(ctx, `${DRIVE}/changes/watch`, { ...opts, ttlSeconds: 7 * 24 * 3600, query: { pageToken: token, supportsAllDrives: true } });
  },

  unsubscribe(ctx, channelId) {
    return stopChannel(ctx, `${DRIVE}/channels/stop`, channelId);
  },
};
