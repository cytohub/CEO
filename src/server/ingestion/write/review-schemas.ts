/**
 * Typed proposals for the Brain Review Queue, one schema per ReviewKind.
 *
 * The writer builds the same proposal whether it applies it immediately (high
 * confidence) or queues it for a human, and approval applies it through the
 * same functions (records.ts). Every proposal is validated when queued and
 * again when approved, edited or merged — reviewers' edits are untrusted input.
 *
 * Conventions: calendar days are "YYYY-MM-DD"; ids are cuid strings;
 * `confidence` is 0–1; `evidence` is the verbatim source quote.
 */
import { z } from "zod";
import {
  CommitmentDirection,
  CommitmentStatus,
  CompanyType,
  DecisionStatus,
  FocusArea,
  ItemSource,
  MeetingCategory,
  MeetingType,
  MilestoneStatus,
  OpportunityKind,
  PersonType,
  Priority,
  RiskStatus,
  TaskStatus,
  type ReviewKind,
} from "@/generated/prisma/enums";
import { RISK_CATEGORIES } from "../extraction-schema";

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
const instant = z.iso.datetime({ offset: true });
const confidence = z.number().min(0).max(1);
const evidence = z.string().max(600).nullable().default(null);
const rating = z.number().int().min(0).max(5);
const nid = id.nullable().default(null);

export const TaskScores = z.object({
  strategicImpact: rating.default(3),
  revenueImpact: rating.default(0),
  fundraisingImpact: rating.default(0),
  customerImpact: rating.default(0),
  scientificImpact: rating.default(0),
  riskLevel: rating.default(1),
  ceoUniqueness: rating.default(3),
  opportunityCost: rating.default(2),
});

export const TaskProposal = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000).nullable().default(null),
  ownerPersonId: nid,
  /** As written in the source, for display when the owner could not be resolved. */
  ownerName: z.string().max(200).nullable().default(null),
  dueDate: day.nullable().default(null),
  dueText: z.string().max(120).nullable().default(null),
  hardDeadline: z.boolean().default(false),
  priority: z.enum(Priority).default("P2"),
  focusArea: z.enum(FocusArea).default("OPERATIONS"),
  source: z.enum(ItemSource).default("BRAIN"),
  companyId: nid,
  goalId: nid,
  milestoneId: nid,
  meetingId: nid,
  personIds: z.array(id).max(10).default([]),
  scores: TaskScores.default(TaskScores.parse({})),
  confidence,
  evidence,
});

export const CommitmentProposal = z.object({
  direction: z.enum(CommitmentDirection),
  title: z.string().trim().min(1).max(300),
  text: z.string().max(1000),
  ownerPersonId: nid,
  counterpartyPersonId: nid,
  companyId: nid,
  threadId: nid,
  meetingId: nid,
  dealId: nid,
  goalId: nid,
  projectId: nid,
  dueDate: day.nullable().default(null),
  dueText: z.string().max(120).nullable().default(null),
  followUpDate: day.nullable().default(null),
  /** Mirror as a CEO task (CEO-owed commitments compete for the Top 5). */
  mirrorTask: z.boolean().default(false),
  /** Existing task to use as the mirror instead of creating one. */
  linkTaskId: nid,
  priority: z.enum(Priority).default("P2"),
  focusArea: z.enum(FocusArea).default("OPERATIONS"),
  scores: TaskScores.default(TaskScores.parse({})),
  confidence,
  evidence,
});

export const DeadlineProposal = z.object({
  what: z.string().trim().min(1).max(300),
  date: day,
  hard: z.boolean().default(false),
  /** Work the deadline attaches to; null → a new task is created on approval. */
  targetType: z.enum(["TASK", "COMMITMENT"]).nullable().default(null),
  targetId: nid,
  ownerPersonId: nid,
  companyId: nid,
  goalId: nid,
  meetingId: nid,
  priority: z.enum(Priority).default("P2"),
  focusArea: z.enum(FocusArea).default("OPERATIONS"),
  confidence,
  evidence,
});

export const DecisionProposal = z.object({
  status: z.enum(["MADE", "NEEDED"]),
  title: z.string().trim().min(1).max(300),
  decision: z.string().max(2000).nullable().default(null),
  context: z.string().max(4000).nullable().default(null),
  decidedByName: z.string().max(200).nullable().default(null),
  ownerPersonId: nid,
  deadline: day.nullable().default(null),
  options: z.array(z.string().max(200)).max(6).default([]),
  /** Open Decision this proposal resolves (MADE) or corroborates (NEEDED). */
  matchDecisionId: nid,
  meetingId: nid,
  goalId: nid,
  companyIds: z.array(id).max(10).default([]),
  strategicImpact: z.number().int().min(1).max(5).default(3),
  confidence,
  evidence,
});

export const RiskProposal = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(2000).nullable().default(null),
  category: z.enum(RISK_CATEGORIES),
  severity: z.number().int().min(1).max(5),
  likelihood: z.number().int().min(1).max(5).nullable().default(null),
  companyId: nid,
  dealId: nid,
  goalId: nid,
  milestoneId: nid,
  projectId: nid,
  ownerPersonId: nid,
  confidence,
  evidence,
});

