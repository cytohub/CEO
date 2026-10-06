/** CONTRACT STUB — implemented by the extraction workstream. */
import type { Classification, LoadedSourceItem, MentionDraft, PipelineContext } from "../types";

export async function classifyItem(_ctx: PipelineContext, _item: LoadedSourceItem, _mentions: MentionDraft[]): Promise<Classification> {
  throw new Error("classifyItem: not implemented yet");
}
