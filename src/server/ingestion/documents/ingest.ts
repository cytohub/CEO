/**
 * CONTRACT STUB — implemented by the documents workstream.
 * Download a document, skip it when the bytes are unchanged, store an
 * encrypted raw copy, upsert its SourceItem + Document rows and queue
 * DOCUMENT_PARSE. Used by document sync and by local uploads.
 */
import type { SourceProvider, Sensitivity } from "@/generated/prisma/enums";
import type { UpsertOutcome } from "../raw";
import type { NormalizedDocumentRef, PipelineContext } from "../types";

export async function ingestDocumentRef(
  _ctx: PipelineContext,
  _connection: { id: string; provider: SourceProvider; defaultSensitivity: Sensitivity },
  _ref: NormalizedDocumentRef,
  _opts: { runId: string | null },
): Promise<{ sourceItemId: string; outcome: UpsertOutcome }> {
  throw new Error("ingestDocumentRef: not implemented yet");
}
