/** CONTRACT STUB — implemented by the resolution & write workstream. */
import type { IntelligenceExtraction } from "../extraction-schema";
import type { Classification, LoadedSourceItem, PipelineContext, ResolutionContext, WriteSummary } from "../types";

export async function writeIntelligence(
  _ctx: PipelineContext,
  _item: LoadedSourceItem,
  _extraction: IntelligenceExtraction,
  _resolution: ResolutionContext,
  _classification: Classification,
): Promise<WriteSummary> {
  throw new Error("writeIntelligence: not implemented yet");
}
