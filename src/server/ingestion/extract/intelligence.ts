/**
 * Intelligence extraction stage: Claude structured outputs when configured,
 * the deterministic rules engine otherwise (or when Claude fails). Whatever
 * the engine, the result goes through validateExtraction — schema check,
 * verbatim-evidence check, date window — before the pipeline persists it.
 */
import { claudeEnabled } from "@/server/ai/claude";
import { type IntelligenceExtraction, type ValidationIssue, validateExtraction } from "../extraction-schema";
import type { ExtractionInput, PipelineContext } from "../types";
import { extractWithClaude } from "./claude-extractor";
import { extractWithRules } from "./rules-extractor";

export async function extractIntelligence(
  ctx: PipelineContext,
  input: ExtractionInput,
): Promise<{ extraction: IntelligenceExtraction; engine: "claude" | "rules"; issues: ValidationIssue[] }> {
  if (claudeEnabled() && input.text.trim()) {
    try {
      const raw = await extractWithClaude(input, ctx.now, (m) => ctx.log("extract", m));
      if (raw) {
        const { extraction, issues } = validateExtraction(raw, input.text, ctx.now);
        return { extraction, engine: "claude", issues };
      }
      ctx.log("extract", "Claude extraction unavailable; using rules");
    } catch (error) {
      // Never let a model/transport failure block the pipeline: the rules engine always works.
      ctx.log("extract", `Claude extraction failed (${error instanceof Error ? error.name : "error"}); using rules`);
    }
  }
  const { extraction, issues } = validateExtraction(extractWithRules(input, ctx.now), input.text, ctx.now);
  return { extraction, engine: "rules", issues };
}
