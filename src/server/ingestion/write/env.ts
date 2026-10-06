/**
 * The environment every Brain write runs in: one interactive transaction, the
 * pipeline clock, the CEO, the source item being written from (provenance
 * anchor) and the run's summary/counters. The pipeline writer and review
 * approvals build the same environment so approval runs the same code.
 */
import type { EntityType, Relevance, SourceItemKind, SourceProvider } from "@/generated/prisma/enums";
import type { Tx } from "@/lib/db";
import type { WriteSummary } from "../types";

export const BRAIN_ACTOR = "CytoHub Brain";

/** What a SourceReference snapshots about its source (survives content purges). */
export interface SourceSnapshot {
  id: string;
  kind: SourceItemKind;
  provider: SourceProvider;
  title: string;
  externalId: string | null;
  externalUrl: string | null;
  occurredAt: Date;
  ingestedAt: Date;
}

export interface WriteCounters {
  recordsWritten: number;
  reviewItems: number;
  duplicatesPrevented: number;
}

export interface WriteEnv {
  tx: Tx;
  /** Pipeline clock: every created row is stamped with it. */
  now: Date;
  /** CEO calendar day. */
  today: Date;
  timezone: string;
  ceo: { personId: string; userId: string; name: string; email: string | null };
  /** Activity actor for writes ("CytoHub Brain"). */
  actor: string;
  source: SourceSnapshot | null;
  /** "claude" / "rules" — the extractor that produced the evidence. */
  engine: string | null;
  relevance: Relevance | null;
  summary: WriteSummary;
  counters: WriteCounters;
  /** Who approved, when the write comes from the review queue. */
  approvedBy?: { userId: string; email: string } | null;
}

export function emptySummary(): WriteSummary {
  return { created: [], updated: [], reviewItemIds: [], insightIds: [], inboxItemIds: [], duplicatesPrevented: 0 };
}

export function emptyCounters(): WriteCounters {
  return { recordsWritten: 0, reviewItems: 0, duplicatesPrevented: 0 };
}

export function noteCreated(env: WriteEnv, type: EntityType, id: string) {
  if (!env.summary.created.some((c) => c.type === type && c.id === id)) env.summary.created.push({ type, id });
  env.counters.recordsWritten++;
}

export function noteUpdated(env: WriteEnv, type: EntityType, id: string) {
  if (env.summary.created.some((c) => c.type === type && c.id === id)) return;
  if (!env.summary.updated.some((c) => c.type === type && c.id === id)) {
    env.summary.updated.push({ type, id });
    env.counters.recordsWritten++;
  }
}

export function noteDuplicate(env: WriteEnv) {
  env.summary.duplicatesPrevented++;
  env.counters.duplicatesPrevented++;
}

/** Build a snapshot from any source item row that carries its connection's provider. */
export function snapshotOf(item: {
  id: string;
  kind: SourceItemKind;
  title: string;
  externalId: string;
  externalUrl: string | null;
  occurredAt: Date;
  ingestedAt: Date;
  connection: { provider: SourceProvider };
}): SourceSnapshot {
  return {
    id: item.id,
    kind: item.kind,
    provider: item.connection.provider,
    title: item.title,
    externalId: item.externalId,
    externalUrl: item.externalUrl,
    occurredAt: item.occurredAt,
    ingestedAt: item.ingestedAt,
  };
}
