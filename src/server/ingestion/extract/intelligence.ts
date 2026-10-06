/** CONTRACT STUB — implemented by the extraction workstream. */
import type { IntelligenceExtraction, ValidationIssue } from "../extraction-schema";
import type { ExtractionInput, PipelineContext } from "../types";

export async function extractIntelligence(
  _ctx: PipelineContext,
  _input: ExtractionInput,
): Promise<{ extraction: IntelligenceExtraction; engine: "claude" | "rules"; issues: ValidationIssue[] }> {
  throw new Error("extractIntelligence: not implemented yet");
}
