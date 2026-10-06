/**
 * Dropbox adapter (scopes files.metadata.read, files.content.read,
 * account_info.read).
 *
 *   initial:      /2/files/list_folder (recursive) from settings.path (default root)
 *   incremental:  /2/files/list_folder/continue with the stored cursor;
 *                 a `reset` error → CursorExpiredError
 *   push:         app-level webhook (configured in the Dropbox console), so
 *                 there is nothing to subscribe per connection.
 *
 * Deleted entries carry only a path, so they are reported as
 * "path:<lower-cased path>" and sync.ts maps them back to documents by path.
 */
import { z } from "zod";
import { DAY_MS } from "@/lib/dates";
import { CursorExpiredError, type ChangeSet, type DocumentProvider, type NormalizedDocumentRef, type ProviderContext, type SyncCursor } from "../types";
import { MAX_DOCUMENT_BYTES, documentMimeType, isSupportedDocument } from "./doc-types";
import { ProviderHttpError, providerBuffer, providerJson } from "./http";

const API = "https://api.dropboxapi.com/2";
const CONTENT = "https://content.dropboxapi.com/2";

export const dropboxEntrySchema = z.object({
  ".tag": z.enum(["file", "folder", "deleted"]),
  id: z.string().optional(),
  name: z.string(),
  path_lower: z.string().optional(),
  path_display: z.string().optional(),
  client_modified: z.string().optional(),
  server_modified: z.string().optional(),
  rev: z.string().optional(),
  size: z.number().optional(),
  content_hash: z.string().optional(),
  is_downloadable: z.boolean().optional(),
});
export type DropboxEntry = z.infer<typeof dropboxEntrySchema>;

const listSchema = z.object({ entries: z.array(z.unknown()), cursor: z.string(), has_more: z.boolean() });
const cursorSchema = z.object({ cursor: z.string(), initialDone: z.boolean().optional() });

export const DROPBOX_DELETED_PREFIX = "path:";

/** Dropbox-API-Arg must be ASCII: escape everything else as \uXXXX. */
export function dropboxApiArg(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export type DropboxEntryResult = { ref: NormalizedDocumentRef } | { deleted: string } | null;

export function mapDropboxEntry(ctx: ProviderContext, e: DropboxEntry, opts: { skipOlderThan?: Date | null } = {}): DropboxEntryResult {
  if (e[".tag"] === "deleted") return e.path_lower ? { deleted: `${DROPBOX_DELETED_PREFIX}${e.path_lower}` } : null;
  if (e[".tag"] !== "file" || !e.id || e.is_downloadable === false) return null;
  if (!isSupportedDocument(e.name, null)) return null;
  if (e.size && e.size > MAX_DOCUMENT_BYTES) return null;
  const modifiedAt = new Date(e.server_modified ?? e.client_modified ?? ctx.now.toISOString());
  if (opts.skipOlderThan && modifiedAt < opts.skipOlderThan) return null;
  const id = e.id;
  return {
    ref: {
      externalId: id,
      title: e.name,
      mimeType: documentMimeType(e.name, null),
      sizeBytes: e.size ?? null,
      createdAt: e.client_modified ? new Date(e.client_modified) : null,
      modifiedAt,
      author: null,
      path: e.path_display ?? e.path_lower ?? null,
      webUrl: e.path_display ? `https://www.dropbox.com/preview${encodeURI(e.path_display)}` : null,
      versionTag: e.content_hash ?? e.rev ?? null,
      download: () => providerBuffer(ctx, `${CONTENT}/files/download`, { method: "POST", headers: { "dropbox-api-arg": dropboxApiArg({ path: id }) }, maxBytes: MAX_DOCUMENT_BYTES }),
      raw: e,
    },
  };
}

export const dropboxProvider: DocumentProvider = {
  kind: "DOCUMENTS",

  async listChanges(ctx, cursor: SyncCursor | null, opts): Promise<ChangeSet<NormalizedDocumentRef>> {
    const parsed = cursor ? cursorSchema.safeParse(cursor) : null;
    const state = parsed?.success ? parsed.data : null;
    let res: z.infer<typeof listSchema>;
    try {
      res = state
        ? await providerJson(ctx, `${API}/files/list_folder/continue`, listSchema, { method: "POST", json: { cursor: state.cursor } })
        : await providerJson(ctx, `${API}/files/list_folder`, listSchema, {
            method: "POST",
            json: {
              path: typeof ctx.connection.settings.path === "string" ? ctx.connection.settings.path : "",
              recursive: true,
              include_deleted: false,
              include_non_downloadable_files: false,
              limit: Math.min(2000, Math.max(25, opts.pageSize)),
            },
          });
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status === 409 && error.code === "reset") throw new CursorExpiredError("Dropbox cursor was reset; full resync required");
      throw error;
    }
    const initialDone = state?.initialDone ?? false;
    const days = Number(ctx.connection.settings.initialDays ?? 365);
    const skipOlderThan = initialDone ? null : new Date(ctx.now.getTime() - (Number.isFinite(days) && days > 0 ? days : 365) * DAY_MS);
    const items: NormalizedDocumentRef[] = [];
    const deleted: string[] = [];
    for (const raw of res.entries) {
      const entry = dropboxEntrySchema.safeParse(raw);
      if (!entry.success) continue;
      const mapped = mapDropboxEntry(ctx, entry.data, { skipOlderThan });
      if (!mapped) continue;
      if ("deleted" in mapped) deleted.push(mapped.deleted);
      else items.push(mapped.ref);
    }
    return { items, deletedExternalIds: deleted, cursor: { cursor: res.cursor, initialDone: initialDone || !res.has_more }, hasMore: res.has_more };
  },
};
