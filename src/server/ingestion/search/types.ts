/**
 * Universal search contracts: the query plan the natural-language planner
 * produces, the grouped results the executor returns and the answer
 * synthesized from them. Client-safe (types and constants only).
 */
import type { CeoCategory, CommitmentDirection, CompanyType, UserRole } from "@/generated/prisma/enums";
import type { Capability } from "@/server/security/rbac";

/** Source content (filtered by access scope) */
export const SOURCE_RESULT_TYPES = ["thread", "document", "event", "notes", "source"] as const;
/** Structured workspace records (need workspace.view; insights need brain.view) */
export const STRUCTURED_RESULT_TYPES = [
  "commitment",
  "task",
  "meeting",
  "decision",
  "milestone",
  "goal",
  "deal",
  "risk",
  "opportunity",
  "company",
  "person",
  "project",
  "resource",
  "note",
  "insight",
] as const;

export type SourceResultType = (typeof SOURCE_RESULT_TYPES)[number];
export type StructuredResultType = (typeof STRUCTURED_RESULT_TYPES)[number];
export type SearchResultType = SourceResultType | StructuredResultType;
export const RESULT_TYPES: readonly SearchResultType[] = [...SOURCE_RESULT_TYPES, ...STRUCTURED_RESULT_TYPES];

export function isSourceType(t: SearchResultType): t is SourceResultType {
  return (SOURCE_RESULT_TYPES as readonly string[]).includes(t);
}

export type SearchIntent =
  /** "What have we discussed with X?" — conversation history with an entity. */
  | "discussed"
  /** "Show everything related to X" — every linked record. */
  | "related"
  /** "What commitments have I made to investors?" / "What did we promise Karen?" */
  | "commitments"
  /** "What is happening with the Series B?" — status of a goal / deal / project. */
  | "status"
  /** "What deadlines do we have next week?" */
  | "deadlines"
  /** "Which customers are waiting on CytoHub?" */
  | "waiting"
  /** "Show investor conversations from the last 30 days" */
  | "conversations"
  /** "Open risks", "documents about pricing" — explicit record types. */
  | "list"
  /** Plain keyword search. */
  | "keyword";

export type EntityKind = "company" | "person" | "goal" | "deal" | "project";

export interface PlanEntity {
  kind: EntityKind;
  id: string;
  label: string;
  /** The words in the query that matched. */
  matched: string;
  /** 0–1 */
  confidence: number;
  /** Company: include parent + subsidiaries. */
  family?: boolean;
}

export interface PlanTimeRange {
  /** Inclusive calendar days (YYYY-MM-DD) in the CEO timezone; null = open-ended. */
  from: string | null;
  to: string | null;
  label: string;
}

export interface QueryPlan {
  query: string;
  intent: SearchIntent;
  /** Residual free-text for full-text search (entity names, time and intent phrases removed). */
  text: string;
  terms: string[];
  entities: PlanEntity[];
  /** Topic phrase matched against goal / deal / project names ("series b"). */
  topic: string | null;
  recordTypes: SearchResultType[];
  direction: Extract<CommitmentDirection, "OUTBOUND" | "INBOUND"> | null;
  companyTypes: CompanyType[];
  categories: CeoCategory[];
  timeRange: PlanTimeRange | null;
  /** Which date a time range constrains. */
  timeField: "due" | "occurred";
  openOnly: boolean;
  sort: "relevance" | "newest" | "due" | "open_first";
  /** 0–1: how sure the planner is that it understood the question. */
  confidence: number;
  engine: "rules" | "claude";
  /** Human-readable interpretation chips ("Investors", "Outbound", "Last 30 days"). */
  explanation: string[];
}

export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle?: string;
  /** Plain text split into highlighted / plain parts (never HTML). */
  snippet?: SnippetPart[];
  href: string;
  /** ISO instant or calendar day. */
  timestamp?: string;
  /** Higher ranks first within a group. */
  rank: number;
  /** Short status labels: "Overdue", "Awaiting your reply"… */
  badges?: string[];
  /** Company the result belongs to (used by answer templates to group). */
  companyId?: string | null;
  companyName?: string | null;
  meta?: Record<string, string | number | boolean | null>;
}

export interface SearchGroup {
  type: SearchResultType;
  label: string;
  results: SearchResult[];
  /** True when more matched than were returned. */
  truncated: boolean;
}

export interface Citation {
  type: string;
  id: string;
  label: string;
  href: string;
}

export interface SearchAnswer {
  text: string;
  engine: "rules" | "claude";
  citations: Citation[];
}

export interface SearchResponse {
  plan: QueryPlan;
  answer: SearchAnswer;
  groups: SearchGroup[];
  total: number;
  /** Some matching source content exists that the viewer cannot read. */
  hiddenByAccess: boolean;
  /** Structured workspace records were excluded for this viewer's role. */
  structuredExcluded: boolean;
  /** One-sentence explanation of what the viewer's access level left out ("" when nothing). */
  accessNote: string;
  /** Extra facts the answer drew on (goal progress, pipeline). */
  context?: StatusContext;
  durationMs: number;
}

export interface StatusContext {
  goals: { id: string; title: string; progress: number; status: string; confidence: number; targetDate: string | null }[];
  pipeline: { open: number; totalValue: number; stages: { stage: string; count: number }[] } | null;
}

/** Who is searching. Capabilities decide which record types are reachable. */
export interface SearchViewer {
  userId: string;
  role: UserRole;
  personId: string | null;
  capabilities: readonly Capability[];
}

export interface SearchOptions {
  /** Restrict to these result types (UI filter). */
  types?: SearchResultType[];
  /** Override the plan's time range with a preset ("7d", "30d", "90d", "next7d", "next30d"). */
  when?: TimePreset | null;
  limitPerType?: number;
  /** Ask Claude to synthesize the answer (when configured). */
  synthesize?: boolean;
  /** Let Claude plan when the rules planner is unsure (when configured). */
  claudePlanner?: boolean;
  /** Clock override (tests / scripts). */
  now?: Date;
}

export const TIME_PRESETS = ["7d", "30d", "90d", "next7d", "next30d"] as const;
export type TimePreset = (typeof TIME_PRESETS)[number];

export const RESULT_LABELS: Record<SearchResultType, { label: string; plural: string }> = {
  thread: { label: "Email thread", plural: "Email threads" },
  document: { label: "Document", plural: "Documents" },
  event: { label: "Calendar event", plural: "Calendar events" },
  notes: { label: "Meeting notes", plural: "Meeting notes" },
  source: { label: "Source", plural: "Other sources" },
  commitment: { label: "Commitment", plural: "Commitments" },
  task: { label: "Task", plural: "Tasks" },
  meeting: { label: "Meeting", plural: "Meetings" },
  decision: { label: "Decision", plural: "Decisions" },
  milestone: { label: "Milestone", plural: "Milestones" },
  goal: { label: "Goal", plural: "Goals" },
  deal: { label: "Deal", plural: "Deals" },
  risk: { label: "Risk", plural: "Risks" },
  opportunity: { label: "Opportunity", plural: "Opportunities" },
  company: { label: "Company", plural: "Companies" },
  person: { label: "Person", plural: "People" },
  project: { label: "Project", plural: "Projects" },
  resource: { label: "Resource", plural: "Resources" },
  note: { label: "Note", plural: "Notes" },
  insight: { label: "Insight", plural: "Brain insights" },
};
