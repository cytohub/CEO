/**
 * CONTRACT STUB — implemented by the documents workstream.
 * Parse the stored raw copy into text, create a DocumentVersion when the
 * content changed (with change summary + significant changes vs the previous
 * version), and update SourceItem.text for extraction and search.
 */
import type { PipelineContext } from "../types";

export async function parseDocumentItem(
  _ctx: PipelineContext,
  _sourceItemId: string,
): Promise<{ changed: boolean; documentId: string | null; versionId: string | null }> {
  throw new Error("parseDocumentItem: not implemented yet");
}