export const OpportunityProposal = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(2000).nullable().default(null),
  kind: z.enum(OpportunityKind),
  estimatedValue: z.number().nonnegative().nullable().default(null),
  nextStep: z.string().max(300).nullable().default(null),
  companyId: nid,
  personId: nid,
  dealId: nid,
  goalId: nid,
  projectId: nid,
  confidence,
  evidence,
});

export const MeetingProposal = z.object({
  title: z.string().trim().min(1).max(300),
  startsAt: instant,
  endsAt: instant,
  type: z.enum(MeetingType).default("EXTERNAL"),
  category: z.enum(MeetingCategory).nullable().default(null),
  focusArea: z.enum(FocusArea).default("OPERATIONS"),
  importance: z.number().int().min(1).max(5).default(3),
  location: z.string().max(300).nullable().default(null),
  objective: z.string().max(1000).nullable().default(null),
  companyId: nid,
  goalId: nid,
  attendeeIds: z.array(id).max(30).default([]),
  confidence,
  evidence,
});

export const EntityMergeProposal = z.object({
  entityType: z.enum(["COMPANY", "PERSON"]),
  /** The record kept by default (the older / canonical one). The reviewer may pick the other via MERGE. */
  keepId: id,
  keepLabel: z.string().max(300),
  mergeId: id,
  mergeLabel: z.string().max(300),
  score: confidence,
  reason: z.string().max(500),
});

export const NewPersonProposal = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().nullable().default(null),
  title: z.string().max(200).nullable().default(null),
  type: z.enum(PersonType).default("OTHER"),
  companyId: nid,
  confidence,
  evidence,
});

export const NewCompanyProposal = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().max(253).nullable().default(null),
  type: z.enum(CompanyType).default("OTHER"),
  industry: z.string().max(200).nullable().default(null),
  /** People already created for this domain, attached to the company on approval. */
  personIds: z.array(id).max(50).default([]),
  confidence,
  evidence,
});

export const NewInvestorProposal = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().max(253).nullable().default(null),
  website: z.string().max(300).nullable().default(null),
  industry: z.string().max(200).nullable().default("Venture capital"),
  personIds: z.array(id).max(50).default([]),
  /** Also open a FUNDRAISING deal for the current round. */
  createDeal: z.boolean().default(false),
  dealName: z.string().max(200).nullable().default(null),
  confidence,
  evidence,
});

export const FIELD_CHANGE_TARGETS = ["TASK", "COMMITMENT", "MILESTONE", "DEAL", "RISK", "DECISION", "MEETING"] as const;
export const FIELD_CHANGE_FIELDS = ["dueDate", "ownerId", "status", "value", "severity", "deadline", "expectedClose"] as const;
export type FieldChangeTarget = (typeof FIELD_CHANGE_TARGETS)[number];
export type FieldChangeField = (typeof FIELD_CHANGE_FIELDS)[number];

const scalar = z.union([z.string().max(200), z.number(), z.null()]);

/** Which fields may be changed through review, and how the value is validated. */
const FIELD_RULES: Record<FieldChangeTarget, Partial<Record<FieldChangeField, z.ZodType>>> = {
  TASK: { dueDate: day.nullable(), ownerId: id, status: z.enum(TaskStatus) },
  COMMITMENT: { dueDate: day.nullable(), status: z.enum(CommitmentStatus), ownerId: id },
  MILESTONE: { dueDate: day, status: z.enum(MilestoneStatus) },
  DEAL: { value: z.number().nonnegative(), expectedClose: day.nullable() },
  RISK: { status: z.enum(RiskStatus), severity: z.number().int().min(1).max(5) },
  DECISION: { deadline: day.nullable(), status: z.enum(DecisionStatus) },
  MEETING: { status: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]) },
};

export const FieldChangeProposal = z
  .object({
    targetType: z.enum(FIELD_CHANGE_TARGETS),
    targetId: id,
    targetLabel: z.string().max(300),
    field: z.enum(FIELD_CHANGE_FIELDS),
    from: scalar.default(null),
    to: scalar,
    /** Human labels for the values ("Oct 9", "$1.4M", "Maya Lindqvist"). */
    fromLabel: z.string().max(200).nullable().default(null),
    toLabel: z.string().max(200).nullable().default(null),
    /** Change-detection kind, e.g. "deadline_moved", "proposal_value_changed". */
    changeKind: z.string().max(60).nullable().default(null),
    note: z.string().max(1000).nullable().default(null),
    confidence,
    evidence,
  })
  .superRefine((p, ctx) => {
    const rule = FIELD_RULES[p.targetType][p.field];
    if (!rule) {
      ctx.addIssue({ code: "custom", path: ["field"], message: `${p.field} cannot be changed on a ${p.targetType.toLowerCase()} through review` });
      return;
    }
    const r = rule.safeParse(p.to);
    if (!r.success) ctx.addIssue({ code: "custom", path: ["to"], message: r.error.issues[0]?.message ?? "Invalid value" });
  });

