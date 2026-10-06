/**
 * Intelligence-level deduplication (docs/ingestion/ARCHITECTURE.md §7).
 *
 * Before the writer creates a task or commitment it looks for an open one with
 * a similar action: token-set Jaccard on normalized action text (stopwords
 * removed, light stemming). Records that share context with the source — the
 * same email thread, meeting or company, or the source item itself — match at
 * ≥ 0.6; anything else must be near-identical (≥ 0.85). A match is updated and
 * corroborated instead of duplicated. The scorer is a plain function so an
 * embedding-based one can replace it.
 */
import { createHash } from "node:crypto";
import type { Tx } from "@/lib/db";
import { stripAccents } from "../resolve/names";
import { targetsReferencedBy } from "./provenance";

// ─── Text similarity (pure) ──────────────────────────────────────────────────

const STOPWORDS = new Set(
  (
    "a an the to for of and or with on in at by from as is are be been being our your my their his her its we i you they he she it me us them " +
    "this that these those please pls kindly will would could can should shall must need needs want wants asap re fw fwd about into over also just " +
    "all any some so then than do does did have has had get got let know up out back again soon today tomorrow week next by end eod there here " +
    "what when which who whom whose how why if not no yes ok okay thanks thank hi hello dear regards best cheers"
  ).split(" "),
);

/** Light suffix stemming: enough to match "revised"/"revise", "packages"/"package", "sending"/"send". */
export function lightStem(token: string): string {
  let t = token;
  if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && (t.endsWith("ied") || t.endsWith("ies"))) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && /(ss|x|ch|sh)es$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith("s") && !/(ss|us|is)$/.test(t)) t = t.slice(0, -1);
  if (t.length > 4 && t.endsWith("e")) t = t.slice(0, -1);
  return t;
}

export function actionTokens(text: string): string[] {
  const words = stripAccents(text)
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9$%.]+/g, " ")
    .split(" ")
    // Keep decimal points ("0.88") but not sentence dots.
    .map((w) => w.replace(/^[.]+|[.]+$/g, ""))
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || w.length < 2) continue;
    out.push(lightStem(w));
  }
  return out;
}

export function tokenSet(text: string): Set<string> {
  return new Set(actionTokens(text));
}

/** Token-set Jaccard similarity of two action phrases (0–1). */
export function actionSimilarity(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Share of `needle`'s tokens present in `haystack` (0–1): "is this action mentioned in that text?". */
export function tokenCoverage(needle: string, haystack: string | Set<string>): number {
  const N = tokenSet(needle);
  if (!N.size) return 0;
  const H = typeof haystack === "string" ? tokenSet(haystack) : haystack;
  let hit = 0;
  for (const t of N) if (H.has(t)) hit++;
  return hit / N.size;
}

export const SHARED_CONTEXT_THRESHOLD = 0.6;
export const NO_CONTEXT_THRESHOLD = 0.85;

export function isDuplicateAction(a: string, b: string, sharedContext: boolean): { match: boolean; score: number } {
  const score = actionSimilarity(a, b);
  return { match: score >= (sharedContext ? SHARED_CONTEXT_THRESHOLD : NO_CONTEXT_THRESHOLD), score };
}

/** Order-insensitive key of an action, for fingerprints. */
export function actionKey(text: string): string {
  return [...tokenSet(text)].sort().join(" ");
}

export function shortHash(...parts: (string | null | undefined)[]): string {
  return createHash("sha256")
    .update(parts.map((p) => p ?? "").join("|"))
    .digest("hex")
    .slice(0, 24);
}

// ─── Candidate search (database) ─────────────────────────────────────────────

export interface DedupeScope {
  /** The source item being written (records it already produced always count as shared context). */
  sourceItemId: string | null;
  threadId: string | null;
  meetingId: string | null;
  companyIds: string[];
  /** Also compare (strictly) against open work of this owner. */
  ownerPersonId?: string | null;
  now: Date;
  windowDays?: number;
}

export interface DuplicateMatch<T> {
  record: T;
  score: number;
  sharedContext: boolean;
}

const OPEN_TASK = ["TODO", "IN_PROGRESS", "WAITING", "BLOCKED", "SOMEDAY"] as const;

async function threadSourceItemIds(tx: Tx, threadId: string | null): Promise<string[]> {
  if (!threadId) return [];
  const rows = await tx.emailMessage.findMany({ where: { threadId }, select: { sourceItemId: true } });
  return rows.map((r) => r.sourceItemId);
}

const TASK_SELECT = {
  id: true,
  title: true,
  status: true,
  priority: true,
  dueDate: true,
  originalDueDate: true,
  postponeCount: true,
  hardDeadline: true,
  ownerId: true,
  companyId: true,
  meetingId: true,
  createdAt: true,
  commitment: { select: { id: true } },
} as const;

export type TaskCandidate = { id: string; title: string; status: string; priority: string; dueDate: Date | null; originalDueDate: Date | null; postponeCount: number; hardDeadline: boolean; ownerId: string | null; companyId: string | null; meetingId: string | null; createdAt: Date; commitment: { id: string } | null };

function best<T extends { title: string; id: string }>(title: string, shared: T[], other: T[]): DuplicateMatch<T> | null {
  let top: DuplicateMatch<T> | null = null;
  const seen = new Set<string>();
  for (const [list, isShared] of [
    [shared, true],
    [other, false],
  ] as const) {
    for (const r of list) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const { match, score } = isDuplicateAction(title, r.title, isShared);
      if (match && (!top || score > top.score)) top = { record: r, score, sharedContext: isShared };
    }
  }
  return top;
}

