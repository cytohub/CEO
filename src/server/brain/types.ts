import type { InboxType, InsightType, SourceCategory } from "@/generated/prisma/enums";
import type { Tx } from "@/lib/db";
import type { BrainThresholds } from "@/server/settings";
import type { PriorityWeights } from "./scoring";

/** Everything a pipeline stage needs: one transaction, one clock. */
export interface BrainContext {
  tx: Tx;
  now: Date;
  today: Date;
  timezone: string;
  ceoPersonId: string;
  refreshId: string;
  /** Completion time of the previous successful refresh (or 24h ago). */
  since: Date;
  thresholds: BrainThresholds;
  weights: PriorityWeights;
  log: (stage: string, message: string) => void;
}

export interface EntityLinks {
  personId?: string | null;
  companyId?: string | null;
  goalId?: string | null;
  milestoneId?: string | null;
  taskId?: string | null;
  decisionId?: string | null;
  dealId?: string | null;
}

/** What an analyzer proposes; persisted (deduplicated) as a BrainInsight. */
export interface InsightDraft extends EntityLinks {
  type: InsightType;
  fingerprint: string;
  title: string;
  summary?: string;
  importance: number; // 1–5
  requiresCeo?: boolean;
  recommendation?: string;
  signalId?: string;
  occurredAt?: Date;
  /** When set, the Brain also files a CEO Inbox item. */
  inbox?: {
    type: InboxType;
    whyCeo: string;
    recommendedAction: string;
    urgency: number;
    dueDate?: Date | null;
  };
}

// ─── Connectors ──────────────────────────────────────────────────────────────

export interface ConnectorDefinition {
  key: string;
  name: string;
  category: SourceCategory;
  description: string;
  /** Vendor / product family this connector targets. */
  provider: string;
  /** What the Brain extracts from this source. */
  extracts: string[];
}

export interface SyncResult {
  key: string;
  status: "ok" | "skipped" | "error";
  items: number;
  message?: string;
}

/**
 * A connector pulls new items from an external system and writes normalized
 * BrainSignal rows. Implementations live in ./connectors; each one is a no-op
 * until credentials are configured.
 */
export interface Connector extends ConnectorDefinition {
  isConfigured(): boolean;
  sync(ctx: BrainContext, sourceId: string): Promise<SyncResult>;
}

// ─── Daily brief ─────────────────────────────────────────────────────────────

export interface BriefItem {
  insightId?: string;
  /** True when first detected in this refresh; false for items still open from before. */
  isNew?: boolean;
  title: string;
  detail?: string;
  href?: string;
  importance: number;
}

export const BRIEF_SECTIONS = [
  { key: "decisionsNeeded", label: "Decisions needed" },
  { key: "risks", label: "New risks" },
  { key: "milestonesAtRisk", label: "Milestones at risk" },
  { key: "dealsProgressing", label: "Deals progressing" },
  { key: "dealsSlowing", label: "Deals slowing down" },
  { key: "opportunities", label: "New opportunities" },
  { key: "developments", label: "Important developments" },
  { key: "communications", label: "Important communications" },
  { key: "commitments", label: "New commitments" },
  { key: "milestonesReached", label: "Milestones reached" },
  { key: "deadlines", label: "Deadlines approaching" },
  { key: "followUps", label: "Follow-up required" },
  { key: "attention", label: "CEO attention" },
] as const;

export type BriefSectionKey = (typeof BRIEF_SECTIONS)[number]["key"];

export interface BriefSections {
  sections: Partial<Record<BriefSectionKey, BriefItem[]>>;
  stats: {
    newInsights: number;
    requiresCeo: number;
    signalsProcessed: number;
    tasksCreated: number;
    tasksUpdated: number;
    milestonesChanged: number;
    inboxCreated: number;
  };
  /** Ids of the Top 5 recommended at brief time. */
  topPriorityTaskIds: string[];
  since: string;
  /** "claude" when the narrative was synthesized by the LLM, else "rules". */
  narrativeEngine: "claude" | "rules";
}
