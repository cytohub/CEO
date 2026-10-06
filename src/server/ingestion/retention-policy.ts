/**
 * Retention policy (stored in AppSetting "retentionPolicy"). Read by raw
 * ingestion (what to store at all) and by the retention sweep (what to purge).
 * Provenance snapshots (SourceReference) and metadata are kept unless the
 * policy for deleted sources says otherwise, so company history survives.
 */
import type { Db, Tx } from "@/lib/db";

export type DeletedSourceBehavior = "KEEP_HISTORY" | "REDACT_CONTENT" | "DELETE_DERIVED";

export interface RetentionPolicy {
  /** Keep raw email payloads and bodies this many days (null = indefinitely). */
  rawEmailDays: number | null;
  /** Store email attachments at all. */
  storeAttachments: boolean;
  attachmentDays: number | null;
  /** Keep raw document copies (encrypted blobs) this many days. */
  rawDocumentDays: number | null;
  /** Keep extracted text of superseded document versions this many days. */
  documentTextDays: number | null;
  /** Keep validated AI extraction outputs on source items this many days. */
  extractionOutputDays: number | null;
  /** What happens when an item is deleted in its source system. */
  onSourceDeleted: DeletedSourceBehavior;
  /** Keep the audit log this many days. */
  auditLogDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  rawEmailDays: 365,
  storeAttachments: true,
  attachmentDays: 365,
  rawDocumentDays: 365,
  documentTextDays: null,
  extractionOutputDays: 180,
  onSourceDeleted: "KEEP_HISTORY",
  auditLogDays: 730,
};

export const DELETED_SOURCE_BEHAVIOR: Record<DeletedSourceBehavior, { label: string; description: string }> = {
  KEEP_HISTORY: { label: "Keep history", description: "Mark the item as deleted upstream; keep its content, intelligence and provenance." },
  REDACT_CONTENT: { label: "Redact content", description: "Purge the item's text and raw copy; keep metadata, derived intelligence and provenance snapshots." },
  DELETE_DERIVED: {
    label: "Delete derived data",
    description: "Purge content and remove unconfirmed intelligence derived only from it. Records you confirmed or edited are kept.",
  },
};

export async function getRetentionPolicy(client: Db | Tx): Promise<RetentionPolicy> {
  const row = await client.appSetting.findUnique({ where: { key: "retentionPolicy" } });
  return { ...DEFAULT_RETENTION, ...((row?.value as Partial<RetentionPolicy> | undefined) ?? {}) };
}
