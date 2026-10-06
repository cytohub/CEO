/** CONTRACT STUB — implemented by the resolution & write workstream. */
import type { EntityType, ReviewStatus } from "@/generated/prisma/enums";

export type ReviewDecision =
  | { action: "APPROVE"; note?: string }
  | { action: "EDIT"; edited: Record<string, unknown>; note?: string }
  | { action: "REJECT"; note?: string }
  | { action: "MERGE"; mergeIntoId: string; note?: string }
  | { action: "IGNORE"; note?: string };

export interface ReviewOutcome {
  status: ReviewStatus;
  resultType?: EntityType;
  resultId?: string;
}

export async function resolveReviewItem(_reviewItemId: string, _decision: ReviewDecision, _actor: { userId: string; email: string }): Promise<ReviewOutcome> {
  throw new Error("resolveReviewItem: not implemented yet");
}
