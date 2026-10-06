/**
 * Document ingestion (document sync and local uploads).
 *
 *   ref ──(version stamp unchanged?)──► skip, no download
 *       ──download──(sha256 = Document.contentHash?)──► unchanged (metadata refresh only)
 *       ──► encrypted blob · SourceItem (RAW) · Document · pending DocumentVersion
 *           · Resource Center mirror (first ingest) ──► DOCUMENT_PARSE queued
 *
 * Version-stamp skip: the provider's (modifiedAt, versionTag) pair seen at the
 * last ingest is kept on SourceItem.stageData.sourceVersion and rewritten at
 * the end of every ingest (raw.ts resets stageData whenever content changes,
 * so the stamp is re-applied after the upsert). It is purely an optimization:
 * if a later stage or a retention purge drops it, the next sync downloads the
 * file and the byte hash decides — correctness never depends on the stamp.
 *
 * Version numbering: DocumentVersion.version is CytoHub's own sequence of
 * content-distinct versions per document (1, 2, 3…), independent of provider
 * revision ids. A new pending version takes max(version) + 1; if parsing
 * finds the text identical to the previous version (re-saved file, metadata
 * edit) the pending version is deleted, so numbers only advance on real
 * content changes. A change that arrives while a version is still pending
 * replaces that pending version's bytes instead of stacking another.
 */
import type { Prisma } from "@/generated/prisma/client";
import type { Sensitivity, SourceProvider } from "@/generated/prisma/enums";
import type { Tx } from "@/lib/db";
import { SOURCE_PROVIDERS } from "@/lib/intelligence";
import { sha256 } from "@/server/security/crypto";
import { enqueueProcessing } from "../pipeline";
import { type UpsertOutcome, upsertSourceItem } from "../raw";
import { getRetentionPolicy } from "../retention-policy";
import type { NormalizedDocumentRef, PipelineContext } from "../types";
import { storeBlob } from "./blobs";
import { PENDING_PARSER, canSkipDownload, detectionFilename, versionStampOf, withStamp } from "./common";
import { detectFormat } from "./formats";
import { MAX_DOCUMENT_BYTES, formatBytes } from "./limits";
import { mirrorToResourceCenter, syncResourceTitle } from "./resource";

export { PENDING_PARSER, canSkipDownload, versionStampOf, type DocumentStageData, type SourceVersionStamp } from "./common";

export interface DocumentConnectionRef {
  id: string;
  provider: SourceProvider;
  defaultSensitivity: Sensitivity;
}

const EXISTING_SELECT = {
  id: true,
  version: true,
  status: true,
  text: true,
  sourceUpdatedAt: true,
  stageData: true,
  contentPurgedAt: true,
  deletedAtSource: true,
  document: { select: { id: true, title: true, contentHash: true, resourceId: true } },
} satisfies Prisma.SourceItemSelect;

type ExistingItem = Prisma.SourceItemGetPayload<{ select: typeof EXISTING_SELECT }>;

/** Files we will not parse (too large, unsupported) are recorded as SKIPPED so they are visible and not re-downloaded. */
async function recordSkipped(
  ctx: PipelineContext,
  connection: DocumentConnectionRef,
  ref: NormalizedDocumentRef,
  existing: ExistingItem | null,
  reason: string,
  material: string,
): Promise<{ sourceItemId: string; outcome: UpsertOutcome }> {
  const { item, outcome } = await upsertSourceItem(ctx.db, {
    connectionId: connection.id,
    kind: "DOCUMENT",
    externalId: ref.externalId,
    externalUrl: ref.webUrl ?? null,
    title: ref.title,
    occurredAt: ref.modifiedAt,
    sourceUpdatedAt: ref.modifiedAt,
    text: existing?.text ?? "",
    hashMaterial: `skipped:${material}`,
    storeRaw: false,
    sensitivity: connection.defaultSensitivity,
    startStage: "RAW",
  });
  await ctx.db.sourceItem.update({
    where: { id: item.id },
    data: { status: "SKIPPED", processingError: reason.slice(0, 1000), processedAt: ctx.now, deletedAtSource: null, stageData: withStamp(item.stageData, versionStampOf(ref)) },
  });
  ctx.log("DOCUMENT_SYNC", `${ref.title}: skipped (${reason})`);
  return { sourceItemId: item.id, outcome };
}

