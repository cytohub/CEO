"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { getIn, readCandidates } from "@/components/intelligence/model";
import { resolveReviewItem, type ReviewOutcome } from "@/server/ingestion/write/review";
import { revalidateAll } from "@/server/mutations";
import { getAccessScope, reviewItemWhere } from "@/server/security/access";
import { requireCapability } from "@/server/security/session";
import { attemptAs, fail, id, ok, type ActionResult } from "./result";

const note = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .transform((v) => v || undefined);
/** Editable proposal fields are scalars or short string lists (decision options). */
const editedValue = z.union([z.string().max(4000), z.number().finite(), z.boolean(), z.null(), z.array(z.string().max(300)).max(20)]);

const decisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("APPROVE"), note }),
  z.object({
    action: z.literal("EDIT"),
    edited: z.record(z.string().min(1).max(64), editedValue).refine((r) => Object.keys(r).length > 0 && Object.keys(r).length <= 40, "Nothing to save"),
    note,
  }),
  z.object({ action: z.literal("REJECT"), note }),
  z.object({ action: z.literal("MERGE"), mergeIntoId: id.max(64), note }),
  z.object({ action: z.literal("IGNORE"), note }),
]);

export type ReviewDecisionInput = z.input<typeof decisionSchema>;

const MESSAGES = {
  APPROVE: "Approved — written to CytoHub Brain",
  EDIT: "Saved and approved",
  REJECT: "Rejected",
  MERGE: "Merged",
  IGNORE: "Ignored",
} as const;

/**
 * Resolve a Brain Review Queue item. The viewer must hold review.resolve and
 * be cleared for the item's sensitivity; the writer re-validates the
 * proposal (including the reviewer's edits) before anything is applied.
 */
export async function resolveReview(reviewItemId: string, decision: ReviewDecisionInput): Promise<ActionResult<ReviewOutcome>> {
  return attemptAs("review.resolve", async () => {
    const viewer = await requireCapability("review.resolve");
    const itemId = id.max(64).parse(reviewItemId);
    const d = decisionSchema.parse(decision);
    const scope = await getAccessScope(viewer);
    const item = await db.reviewQueueItem.findFirst({ where: { AND: [{ id: itemId }, reviewItemWhere(scope)] }, select: { id: true, status: true, kind: true, proposal: true, candidates: true } });
    if (!item) return fail("Review item not found");
    if (item.status !== "PENDING") return fail("This item was already resolved");

    if (d.action === "MERGE") {
      // Merge only into a record the Brain proposed (either side of a duplicate pair, or a listed candidate).
      const allowed =
        item.kind === "ENTITY_MERGE"
          ? [getIn(item.proposal, ["keepId"]), getIn(item.proposal, ["mergeId"])].filter((x): x is string => typeof x === "string")
          : readCandidates(item.candidates).map((c) => c.entityId);
      if (!allowed.includes(d.mergeIntoId)) return fail("Pick one of the proposed records to merge into");
    }

    const outcome = await resolveReviewItem(item.id, d, { userId: viewer.userId, email: viewer.email });
    revalidateAll();
    return ok(outcome, MESSAGES[d.action]);
  });
}
