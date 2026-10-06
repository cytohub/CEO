/**
 * Which review drafts of one source item reach the Brain Review Queue (pure).
 * A reviewer should see the few proposals that matter: repeats of the same
 * ask are collapsed, uncertain-and-minor ones stay in the extraction record,
 * and at most MAX_REVIEWS_PER_SOURCE are filed per item, highest impact first.
 */
import type { ReviewKind } from "@/generated/prisma/enums";
import { actionSimilarity } from "./dedupe";
import type { ReviewDraft } from "./env";

/** At most this many review items per source item: a reviewer sees the few that matter, the rest stay in the extraction record. */
export const MAX_REVIEWS_PER_SOURCE = 2;
/** Unprotected proposals (uncertain tasks, risks…) reach review only at this impact or above. */
export const MIN_UNPROTECTED_IMPACT = 4;

/** Protected proposals change existing company truth; they win ties for the per-source slots. */
export function isProtectedDraft(d: Pick<ReviewDraft, "kind" | "proposal">): boolean {
  if (d.kind === "FIELD_CHANGE" || d.kind === "ENTITY_MERGE" || d.kind === "NEW_INVESTOR") return true;
  return d.kind === "DECISION" && (d.proposal as { status?: string } | null)?.status === "MADE";
}

const KIND_PREFERENCE: Partial<Record<ReviewKind, number>> = { DECISION: 4, COMMITMENT: 3, TASK: 2, DEADLINE: 1 };
const ACTION_KINDS = new Set<ReviewKind>(["TASK", "COMMITMENT", "DECISION", "DEADLINE"]);

export function subjectOf(d: ReviewDraft): string {
  const p = (d.proposal ?? {}) as { title?: string; what?: string; targetLabel?: string };
  return p.title ?? p.what ?? p.targetLabel ?? d.title;
}

function rank(a: ReviewDraft, b: ReviewDraft): number {
  return b.impact - a.impact || Number(isProtectedDraft(b)) - Number(isProtectedDraft(a)) || b.confidenceScore - a.confidenceScore || (KIND_PREFERENCE[b.kind] ?? 0) - (KIND_PREFERENCE[a.kind] ?? 0);
}

/**
 * Pick which buffered drafts to file (pure): drop repeats of the same action
 * (a task, a deadline and a decision quoting the same ask), then keep the
 * highest-impact ones within the per-source budget. Drafts already pending
 * from an earlier run are kept first so the queue does not churn.
 */
export function selectReviewDrafts(drafts: ReviewDraft[], opts: { alreadyPending: Set<string>; slots: number; minImpact?: number }): ReviewDraft[] {
  const minImpact = opts.minImpact ?? MIN_UNPROTECTED_IMPACT;
  const byFingerprint = new Map<string, ReviewDraft>();
  // Uncertain *and* minor is not worth a reviewer's time: it stays in the extraction record.
  for (const d of drafts.filter((x) => isProtectedDraft(x) || x.impact >= minImpact || opts.alreadyPending.has(x.fingerprint))) {
    const prev = byFingerprint.get(d.fingerprint);
    if (!prev || rank(d, prev) < 0) byFingerprint.set(d.fingerprint, d);
  }
  const unique: ReviewDraft[] = [];
  for (const d of [...byFingerprint.values()].sort(rank)) {
    const twin = unique.find((u) => (u.kind === d.kind || (ACTION_KINDS.has(u.kind) && ACTION_KINDS.has(d.kind))) && u.kind !== "FIELD_CHANGE" && actionSimilarity(subjectOf(u), subjectOf(d)) >= 0.6);
    if (!twin) unique.push(d);
  }
  const pending = unique.filter((d) => opts.alreadyPending.has(d.fingerprint));
  const fresh = unique.filter((d) => !opts.alreadyPending.has(d.fingerprint));
  return [...pending, ...fresh].slice(0, Math.max(opts.slots, pending.length));
}