export async function ingestDocumentRef(
  ctx: PipelineContext,
  connection: DocumentConnectionRef,
  ref: NormalizedDocumentRef,
  opts: { runId: string | null },
): Promise<{ sourceItemId: string; outcome: UpsertOutcome }> {
  const client = ctx.db;
  const stamp = versionStampOf(ref);
  const existing = await client.sourceItem.findUnique({
    where: { connectionId_externalId: { connectionId: connection.id, externalId: ref.externalId } },
    select: EXISTING_SELECT,
  });

  // 1. Cheap skip: the provider says nothing changed since the last ingest.
  if (existing && canSkipDownload(existing, ref)) {
    if (existing.deletedAtSource) await client.sourceItem.update({ where: { id: existing.id }, data: { deletedAtSource: null } });
    ctx.log("DOCUMENT_SYNC", `${ref.title}: unchanged (version stamp)`);
    return { sourceItemId: existing.id, outcome: "unchanged" };
  }

  // 2. Size gate (before the download when the provider reports a size).
  if (ref.sizeBytes != null && ref.sizeBytes > MAX_DOCUMENT_BYTES) {
    return recordSkipped(ctx, connection, ref, existing, `File is ${formatBytes(ref.sizeBytes)}; documents over ${formatBytes(MAX_DOCUMENT_BYTES)} are not ingested.`, `size:${ref.sizeBytes}`);
  }
  const bytes = await ref.download();
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return recordSkipped(ctx, connection, ref, existing, `File is ${formatBytes(bytes.length)}; documents over ${formatBytes(MAX_DOCUMENT_BYTES)} are not ingested.`, `size:${bytes.length}`);
  }

  // 3. Same bytes as the latest version: refresh metadata only, no reprocessing.
  const hash = sha256(bytes);
  if (existing?.document && existing.document.contentHash === hash && !existing.contentPurgedAt) {
    const doc = existing.document;
    await client.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: doc.id },
        data: { title: ref.title.slice(0, 500), author: ref.author ?? undefined, modifiedAtSource: ref.modifiedAt, url: ref.webUrl ?? undefined, path: ref.path ?? undefined },
      });
      await syncResourceTitle(tx, doc.resourceId, doc.title, ref.title);
      await tx.sourceItem.update({
        where: { id: existing.id },
        data: { title: ref.title.slice(0, 500), sourceUpdatedAt: ref.modifiedAt, externalUrl: ref.webUrl ?? undefined, deletedAtSource: null, stageData: withStamp(existing.stageData, stamp) },
      });
    });
    ctx.log("DOCUMENT_SYNC", `${ref.title}: unchanged (same bytes)`);
    return { sourceItemId: existing.id, outcome: "unchanged" };
  }

  const detected = detectFormat({ bytes, filename: detectionFilename(ref), mimeType: ref.mimeType });
  if (detected.format === "OTHER") {
    return recordSkipped(ctx, connection, ref, existing, detected.unsupportedReason ?? "Unsupported file format.", `sha256:${hash}`);
  }

  // 4. New content: encrypted raw copy, then all rows in one transaction.
  const policy = await getRetentionPolicy(client);
  const blob = await storeBlob(bytes, detected.mimeType, client);
  const sourceLabel = SOURCE_PROVIDERS[connection.provider]?.label ?? connection.provider;

  const { item, outcome } = await client.$transaction(async (tx: Tx) => {
    const upserted = await upsertSourceItem(tx, {
      connectionId: connection.id,
      kind: "DOCUMENT",
      externalId: ref.externalId,
      externalUrl: ref.webUrl ?? null,
      title: ref.title,
      occurredAt: ref.modifiedAt,
      sourceUpdatedAt: ref.modifiedAt,
      // Keep the previous version's text searchable until the new one is parsed.
      text: existing?.text ?? "",
      hashMaterial: `sha256:${hash}`,
      raw: ref.raw,
      storeRaw: ref.raw !== undefined && policy.rawDocumentDays !== 0,
      sensitivity: connection.defaultSensitivity,
      startStage: "RAW",
    });

    const docData = {
      title: ref.title.slice(0, 500),
      format: detected.format,
      mimeType: detected.mimeType,
      author: ref.author ?? null,
      modifiedAtSource: ref.modifiedAt,
      url: ref.webUrl ?? null,
      path: ref.path ?? null,
      sizeBytes: bytes.length,
      contentHash: hash,
    };
    const current = await tx.document.findUnique({ where: { sourceItemId: upserted.item.id }, select: { id: true, title: true, resourceId: true } });
    let documentId: string;
    if (current) {
      await tx.document.update({ where: { id: current.id }, data: docData });
      await syncResourceTitle(tx, current.resourceId, current.title, ref.title);
      documentId = current.id;
    } else {
      const created = await tx.document.create({
        data: { ...docData, sourceItemId: upserted.item.id, createdAtSource: ref.createdAt ?? null, sensitivity: connection.defaultSensitivity, currentVersion: 1 },
        select: { id: true },
      });
      documentId = created.id;
      await mirrorToResourceCenter(tx, { id: documentId, title: ref.title, format: detected.format, url: ref.webUrl ?? null, path: ref.path ?? null }, sourceLabel);
    }

    const latest = await tx.documentVersion.findFirst({ where: { documentId }, orderBy: { version: "desc" }, select: { id: true, version: true, parser: true } });
    if (latest?.parser === PENDING_PARSER) {
      // Not parsed yet: the newest bytes replace the pending ones.
      await tx.documentVersion.update({ where: { id: latest.id }, data: { modifiedAt: ref.modifiedAt, contentHash: hash, blobId: blob.id } });
    } else {
      await tx.documentVersion.create({
        data: { documentId, version: (latest?.version ?? 0) + 1, modifiedAt: ref.modifiedAt, contentHash: hash, blobId: blob.id, previousVersionId: latest?.id ?? null, parser: PENDING_PARSER },
      });
    }

    // raw.ts resets stageData on change. For documents the previous stage outputs are
    // carried over: each stage overwrites its own key as the new version flows through,
    // and when parsing finds the text unchanged (re-saved file) the pipeline stops at
    // DOCUMENT_PARSE — the item must keep the classification / resolution / write
    // summary of the version that is still current. The version stamp is re-applied.
    // A crash-recovery pass (rows existed, content unchanged) needs the item back at RAW.
    const item = await tx.sourceItem.update({
      where: { id: upserted.item.id },
      data: {
        stageData: withStamp(existing?.stageData ?? upserted.item.stageData, stamp),
        deletedAtSource: null,
        ...(upserted.outcome === "unchanged" ? { status: "PENDING" as const, stage: "RAW" as const, processingError: null, attempts: 0 } : {}),
      },
      select: { id: true, kind: true, version: true },
    });
    return { item, outcome: upserted.outcome === "unchanged" ? ("updated" as const) : upserted.outcome };
  });

  await enqueueProcessing(item, { runId: opts.runId });
  ctx.log("DOCUMENT_SYNC", `${ref.title}: ${outcome} (${detected.format}, ${formatBytes(bytes.length)})`);
  return { sourceItemId: item.id, outcome };
}
