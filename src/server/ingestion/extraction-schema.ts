/**
 * The structured intelligence contract.
 *
 * Both extractors (Claude structured outputs and the deterministic rules
 * engine) return an IntelligenceExtraction. Nothing reaches the database
 * until validateExtraction() has:
 *   1. parsed it against the zod schema,
 *   2. dropped every item whose `evidence` is not a verbatim quote of the source,
 *   3. dropped dates that do not parse or fall outside a sane window,
 *   4. clamped confidences and trimmed lists.
 * Fields are nullable rather than optional so the JSON Schema given to Claude
 * can mark every property required (strict structured outputs).
 */
import { z } from "zod";
import { CeoCategory, FocusArea, OpportunityKind, Relevance } from "@/generated/prisma/enums";

const confidence = z.number().min(0).max(1);
/** A verbatim quote from the source text supporting the item. */
const evidence = z.string().min(3).max(600);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const name = z.string().min(1).max(200);
const text = (max: number) => z.string().max(max);

export const RISK_CATEGORIES = ["COMMERCIAL", "FUNDRAISING", "SCIENTIFIC", "LEGAL", "OPERATIONAL", "PEOPLE", "FINANCIAL", "REGULATORY", "CUSTOMER", "REPUTATIONAL"] as const;
export const ACTIVITY_TAGS = ["FUNDRAISING", "COMMERCIAL", "SCIENTIFIC", "LEGAL", "OPERATIONAL", "FINANCIAL", "RECRUITING", "PRODUCT", "BOARD", "PARTNERSHIP", "REGULATORY"] as const;
export const EXTRACTED_ENTITY_TYPES = ["PERSON", "COMPANY", "PROJECT", "PRODUCT", "PROGRAM"] as const;
export const EXTRACTED_RELATIONS = ["WORKS_AT", "SUBSIDIARY_OF", "INVESTS_IN", "CUSTOMER_OF", "PARTNER_OF", "ASSOCIATED_WITH", "RELATED_TO"] as const;

export const ExtractedEntity = z.object({
  type: z.enum(EXTRACTED_ENTITY_TYPES),
  name,
  email: text(320).nullable(),
  role: text(160).nullable(),
  companyName: text(200).nullable(),
  confidence,
});

export const ExtractedTask = z.object({
  title: name,
  description: text(1000).nullable(),
  /** Who should do it, as written ("Rajib", "Maya", "me"). */
  ownerName: text(200).nullable(),
  /** True when the CEO is the one being asked / is responsible. */
  ownerIsCeo: z.boolean(),
  dueDate: isoDay.nullable(),
  /** The deadline as phrased in the source ("by Friday"). */
  dueText: text(120).nullable(),
  priorityHint: z.enum(["P0", "P1", "P2", "P3"]).nullable(),
  companyName: text(200).nullable(),
  focusArea: z.enum(FocusArea).nullable(),
  confidence,
  evidence,
});

export const ExtractedCommitment = z.object({
  /** OUTBOUND: CytoHub / the CEO promised it. INBOUND: someone promised it to CytoHub. */
  direction: z.enum(["OUTBOUND", "INBOUND", "INTERNAL"]),
  title: name,
  text: text(1000),
  owedByName: text(200).nullable(),
  owedToName: text(200).nullable(),
  companyName: text(200).nullable(),
  dueDate: isoDay.nullable(),
  dueText: text(120).nullable(),
  confidence,
  evidence,
});

export const ExtractedDecision = z.object({
  title: name,
  /** MADE: a decision was taken. NEEDED: someone is asking for one. */
  status: z.enum(["MADE", "NEEDED"]),
  decision: text(1000).nullable(),
  decidedByName: text(200).nullable(),
  deadline: isoDay.nullable(),
  options: z.array(text(200)).max(6),
  confidence,
  evidence,
});

export const ExtractedDeadline = z.object({
  what: name,
  date: isoDay,
  hard: z.boolean(),
  confidence,
  evidence,
});

export const ExtractedRisk = z.object({
  title: name,
  description: text(1000).nullable(),
  category: z.enum(RISK_CATEGORIES),
  /** 1–5 */
  severity: z.number().int().min(1).max(5),
  companyName: text(200).nullable(),
  confidence,
  evidence,
});

