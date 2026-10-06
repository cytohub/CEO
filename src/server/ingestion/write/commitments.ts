/** CONTRACT STUB — implemented by the resolution & write workstream. */
import type { PipelineContext } from "../types";

/** Daily pass: surface overdue commitments (both directions) as insights / inbox items. */
export async function sweepCommitments(_ctx: PipelineContext): Promise<{ overdue: number; insights: number; inbox: number }> {
  throw new Error("sweepCommitments: not implemented yet");
}
