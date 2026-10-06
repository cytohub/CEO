/**
 * OneDrive (`Files.Read.All`) and SharePoint (`Sites.Read.All`) adapters.
 *
 * Graph `drive/root/delta`: OneDrive → /me/drive/root/delta; SharePoint →
 * /drives/{settings.driveId}/root/delta or /sites/{settings.siteId}/drive/root/delta.
 * versionTag = cTag (changes only when content changes) or eTag. Downloads
 * use the pre-authenticated `@microsoft.graph.downloadUrl` when present, else
 * /content. The first full listing skips files older than settings.initialDays
 * (default 365) so connecting a large drive does not ingest a decade of files.
 */
import { z } from "zod";
import { DAY_MS } from "@/lib/dates";
import { PermanentJobError } from "../../jobs/queue";
import type { ChangeSet, DocumentProvider, NormalizedDocumentRef, ProviderContext, SyncCursor, WebhookSubscriber } from "../../types";
import { MAX_DOCUMENT_BYTES, documentMimeType, isSupportedDocument } from "../doc-types";
import { providerBuffer } from "../http";
import { GRAPH, SUBSCRIPTION_MINUTES, createGraphSubscription, deleteGraphSubscription, graphDeltaPage } from "./graph";

const identity = z.object({ user: z.object({ displayName: z.string().nullish() }).nullish() }).nullish();

export const driveItemSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  file: z.object({ mimeType: z.string().nullish() }).nullish(),
  folder: z.unknown().nullish(),
  package: z.unknown().nullish(),
  root: z.unknown().nullish(),
  deleted: z.unknown().nullish(),
  size: z.number().nullish(),
  createdDateTime: z.string().nullish(),
  lastModifiedDateTime: z.string().nullish(),
  webUrl: z.string().nullish(),
  eTag: z.string().nullish(),
  cTag: z.string().nullish(),
  parentReference: z.object({ driveId: z.string().nullish(), path: z.string().nullish() }).nullish(),
  createdBy: identity,
  lastModifiedBy: identity,
  "@microsoft.graph.downloadUrl": z.string().nullish(),
});
export type DriveItem = z.infer<typeof driveItemSchema>;

const cursorSchema = z.object({ deltaLink: z.string().optional(), nextLink: z.string().optional(), initialDone: z.boolean().optional() });

/** "/drive/root:/Board/Q4" + name → "/Board/Q4/name" */
function itemPath(item: DriveItem): string | null {
  const parent = item.parentReference?.path;
  if (!parent || !item.name) return null;
  const rel = parent.replace(/^\/drives?\/[^/]*\/?root:?/, "").replace(/^\/drive\/root:?/, "");
  return `${rel || ""}/${item.name}`.replace(/\/{2,}/g, "/");
}

export type DriveItemResult = { ref: NormalizedDocumentRef } | { deleted: string } | null;

/** Map a delta item; null for folders, packages and unsupported files. */
export function mapDriveItem(ctx: ProviderContext, item: DriveItem, opts: { skipOlderThan?: Date | null } = {}): DriveItemResult {
  if (item.deleted) return { deleted: item.id };
  if (item.folder || item.package || item.root || !item.file) return null;
  const name = item.name ?? "Untitled";
  if (!isSupportedDocument(name, item.file.mimeType)) return null;
  if (item.size && item.size > MAX_DOCUMENT_BYTES) return null;
  const modifiedAt = item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : ctx.now;
  if (opts.skipOlderThan && modifiedAt < opts.skipOlderThan) return null;
  const downloadUrl = item["@microsoft.graph.downloadUrl"];
  const driveId = item.parentReference?.driveId;
  const contentUrl = driveId ? `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(item.id)}/content` : `${GRAPH}/me/drive/items/${encodeURIComponent(item.id)}/content`;
  return {
    ref: {
      externalId: item.id,
      title: name,
      mimeType: documentMimeType(name, item.file.mimeType),
      sizeBytes: item.size ?? null,
      createdAt: item.createdDateTime ? new Date(item.createdDateTime) : null,
      modifiedAt,
      author: item.createdBy?.user?.displayName ?? item.lastModifiedBy?.user?.displayName ?? null,
      path: itemPath(item),
      webUrl: item.webUrl ?? null,
      versionTag: item.cTag ?? item.eTag ?? null,
      // downloadUrl is pre-authenticated and short-lived: never send our bearer token to it.
      download: () => (downloadUrl ? providerBuffer(ctx, downloadUrl, { auth: false, maxBytes: MAX_DOCUMENT_BYTES }) : providerBuffer(ctx, contentUrl, { maxBytes: MAX_DOCUMENT_BYTES })),
      raw: item,
    },
  };
}

function rootFor(ctx: ProviderContext, provider: "ONEDRIVE" | "SHAREPOINT"): { delta: string; resource: string } {
  if (provider === "ONEDRIVE") return { delta: `${GRAPH}/me/drive/root/delta`, resource: "me/drive/root" };
  const s = ctx.connection.settings;
  const driveId = typeof s.driveId === "string" && s.driveId ? s.driveId : null;
  const siteId = typeof s.siteId === "string" && s.siteId ? s.siteId : null;
  if (driveId) return { delta: `${GRAPH}/drives/${encodeURIComponent(driveId)}/root/delta`, resource: `drives/${driveId}/root` };
  if (siteId) return { delta: `${GRAPH}/sites/${encodeURIComponent(siteId)}/drive/root/delta`, resource: `sites/${siteId}/drive/root` };
  throw new PermanentJobError("SharePoint connection needs settings.siteId or settings.driveId");
}

function driveProvider(provider: "ONEDRIVE" | "SHAREPOINT"): DocumentProvider & WebhookSubscriber {
  return {
    kind: "DOCUMENTS",

    async listChanges(ctx, cursor: SyncCursor | null, opts): Promise<ChangeSet<NormalizedDocumentRef>> {
      const parsed = cursor ? cursorSchema.safeParse(cursor) : null;
      const state = parsed?.success ? parsed.data : {};
      const url = state.nextLink ?? state.deltaLink ?? rootFor(ctx, provider).delta;
      const page = await graphDeltaPage(ctx, url, driveItemSchema, { prefer: [`odata.maxpagesize=${Math.min(500, Math.max(20, opts.pageSize))}`] });
      const days = Number(ctx.connection.settings.initialDays ?? 365);
      const skipOlderThan = state.initialDone ? null : new Date(ctx.now.getTime() - (Number.isFinite(days) && days > 0 ? days : 365) * DAY_MS);
      const items: NormalizedDocumentRef[] = [];
      const deleted: string[] = [];
      for (const item of page.items) {
        const mapped = mapDriveItem(ctx, item, { skipOlderThan });
        if (!mapped) continue;
        if ("deleted" in mapped) deleted.push(mapped.deleted);
        else items.push(mapped.ref);
      }
      const next = page.nextLink
        ? { deltaLink: state.deltaLink, nextLink: page.nextLink, initialDone: state.initialDone }
        : { deltaLink: page.deltaLink ?? state.deltaLink, initialDone: true };
      return { items, deletedExternalIds: deleted, cursor: next, hasMore: Boolean(page.nextLink) };
    },

    subscribe(ctx, opts) {
      return createGraphSubscription(ctx, { resource: rootFor(ctx, provider).resource, changeType: "updated", minutes: SUBSCRIPTION_MINUTES.drive, ...opts });
    },

    unsubscribe(ctx, channelId) {
      return deleteGraphSubscription(ctx, channelId);
    },
  };
}

export const oneDriveProvider = driveProvider("ONEDRIVE");
export const sharePointProvider = driveProvider("SHAREPOINT");