export const ExtractedOpportunity = z.object({
  title: name,
  description: text(1000).nullable(),
  kind: z.enum(OpportunityKind),
  /** USD, when stated. */
  estimatedValue: z.number().nonnegative().nullable(),
  companyName: text(200).nullable(),
  confidence,
  evidence,
});

export const ExtractedFollowUp = z.object({
  title: name,
  withName: text(200).nullable(),
  dueDate: isoDay.nullable(),
  confidence,
  evidence,
});

export const ExtractedMeetingRequest = z.object({
  title: name,
  withName: text(200).nullable(),
  proposedTimes: z.array(text(120)).max(5),
  confidence,
  evidence,
});

/** Key figures and claims (financials, dates, metrics) — also used to diff document versions. */
export const ExtractedFact = z.object({
  /** Stable label, e.g. "Series B raise amount", "Proposal value", "Hold-out AUC". */
  label: text(120).min(1),
  value: text(200).min(1),
  kind: z.enum(["MONEY", "DATE", "PERCENT", "COUNT", "METRIC", "TEXT"]),
  numericValue: z.number().nullable(),
  evidence,
});

export const ExtractedRelationship = z.object({
  fromType: z.enum(EXTRACTED_ENTITY_TYPES),
  fromName: name,
  relation: z.enum(EXTRACTED_RELATIONS),
  toType: z.enum(EXTRACTED_ENTITY_TYPES),
  toName: name,
  confidence,
});

export const RecommendedAction = z.object({
  action: text(300).min(1),
  why: text(400).min(1),
  urgency: z.enum(["IMMEDIATE", "TODAY", "THIS_WEEK", "LATER"]),
});

export const IntelligenceExtractionSchema = z.object({
  /** 1–3 sentence factual summary. */
  summary: text(1200),
  ceoRelevance: z.object({
    level: z.enum(Relevance),
    score: confidence,
    category: z.enum(CeoCategory),
    reasons: z.array(text(200)).max(6),
  }),
  strategicRelevance: z.object({
    score: confidence,
    goalTitles: z.array(text(200)).max(5),
    pillarNames: z.array(text(120)).max(4),
  }),
  meetingRelevance: z.object({
    isMeetingRelated: z.boolean(),
    meetingTitle: text(200).nullable(),
  }),
  activityTags: z.array(z.enum(ACTIVITY_TAGS)).max(6),
  entities: z.array(ExtractedEntity).max(40),
  tasks: z.array(ExtractedTask).max(15),
  commitments: z.array(ExtractedCommitment).max(15),
  decisions: z.array(ExtractedDecision).max(10),
  deadlines: z.array(ExtractedDeadline).max(15),
  risks: z.array(ExtractedRisk).max(10),
  opportunities: z.array(ExtractedOpportunity).max(10),
  followUps: z.array(ExtractedFollowUp).max(10),
  meetingRequests: z.array(ExtractedMeetingRequest).max(5),
  facts: z.array(ExtractedFact).max(40),
  relationships: z.array(ExtractedRelationship).max(30),
  recommendedActions: z.array(RecommendedAction).max(5),
});

export type IntelligenceExtraction = z.infer<typeof IntelligenceExtractionSchema>;
export type ExtractedTaskT = z.infer<typeof ExtractedTask>;
export type ExtractedCommitmentT = z.infer<typeof ExtractedCommitment>;
export type ExtractedDecisionT = z.infer<typeof ExtractedDecision>;
export type ExtractedRiskT = z.infer<typeof ExtractedRisk>;
export type ExtractedOpportunityT = z.infer<typeof ExtractedOpportunity>;
export type ExtractedFactT = z.infer<typeof ExtractedFact>;

export function emptyExtraction(): IntelligenceExtraction {
  return {
    summary: "",
    ceoRelevance: { level: "NORMAL", score: 0.5, category: "OTHER", reasons: [] },
    strategicRelevance: { score: 0, goalTitles: [], pillarNames: [] },
    meetingRelevance: { isMeetingRelated: false, meetingTitle: null },
    activityTags: [],
    entities: [],
    tasks: [],
    commitments: [],
    decisions: [],
    deadlines: [],
    risks: [],
    opportunities: [],
    followUps: [],
    meetingRequests: [],
    facts: [],
    relationships: [],
    recommendedActions: [],
  };
}

