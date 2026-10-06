/**
 * Raw ingestion: the single place source items are created or updated.
 *
 * Idempotent on (connection, externalId). Content is hashed; an unchanged
 * hash is a no-op (no reprocessing), a changed hash bumps the version and
 * resets the item to the start of the pipeline. Raw provider payloads are
 * stored encrypted, and only when the retention policy allows.
 */
import { Prisma, type SourceItem } from "@/generated/prisma/client";
import type { PipelineStage, Sensitivity, SourceItemKind } from "@/generated/prisma/enums";
import type { Db, Tx } from "@/lib/db";
import { encryptJson, sha256 } from "@/server/security/crypto";

export interface UpsertSourceItemInput {
  connectionId: string;
  kind: SourceItemKind;
  externalId: string;
  externalUrl?: string | null;
  title: string;
  occurredAt: Date;
  sourceUpdatedAt?: Date | null;
  /** Normalized plain text (for email: the new message content, quoted history stripped). */
  text: string;
  snippet?: string | null;
  /** Original payload; encrypted when stored. */
  raw?: unknown;
  storeRaw: boolean;
  /** Extra material that should count as a content change (event times, attendee responses…). */
  hashMaterial?: string;
  sensitivity?: Sensitivity;
  meetingId?: string | null;
  /** Stage to (re)start from. Documents start at RAW (parse); email/calendar at NORMALIZED. */
  startStage?: PipelineStage;
}

export type UpsertOutcome = "created" | "updated" | "unchanged";

export function contentHashFor(input: Pick<UpsertSourceItemInput, "kind" | "title" | "text" | "hashMaterial">): string {
  return sha256(`${input.kind}\n${input.title}\n${input.hashMaterial ?? ""}\n${input.text}`);
}

export function snippetOf(text: string, max = 280): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

export async function upsertSourceItem(client: Db | Tx, input: UpsertSourceItemInput): Promise<{ item: SourceItem; outcome: UpsertOutcome }> {
  const contentHash = contentHashFor(input);
  const existing = await client.sourceItem.findUnique({ where: { connectionId_externalId: { connectionId: input.connectionId, externalId: input.externalId } } });
  const rawPayload = input.storeRaw && input.raw !== undefined ? encryptJson(input.raw) : null;
  const startStage = input.startStage ?? "NORMALIZED";

  if (existing && existing.contentHash === contentHash && !existing.contentPurgedAt) {
    const item = await client.sourceItem.update({
      where: { id: existing.id },
      data: {
        sourceUpdatedAt: input.sourceUpdatedAt ?? existing.sourceUpdatedAt,
        deletedAtSource: null,
        externalUrl: input.externalUrl ?? existing.externalUrl,
      },
    });
    return { item, outcome: "unchanged" };
  }

  const data = {
    kind: input.kind,
    externalUrl: input.externalUrl ?? null,
    title: input.title.slice(0, 500),
    occurredAt: input.occurredAt,
    sourceUpdatedAt: input.sourceUpdatedAt ?? null,
    contentHash,
    text: input.text,
    snippet: input.snippet ?? snippetOf(input.text),
    rawPayload,
    status: "PENDING" as const,
    stage: startStage,
    attempts: 0,
    processingError: null,
    deletedAtSource: null,
    contentPurgedAt: null,
    meetingId: input.meetingId ?? undefined,
  };

  if (existing) {
    const item = await client.sourceItem.update({
      where: { id: existing.id },
      data: { ...data, version: { increment: 1 }, stageData: Prisma.DbNull },
    });
    return { item, outcome: "updated" };
  }
  const item = await client.sourceItem.create({
    data: {
      ...data,
      connectionId: input.connectionId,
      externalId: input.externalId,
      sensitivity: input.sensitivity ?? "CONFIDENTIAL",
      meetingId: input.meetingId ?? null,
    },
  });
  return { item, outcome: "created" };
}

/** Record upstream deletions. What happens next is decided by the retention policy (retention.ts). */
export async function markDeletedAtSource(client: Db | Tx, connectionId: string, externalIds: string[], at: Date): Promise<number> {
  if (!externalIds.length) return 0;
  const res = await client.sourceItem.updateMany({
    where: { connectionId, externalId: { in: externalIds }, deletedAtSource: null },
    data: { deletedAtSource: at },
  });
  return res.count;
}
