/**
 * Prepare Me brief: the stored shape and its validation. Client-safe and pure.
 *
 * v1 briefs (stored on Meeting.prepBrief before ingestion) have only the
 * legacy fields; v2 adds the sections drawn from threads, commitments,
 * documents and relationship history. normalizePrepBrief() turns any stored
 * JSON into a valid PrepBrief (missing v2 sections become empty), so old
 * briefs keep rendering and malformed ones never crash the meeting sheet.
 */
import { z } from "zod";
import type { Sensitivity } from "@/generated/prisma/enums";

const str = z.string().catch("");
const optStr = z.string().optional().catch(undefined);
const arr = <T extends z.ZodTypeAny>(item: T) => z.array(z.unknown()).catch([]).transform((xs) => xs.map((x) => item.safeParse(x)).filter((r) => r.success).map((r) => r.data as z.infer<T>));

const LinkItem = z.object({ id: z.string(), title: z.string(), detail: optStr, href: z.string() });
const ParticipantContext = z.object({
  personId: optStr,
  name: z.string(),
  title: optStr,
  company: optStr,
  companyId: optStr,
  lastContact: optStr,
  recentThreads: z.number().catch(0),
  owedByUs: z.number().catch(0),
  owedToUs: z.number().catch(0),
  notes: optStr,
  href: optStr,
});
const CompanyContext = z.object({
  id: z.string(),
  name: z.string(),
  type: str,
  description: optStr,
  parent: optStr,
  relationship: z.number().catch(3),
  deal: z.object({ name: z.string(), stage: str, value: optStr, probability: z.number().catch(0), nextStep: optStr, expectedClose: optStr }).nullable().catch(null),
  recentInsights: arr(z.object({ title: z.string(), date: str, href: optStr })),
});
const HistoryItem = z.object({ date: z.string(), kind: z.enum(["meeting", "thread", "decision", "commitment", "note", "signal"]).catch("signal"), title: z.string(), detail: optStr, href: optStr });
const RecentEmail = z.object({ id: z.string(), subject: z.string(), status: str, statusLabel: str, summary: optStr, lastMessageAt: str, href: z.string() });
const BriefCommitment = z.object({
  id: z.string(),
  title: z.string(),
  direction: z.enum(["OUTBOUND", "INBOUND", "INTERNAL"]).catch("INTERNAL"),
  state: z.enum(["open", "overdue", "fulfilled"]).catch("open"),
  due: optStr,
  party: optStr,
  href: z.string(),
});
const OpenQuestion = z.object({ question: z.string(), source: optStr, href: optStr });
const BriefDocument = z.object({ id: z.string(), title: z.string(), docType: str, version: z.number().catch(1), modifiedAt: optStr, changeSummary: optStr, changes: arr(z.string()), href: z.string() });
const StrategicImportance = z.object({
  goal: z.object({ id: z.string(), title: z.string(), progress: z.number().catch(0), status: str, href: z.string() }).nullable().catch(null),
  pillar: z.string().nullable().catch(null),
  deal: z.string().nullable().catch(null),
  whyNow: arr(z.string()),
});
const PotentialRisk = z.object({ title: z.string(), detail: optStr, source: z.enum(["risk", "insight", "deal", "milestone"]).catch("insight"), href: optStr });

export const PrepBriefSchema = z.object({
  generatedAt: z.string().catch(() => new Date(0).toISOString()),
  engine: z.enum(["claude", "rules"]).catch("rules"),
  version: z.number().optional().catch(undefined),
  maxSensitivity: z.enum(["INTERNAL", "CONFIDENTIAL", "RESTRICTED"]).nullable().optional().catch(undefined),
  builtByUserId: optStr,
  // v1
  context: str,
  history: arr(z.object({ date: z.string(), title: z.string(), detail: optStr })),
  participants: arr(z.object({ name: z.string(), role: str, lastContact: optStr, note: optStr })),
  objectives: arr(z.string()),
  openIssues: arr(z.object({ title: z.string(), kind: str, href: optStr })),
  talkingPoints: arr(z.string()),
  desiredOutcome: str,
  questions: arr(z.string()),
  risks: arr(z.string()),
  nextActions: arr(z.string()),
  // v2
  objective: optStr,
  participantContext: arr(ParticipantContext),
  companyContext: CompanyContext.nullable().catch(null),
  relationshipHistory: arr(HistoryItem),
  recentEmails: arr(RecentEmail),
  openTasks: arr(LinkItem),
  commitments: arr(BriefCommitment),
  openQuestions: arr(OpenQuestion),
  documents: arr(BriefDocument),
  strategicImportance: StrategicImportance.nullable().catch(null),
  potentialRisks: arr(PotentialRisk),
});