// ─── JSON Schema for Claude structured outputs ───────────────────────────────

const UNSUPPORTED_KEYWORDS = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "multipleOf"]);

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(k)) continue;
    out[k] = strictify(v);
  }
  if (out.type === "object" && out.properties && typeof out.properties === "object") {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

let cachedJsonSchema: Record<string, unknown> | null = null;

/** JSON Schema (strict subset: every property required, no numeric/string constraints). */
export function extractionJsonSchema(): Record<string, unknown> {
  cachedJsonSchema ??= strictify(z.toJSONSchema(IntelligenceExtractionSchema, { target: "draft-7", io: "output" })) as Record<string, unknown>;
  return cachedJsonSchema;
}

// ─── Validation ──────────────────────────────────────────────────────────────

export interface ValidationIssue {
  path: string;
  reason: string;
}

/** Whitespace/quote/case-insensitive normalization used for the evidence check. */
export function normalizeForEvidence(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim();
}

export function evidenceFound(evidenceText: string, normalizedSource: string): boolean {
  const e = normalizeForEvidence(evidenceText).replace(/^["'.…\s]+|["'.…\s]+$/g, "");
  if (e.length < 3) return false;
  if (normalizedSource.includes(e)) return true;
  // Allow elided quotes ("… by Friday … expanding the study"): every fragment must appear, in order.
  const parts = e.split(/\s*(?:\.\.\.|…)\s*/).filter((p) => p.length >= 3);
  if (parts.length < 2) return false;
  let from = 0;
  for (const p of parts) {
    const at = normalizedSource.indexOf(p, from);
    if (at < 0) return false;
    from = at + p.length;
  }
  return true;
}

function dayOk(day: string | null, now: Date, issues: ValidationIssue[], path: string): string | null {
  if (day == null) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  const min = now.getTime() - 2 * 365 * 86_400_000;
  const max = now.getTime() + 3 * 365 * 86_400_000;
  if (Number.isNaN(t) || t < min || t > max) {
    issues.push({ path, reason: `date ${day} is invalid or out of range` });
    return null;
  }
  return day;
}

type WithEvidence = { evidence: string };

/**
 * Validate raw extractor output against the schema and the source text.
 * Returns a clean extraction plus the issues found (counted as AI extraction errors).
 * Never throws for bad model output — an unparseable result becomes an empty extraction.
 */
export function validateExtraction(raw: unknown, sourceText: string, now: Date): { extraction: IntelligenceExtraction; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const parsed = IntelligenceExtractionSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 10)) issues.push({ path: i.path.join("."), reason: i.message });
    return { extraction: emptyExtraction(), issues };
  }
  const x = parsed.data;
  const normalized = normalizeForEvidence(sourceText);
  const keep = <T extends WithEvidence>(list: T[], key: string): T[] =>
    list.filter((item, idx) => {
      if (evidenceFound(item.evidence, normalized)) return true;
      issues.push({ path: `${key}.${idx}`, reason: "evidence is not a verbatim quote of the source" });
      return false;
    });

  const tasks = keep(x.tasks, "tasks").map((t, i) => ({ ...t, dueDate: dayOk(t.dueDate, now, issues, `tasks.${i}.dueDate`) }));
  const commitments = keep(x.commitments, "commitments").map((c, i) => ({ ...c, dueDate: dayOk(c.dueDate, now, issues, `commitments.${i}.dueDate`) }));
  const decisions = keep(x.decisions, "decisions").map((d, i) => ({ ...d, deadline: dayOk(d.deadline, now, issues, `decisions.${i}.deadline`) }));
  const deadlines = keep(x.deadlines, "deadlines").filter((d, i) => dayOk(d.date, now, issues, `deadlines.${i}.date`) != null);
  const followUps = keep(x.followUps, "followUps").map((f, i) => ({ ...f, dueDate: dayOk(f.dueDate, now, issues, `followUps.${i}.dueDate`) }));

  return {
    extraction: {
      ...x,
      tasks,
      commitments,
      decisions,
      deadlines,
      risks: keep(x.risks, "risks"),
      opportunities: keep(x.opportunities, "opportunities"),
      followUps,
      meetingRequests: keep(x.meetingRequests, "meetingRequests"),
      facts: keep(x.facts, "facts"),
    },
    issues,
  };
}
