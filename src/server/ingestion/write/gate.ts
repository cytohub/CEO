/**
 * Confidence gate (docs/ingestion/ARCHITECTURE.md §6).
 *
 *   High   (≥ 0.80)  written automatically, unless the record is protected
 *   Medium (≥ 0.55)  Brain Review Queue
 *   Low    (< 0.55)  kept only in the extraction record — except protected
 *                    proposals from a Critical source, which a human still sees
 *
 * Protected classes always go to a human, whatever the confidence: they change
 * company truth that someone else already relies on.
 */
import type { Confidence, Relevance } from "@/generated/prisma/enums";
import { confidenceFromScore } from "@/lib/intelligence";

export type ProtectedClass =
  | "DECISION_MADE"
  | "ENTITY_MERGE"
  | "NEW_INVESTOR"
  | "DEADLINE_CHANGE"
  | "OWNER_CHANGE"
  | "DEAL_VALUE_CHANGE"
  | "MILESTONE_DATE_CHANGE"
  | "MILESTONE_COMPLETE";

export const PROTECTED_REASONS: Record<ProtectedClass, string> = {
  DECISION_MADE: "Recording a decision as made changes company truth; confirm it was actually decided.",
  ENTITY_MERGE: "Merging records cannot be undone automatically.",
  NEW_INVESTOR: "New investors are only added to the pipeline after a human confirms them.",
  DEADLINE_CHANGE: "Changing the deadline of existing work needs a human.",
  OWNER_CHANGE: "Changing who owns existing work needs a human.",
  DEAL_VALUE_CHANGE: "Deal values feed the pipeline and forecasts.",
  MILESTONE_DATE_CHANGE: "Milestone dates are commitments to the board and the team.",
  MILESTONE_COMPLETE: "Completing a milestone updates goal progress and reporting.",
};

export type GateOutcome = "WRITE" | "REVIEW" | "DROP";

export interface GateResult {
  outcome: GateOutcome;
  band: Confidence;
  reason: string;
}

export function gate(input: { confidence: number; relevance: Relevance | null | undefined; protectedClass?: ProtectedClass | null }): GateResult {
  const score = Math.max(0, Math.min(1, Number.isFinite(input.confidence) ? input.confidence : 0));
  const band = confidenceFromScore(score);

  if (input.protectedClass) {
    // Weak evidence is only worth a reviewer's time when the source is critical.
    if (band === "LOW" && input.relevance !== "CRITICAL") return { outcome: "DROP", band, reason: "Low confidence; kept in the extraction record only." };
    return { outcome: "REVIEW", band, reason: PROTECTED_REASONS[input.protectedClass] };
  }
  if (band === "HIGH") return { outcome: "WRITE", band, reason: "High confidence." };
  if (band === "MEDIUM") return { outcome: "REVIEW", band, reason: `Medium confidence (${Math.round(score * 100)}%).` };
  return { outcome: "DROP", band, reason: "Low confidence; kept in the extraction record only." };
}