export const DocumentChangeProposal = z.object({
  documentId: id,
  versionId: nid,
  title: z.string().max(300),
  changes: z
    .array(z.object({ label: z.string().max(200), from: z.string().max(300).nullable(), to: z.string().max(300).nullable() }))
    .max(20)
    .default([]),
  confidence,
  evidence,
});

export const PROPOSAL_SCHEMAS = {
  TASK: TaskProposal,
  COMMITMENT: CommitmentProposal,
  DEADLINE: DeadlineProposal,
  DECISION: DecisionProposal,
  RISK: RiskProposal,
  OPPORTUNITY: OpportunityProposal,
  MEETING: MeetingProposal,
  ENTITY_MERGE: EntityMergeProposal,
  NEW_PERSON: NewPersonProposal,
  NEW_COMPANY: NewCompanyProposal,
  NEW_INVESTOR: NewInvestorProposal,
  FIELD_CHANGE: FieldChangeProposal,
  DOCUMENT_CHANGE: DocumentChangeProposal,
} satisfies Record<ReviewKind, z.ZodType>;

export type ProposalFor<K extends ReviewKind> = z.output<(typeof PROPOSAL_SCHEMAS)[K]>;
export type ProposalInput<K extends ReviewKind> = z.input<(typeof PROPOSAL_SCHEMAS)[K]>;

export type TaskProposalT = z.output<typeof TaskProposal>;
export type CommitmentProposalT = z.output<typeof CommitmentProposal>;
export type DeadlineProposalT = z.output<typeof DeadlineProposal>;
export type DecisionProposalT = z.output<typeof DecisionProposal>;
export type RiskProposalT = z.output<typeof RiskProposal>;
export type OpportunityProposalT = z.output<typeof OpportunityProposal>;
export type MeetingProposalT = z.output<typeof MeetingProposal>;
export type EntityMergeProposalT = z.output<typeof EntityMergeProposal>;
export type NewPersonProposalT = z.output<typeof NewPersonProposal>;
export type NewCompanyProposalT = z.output<typeof NewCompanyProposal>;
export type NewInvestorProposalT = z.output<typeof NewInvestorProposal>;
export type FieldChangeProposalT = z.output<typeof FieldChangeProposal>;
export type DocumentChangeProposalT = z.output<typeof DocumentChangeProposal>;

/** Validate a proposal for a kind. Throws a ZodError on invalid input. */
export function parseProposal<K extends ReviewKind>(kind: K, value: unknown): ProposalFor<K> {
  return PROPOSAL_SCHEMAS[kind].parse(value) as ProposalFor<K>;
}

export function safeParseProposal<K extends ReviewKind>(kind: K, value: unknown): { success: true; data: ProposalFor<K> } | { success: false; error: string } {
  const r = PROPOSAL_SCHEMAS[kind].safeParse(value);
  if (r.success) return { success: true, data: r.data as ProposalFor<K> };
  return { success: false, error: r.error.issues.map((i) => `${i.path.join(".") || "proposal"}: ${i.message}`).join("; ") };
}

/** Fields a reviewer may edit per kind (identity fields such as targetId stay fixed). */
export const EDITABLE_FIELDS: Record<ReviewKind, readonly string[]> = {
  TASK: ["title", "description", "ownerPersonId", "dueDate", "hardDeadline", "priority", "focusArea", "companyId", "goalId", "milestoneId"],
  COMMITMENT: ["title", "text", "ownerPersonId", "counterpartyPersonId", "companyId", "dueDate", "followUpDate", "mirrorTask", "priority"],
  DEADLINE: ["what", "date", "hard", "ownerPersonId", "priority"],
  DECISION: ["title", "decision", "context", "deadline", "ownerPersonId", "goalId", "strategicImpact", "options", "matchDecisionId"],
  RISK: ["title", "description", "category", "severity", "likelihood", "companyId", "goalId", "ownerPersonId"],
  OPPORTUNITY: ["title", "description", "kind", "estimatedValue", "nextStep", "companyId", "goalId"],
  MEETING: ["title", "startsAt", "endsAt", "type", "importance", "objective", "location"],
  ENTITY_MERGE: [],
  NEW_PERSON: ["name", "email", "title", "type", "companyId"],
  NEW_COMPANY: ["name", "domain", "type", "industry"],
  NEW_INVESTOR: ["name", "domain", "website", "industry", "createDeal", "dealName"],
  FIELD_CHANGE: ["to", "note"],
  DOCUMENT_CHANGE: [],
};

/** Merge a reviewer's edit over the stored proposal (only editable fields) and validate. */
export function applyEdit<K extends ReviewKind>(kind: K, proposal: unknown, edited: Record<string, unknown>): ProposalFor<K> {
  const allowed = new Set(EDITABLE_FIELDS[kind]);
  const patch = Object.fromEntries(Object.entries(edited).filter(([k]) => allowed.has(k)));
  const base = proposal && typeof proposal === "object" ? (proposal as Record<string, unknown>) : {};
  // A new `to` invalidates the old human label.
  if (kind === "FIELD_CHANGE" && "to" in patch) patch.toLabel = null;
  return parseProposal(kind, { ...base, ...patch });
}