/** Find an existing task that already captures this action. */
export async function findDuplicateTask(tx: Tx, title: string, scope: DedupeScope): Promise<DuplicateMatch<TaskCandidate> | null> {
  const since = new Date(scope.now.getTime() - (scope.windowDays ?? 60) * 86_400_000);
  const threadItems = await threadSourceItemIds(tx, scope.threadId);
  const sameItem = scope.sourceItemId ? await targetsReferencedBy(tx, "TASK", [scope.sourceItemId]) : [];
  const threadTasks = await targetsReferencedBy(tx, "TASK", threadItems);

  const or: object[] = [];
  if (threadTasks.length) or.push({ id: { in: threadTasks } });
  if (scope.meetingId) or.push({ meetingId: scope.meetingId });
  if (scope.companyIds.length) or.push({ companyId: { in: scope.companyIds } });

  const [mine, shared, owned] = await Promise.all([
    // Re-processing the same source must find what it created, whatever its status.
    sameItem.length ? tx.task.findMany({ where: { id: { in: sameItem } }, select: TASK_SELECT }) : [],
    or.length ? tx.task.findMany({ where: { status: { in: [...OPEN_TASK] }, createdAt: { gte: since }, OR: or }, select: TASK_SELECT, take: 300 }) : [],
    scope.ownerPersonId
      ? tx.task.findMany({ where: { status: { in: [...OPEN_TASK] }, createdAt: { gte: since }, ownerId: scope.ownerPersonId }, select: TASK_SELECT, take: 300 })
      : [],
  ]);
  return best(title, [...mine, ...shared], owned);
}

const COMMITMENT_SELECT = {
  id: true,
  title: true,
  direction: true,
  status: true,
  dueDate: true,
  dueText: true,
  followUpDate: true,
  fingerprint: true,
  ownerPersonId: true,
  counterpartyPersonId: true,
  companyId: true,
  threadId: true,
  meetingId: true,
  taskId: true,
  committedAt: true,
} as const;

export type CommitmentCandidate = {
  id: string;
  title: string;
  direction: string;
  status: string;
  dueDate: Date | null;
  dueText: string | null;
  followUpDate: Date | null;
  fingerprint: string;
  ownerPersonId: string | null;
  counterpartyPersonId: string | null;
  companyId: string | null;
  threadId: string | null;
  meetingId: string | null;
  taskId: string | null;
  committedAt: Date;
};

/** Find an existing commitment in the same direction that already captures this promise. */
export async function findDuplicateCommitment(
  tx: Tx,
  title: string,
  direction: "OUTBOUND" | "INBOUND" | "INTERNAL",
  scope: DedupeScope & { fingerprint: string; counterpartyPersonId?: string | null },
): Promise<DuplicateMatch<CommitmentCandidate> | null> {
  const exact = await tx.commitment.findUnique({ where: { fingerprint: scope.fingerprint }, select: COMMITMENT_SELECT });
  if (exact) return { record: exact, score: 1, sharedContext: true };

  const since = new Date(scope.now.getTime() - (scope.windowDays ?? 60) * 86_400_000);
  const sameItem = scope.sourceItemId ? await targetsReferencedBy(tx, "COMMITMENT", [scope.sourceItemId]) : [];
  const or: object[] = [];
  if (scope.threadId) or.push({ threadId: scope.threadId });
  if (scope.meetingId) or.push({ meetingId: scope.meetingId });
  if (scope.companyIds.length) or.push({ companyId: { in: scope.companyIds } });
  if (scope.counterpartyPersonId) or.push({ counterpartyPersonId: scope.counterpartyPersonId }, { ownerPersonId: scope.counterpartyPersonId });

  const [mine, shared, owned] = await Promise.all([
    sameItem.length ? tx.commitment.findMany({ where: { id: { in: sameItem }, direction }, select: COMMITMENT_SELECT }) : [],
    or.length ? tx.commitment.findMany({ where: { direction, status: "OPEN", createdAt: { gte: since }, OR: or }, select: COMMITMENT_SELECT, take: 300 }) : [],
    scope.ownerPersonId
      ? tx.commitment.findMany({ where: { direction, status: "OPEN", createdAt: { gte: since }, ownerPersonId: scope.ownerPersonId }, select: COMMITMENT_SELECT, take: 300 })
      : [],
  ]);
  return best(title, [...mine, ...shared], owned);
}
