/**
 * CONTRACT STUB — implemented by the providers & sync workstream.
 * Pull changes for one connection since its cursor, raw-store them and queue
 * processing. See docs/ingestion/ARCHITECTURE.md §3.
 */
import type { PipelineContext } from "./types";

export interface SyncOutcome {
  connectionId: string;
  runId: string;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  deleted: number;
  noise: number;
  failed: number;
  /** More pages remain; a follow-up sync job has been queued. */
  hasMore: boolean;
  error?: string;
}

export async function syncConnection(_ctx: PipelineContext, _connectionId: string, _runId: string): Promise<SyncOutcome> {
  throw new Error("syncConnection: not implemented yet");
}
