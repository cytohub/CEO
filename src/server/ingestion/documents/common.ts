/** Small pure pieces shared by ingest and parse (kept apart to avoid an import cycle through pipeline.ts). */
import type { Prisma } from "@/generated/prisma/client";
import type { NormalizedDocumentRef, StageData } from "../types";
import { extensionOf } from "./formats";

/** DocumentVersion.parser of a version whose bytes are stored but not parsed yet. */
export const PENDING_PARSER = "pending";

/** Filename used for format detection: the title when it carries an extension, else the path. */
export function detectionFilename(ref: { title: string; path?: string | null }): string {
  return extensionOf(ref.title) ? ref.title : (ref.path ?? ref.title);
}

export interface SourceVersionStamp {
  tag: string | null;
  modifiedAt: string;
}

export type DocumentStageData = StageData & { sourceVersion?: SourceVersionStamp };

export function versionStampOf(ref: Pick<NormalizedDocumentRef, "versionTag" | "modifiedAt">): SourceVersionStamp {
  return { tag: ref.versionTag ?? null, modifiedAt: ref.modifiedAt.toISOString() };
}

export function withStamp(stageData: Prisma.JsonValue | null | undefined, stamp: SourceVersionStamp): Prisma.InputJsonValue {
  const base = stageData && typeof stageData === "object" && !Array.isArray(stageData) ? (stageData as DocumentStageData) : {};
  return { ...base, sourceVersion: stamp } as unknown as Prisma.InputJsonValue;
}

/**
 * True when the provider reports the same version we already ingested, so the
 * download can be skipped. Requires both the modified time and the version
 * tag (etag / revision id / content hash) to match what the last ingest saw.
 */
export function canSkipDownload(
  item: { sourceUpdatedAt: Date | null; stageData: Prisma.JsonValue | null; contentPurgedAt: Date | null; status: string; document: { id: string } | null },
  ref: Pick<NormalizedDocumentRef, "versionTag" | "modifiedAt">,
): boolean {
  if (item.contentPurgedAt) return false;
  if (!item.document && item.status !== "SKIPPED") return false;
  if (!item.sourceUpdatedAt || item.sourceUpdatedAt.getTime() !== ref.modifiedAt.getTime()) return false;
  const stamp = (item.stageData as DocumentStageData | null)?.sourceVersion;
  if (!stamp) return false;
  const now = versionStampOf(ref);
  return stamp.modifiedAt === now.modifiedAt && (stamp.tag ?? null) === now.tag;
}