export type PrepBrief = z.infer<typeof PrepBriefSchema>;
export type BriefCommitment = z.infer<typeof BriefCommitment>;
export type BriefHistoryItem = z.infer<typeof HistoryItem>;
export type BriefParticipant = z.infer<typeof ParticipantContext>;

/** Any stored JSON → a valid brief, or null when it is not a brief at all. */
export function normalizePrepBrief(json: unknown): PrepBrief | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const parsed = PrepBriefSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** v2 briefs carry the ingestion-backed sections. */
export function isRichBrief(b: PrepBrief): boolean {
  return (b.version ?? 1) >= 2;
}

const RANK: Record<Sensitivity, number> = { INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };

export function maxSensitivity(levels: (Sensitivity | null | undefined)[]): Sensitivity | null {
  let best: Sensitivity | null = null;
  for (const l of levels) if (l && (!best || RANK[l] > RANK[best])) best = l;
  return best;
}

/**
 * Can a viewer with these clearance levels see a stored brief? A brief built
 * from restricted sources is shown only to viewers cleared for its most
 * sensitive source (or unrestricted viewers). v1 briefs used no source content.
 */
export function briefVisibleTo(brief: Pick<PrepBrief, "maxSensitivity">, scope: { all: boolean; levels: readonly Sensitivity[] }): boolean {
  if (scope.all || !brief.maxSensitivity) return true;
  return scope.levels.includes(brief.maxSensitivity);
}

// ─── Claude rewrite contract (same facts, sharper words) ────────────────────

export const BriefRewriteSchema = z.object({
  context: z.string().min(1).max(1200),
  objective: z.string().min(1).max(400),
  talkingPoints: z.array(z.string().min(1).max(400)).min(1).max(8),
  questions: z.array(z.string().min(1).max(300)).min(1).max(6),
  desiredOutcome: z.string().min(1).max(400),
  risks: z.array(z.string().min(1).max(400)).max(6),
  nextActions: z.array(z.string().min(1).max(300)).min(1).max(6),
  whyNow: z.array(z.string().min(1).max(300)).max(4),
});
export type BriefRewrite = z.infer<typeof BriefRewriteSchema>;

export const BRIEF_REWRITE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["context", "objective", "talkingPoints", "questions", "desiredOutcome", "risks", "nextActions", "whyNow"],
  properties: {
    context: { type: "string" },
    objective: { type: "string" },
    talkingPoints: { type: "array", items: { type: "string" } },
    questions: { type: "array", items: { type: "string" } },
    desiredOutcome: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
    nextActions: { type: "array", items: { type: "string" } },
    whyNow: { type: "array", items: { type: "string" } },
  },
} as const;

/** Apply a validated Claude rewrite; structured sections stay as the rules built them. */
export function applyRewrite(brief: PrepBrief, raw: unknown): PrepBrief {
  const parsed = BriefRewriteSchema.safeParse(raw);
  if (!parsed.success) return brief;
  const r = parsed.data;
  return {
    ...brief,
    engine: "claude",
    context: r.context,
    objective: r.objective,
    objectives: [r.objective, ...brief.objectives.filter((o) => o !== brief.objective)].slice(0, 4),
    talkingPoints: r.talkingPoints,
    questions: r.questions,
    desiredOutcome: r.desiredOutcome,
    risks: r.risks,
    nextActions: r.nextActions,
    strategicImportance: brief.strategicImportance ? { ...brief.strategicImportance, whyNow: r.whyNow.length ? r.whyNow : brief.strategicImportance.whyNow } : brief.strategicImportance,
  };
}
