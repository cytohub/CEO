/**
 * Display metadata for domain enums: labels, tones and icons.
 * Client-safe (imports only enum types and icons).
 */
import {
  AlarmClock,
  AlertTriangle,
  Banknote,
  BookOpen,
  Brain,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Cpu,
  Database,
  FileSignature,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Gavel,
  GraduationCap,
  Handshake,
  HeartPulse,
  Landmark,
  Layers,
  Lightbulb,
  Link2,
  type LucideIcon,
  Mail,
  MessageSquare,
  Microscope,
  Milestone as MilestoneIcon,
  Package,
  Presentation,
  Rocket,
  Scale,
  Settings2,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import type {
  CompanyType,
  DecisionStatus,
  DelegationStatus,
  FocusArea,
  GoalStatus,
  GoalType,
  InboxType,
  InsightType,
  ItemSource,
  MeetingType,
  MetricCategory,
  MilestoneStatus,
  MilestoneType,
  PersonType,
  Priority,
  ResourceType,
  TaskStatus,
} from "@/generated/prisma/enums";

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "info" | "brain" | "done";

type Meta = { label: string; tone: Tone; icon?: LucideIcon; description?: string };

// ─── Focus areas (CEO attention) ─────────────────────────────────────────────

export const FOCUS_AREAS: Record<FocusArea, { label: string; icon: LucideIcon; strategic: boolean }> = {
  FUNDRAISING: { label: "Fundraising", icon: Landmark, strategic: true },
  REVENUE: { label: "Revenue / Sales", icon: TrendingUp, strategic: true },
  CUSTOMERS: { label: "Customers", icon: Handshake, strategic: true },
  PRODUCT: { label: "Product", icon: Package, strategic: true },
  CYTOHUB_AI: { label: "CytoHub.AI", icon: Cpu, strategic: true },
  SCIENCE: { label: "Science / R&D", icon: Microscope, strategic: true },
  PARTNERSHIPS: { label: "Partnerships", icon: Building2, strategic: true },
  TEAM: { label: "Team", icon: Users, strategic: false },
  FINANCE: { label: "Finance", icon: Banknote, strategic: false },
  OPERATIONS: { label: "Operations", icon: Settings2, strategic: false },
  LEGAL: { label: "Legal", icon: Scale, strategic: false },
  RECRUITING: { label: "Recruiting", icon: UserPlus, strategic: true },
  STRATEGY: { label: "Strategy", icon: Target, strategic: true },
  CEO_DEVELOPMENT: { label: "CEO development", icon: GraduationCap, strategic: true },
};

export const FOCUS_AREA_ORDER = Object.keys(FOCUS_AREAS) as FocusArea[];

// ─── Goals ───────────────────────────────────────────────────────────────────

export const GOAL_TYPES: Record<GoalType, { label: string; plural: string }> = {
  COMPANY: { label: "Company", plural: "Company goals" },
  ANNUAL: { label: "Annual", plural: "Annual goals" },
  QUARTERLY: { label: "Quarterly", plural: "Quarterly goals" },
  CEO: { label: "CEO", plural: "CEO goals" },
  DEPARTMENT: { label: "Department", plural: "Department goals" },
};

export const GOAL_STATUS: Record<GoalStatus, Meta> = {
  ON_TRACK: { label: "On track", tone: "good" },
  AT_RISK: { label: "At risk", tone: "warning" },
  OFF_TRACK: { label: "Off track", tone: "critical" },
  COMPLETED: { label: "Completed", tone: "done" },
  PAUSED: { label: "Paused", tone: "neutral" },
};

// ─── Milestones ──────────────────────────────────────────────────────────────

export const MILESTONE_STATUS: Record<MilestoneStatus, Meta> = {
  PLANNED: { label: "Planned", tone: "neutral" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  AT_RISK: { label: "At risk", tone: "warning" },
  BLOCKED: { label: "Blocked", tone: "critical" },
  COMPLETED: { label: "Completed", tone: "done" },
  MISSED: { label: "Missed", tone: "critical" },
};

export const MILESTONE_TYPES: Record<MilestoneType, { label: string; icon: LucideIcon }> = {
  ARR: { label: "ARR target", icon: TrendingUp },
  PHARMA_CONTRACT: { label: "Pharma contract", icon: FileSignature },
  FUNDRAISING: { label: "Fundraising", icon: Landmark },
  PRODUCT_RELEASE: { label: "Product release", icon: Rocket },
  AI_MODEL: { label: "AI model", icon: Cpu },
  SCIENTIFIC_VALIDATION: { label: "Scientific validation", icon: FlaskConical },
  PUBLICATION: { label: "Publication", icon: BookOpen },
  REGULATORY: { label: "Regulatory", icon: ShieldAlert },
  PARTNERSHIP: { label: "Partnership", icon: Handshake },
  HIRING: { label: "Hiring", icon: UserPlus },
  THERAPEUTIC: { label: "Therapeutic", icon: HeartPulse },
  OTHER: { label: "Other", icon: MilestoneIcon },
};

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const TASK_STATUS: Record<TaskStatus, Meta> = {
  TODO: { label: "To do", tone: "neutral" },
  IN_PROGRESS: { label: "In progress", tone: "info" },
  WAITING: { label: "Waiting", tone: "warning" },
  BLOCKED: { label: "Blocked", tone: "critical" },
  DONE: { label: "Done", tone: "done" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  SOMEDAY: { label: "Someday", tone: "neutral" },
};

export const OPEN_TASK_STATUSES: TaskStatus[] = ["TODO", "IN_PROGRESS", "WAITING", "BLOCKED"];

export const PRIORITY: Record<Priority, { label: string; short: string; tone: Tone }> = {
  P0: { label: "Critical", short: "P0", tone: "critical" },
  P1: { label: "High", short: "P1", tone: "serious" },
  P2: { label: "Medium", short: "P2", tone: "neutral" },
  P3: { label: "Low", short: "P3", tone: "neutral" },
};

export const SOURCES: Record<ItemSource, { label: string; icon: LucideIcon }> = {
  MANUAL: { label: "Manual", icon: ClipboardCheck },
  BRAIN: { label: "CytoHub Brain", icon: Brain },
  EMAIL: { label: "Email", icon: Mail },
  CALENDAR: { label: "Calendar", icon: CalendarClock },
  CRM: { label: "CRM", icon: Briefcase },
  MEETING: { label: "Meeting", icon: MessageSquare },
  DOCUMENT: { label: "Document", icon: FileText },
  DECISION: { label: "Decision", icon: Gavel },
  INBOX: { label: "Inbox", icon: Mail },
};

// ─── Decisions ───────────────────────────────────────────────────────────────

export const DECISION_STATUS: Record<DecisionStatus, Meta> = {
  NEEDED: { label: "Decision needed", tone: "warning" },
  WAITING_INFO: { label: "Waiting for info", tone: "neutral" },
  DECIDED: { label: "Decided", tone: "done" },
  DEFERRED: { label: "Deferred", tone: "neutral" },
};

// ─── Inbox & insights ────────────────────────────────────────────────────────

export const INBOX_TYPES: Record<InboxType, { label: string; icon: LucideIcon; tone: Tone }> = {
  APPROVAL: { label: "Approval needed", icon: ClipboardCheck, tone: "info" },
  DECISION: { label: "Decision needed", icon: Gavel, tone: "warning" },
  RESPONSE: { label: "Response needed", icon: Mail, tone: "info" },
  ESCALATION: { label: "Escalation", icon: AlertTriangle, tone: "critical" },
  CUSTOMER_ISSUE: { label: "Customer issue", icon: Handshake, tone: "serious" },
  INVESTOR_FOLLOW_UP: { label: "Investor follow-up", icon: Landmark, tone: "info" },
  DEADLINE_RISK: { label: "Deadline risk", icon: AlarmClock, tone: "critical" },
  HIRING_DECISION: { label: "Hiring decision", icon: UserPlus, tone: "info" },
  OPPORTUNITY: { label: "Strategic opportunity", icon: Lightbulb, tone: "good" },
};

export const INSIGHT_TYPES: Record<InsightType, { label: string; icon: LucideIcon; tone: Tone }> = {
  DEVELOPMENT: { label: "Development", icon: Sparkles, tone: "info" },
  OPPORTUNITY: { label: "Opportunity", icon: Lightbulb, tone: "good" },
  RISK: { label: "Risk", icon: ShieldAlert, tone: "critical" },
  DEAL_PROGRESS: { label: "Deal progressing", icon: TrendingUp, tone: "good" },
  DEAL_SLOWING: { label: "Deal slowing", icon: TrendingDown, tone: "warning" },
  COMMUNICATION: { label: "Communication", icon: MessageSquare, tone: "info" },
  MILESTONE_REACHED: { label: "Milestone reached", icon: CheckCircle2, tone: "good" },
  MILESTONE_AT_RISK: { label: "Milestone at risk", icon: AlertTriangle, tone: "warning" },
  DECISION_NEEDED: { label: "Decision needed", icon: Gavel, tone: "warning" },
  DEADLINE: { label: "Deadline", icon: AlarmClock, tone: "serious" },
  FOLLOW_UP: { label: "Follow-up", icon: Mail, tone: "info" },
  COMMITMENT: { label: "New commitment", icon: ClipboardCheck, tone: "info" },
  DELEGATION: { label: "Delegation", icon: Users, tone: "brain" },
  ATTENTION: { label: "CEO attention", icon: Target, tone: "brain" },
};

// ─── Resources, people, companies ────────────────────────────────────────────

export const RESOURCE_TYPES: Record<ResourceType, { label: string; icon: LucideIcon }> = {
  DOCUMENT: { label: "Document", icon: FileText },
  PRESENTATION: { label: "Presentation", icon: Presentation },
  CONTRACT: { label: "Contract", icon: FileSignature },
  FINANCIAL_MODEL: { label: "Financial model", icon: FileSpreadsheet },
  MEETING_NOTES: { label: "Meeting notes", icon: MessageSquare },
  SCIENTIFIC_PAPER: { label: "Scientific paper", icon: FlaskConical },
  DATASET: { label: "Dataset", icon: Database },
  LINK: { label: "Link", icon: Link2 },
  INTELLIGENCE: { label: "Company intelligence", icon: Brain },
  OTHER: { label: "Other", icon: Layers },
};

export const PERSON_TYPES: Record<PersonType, { label: string }> = {
  TEAM: { label: "Team" },
  INVESTOR: { label: "Investor" },
  CUSTOMER: { label: "Customer" },
  PARTNER: { label: "Partner" },
  ADVISOR: { label: "Advisor" },
  BOARD: { label: "Board" },
  CANDIDATE: { label: "Candidate" },
  OTHER: { label: "Other" },
};

export const COMPANY_TYPES: Record<CompanyType, { label: string; icon: LucideIcon }> = {
  CUSTOMER: { label: "Customer", icon: Handshake },
  PROSPECT: { label: "Prospect", icon: Target },
  INVESTOR: { label: "Investor", icon: Landmark },
  PARTNER: { label: "Partner", icon: Building2 },
  ACADEMIC: { label: "Academic", icon: GraduationCap },
  VENDOR: { label: "Vendor", icon: Package },
  COMPETITOR: { label: "Competitor", icon: Scale },
  OTHER: { label: "Other", icon: Building2 },
};

export const MEETING_TYPES: Record<MeetingType, { label: string }> = {
  INVESTOR: { label: "Investor" },
  CUSTOMER: { label: "Customer" },
  BOARD: { label: "Board" },
  PARTNER: { label: "Partner" },
  INTERNAL: { label: "Internal" },
  ONE_ON_ONE: { label: "1:1" },
  CANDIDATE: { label: "Candidate" },
  EXTERNAL: { label: "External" },
};

export const METRIC_CATEGORIES: Record<MetricCategory, { label: string; icon: LucideIcon }> = {
  REVENUE: { label: "Revenue", icon: CircleDollarSign },
  ARR: { label: "ARR", icon: TrendingUp },
  PIPELINE: { label: "Pipeline", icon: Briefcase },
  CUSTOMERS: { label: "Customers", icon: Handshake },
  FUNDRAISING: { label: "Fundraising", icon: Landmark },
  CASH: { label: "Cash / Runway", icon: Banknote },
  PRODUCT: { label: "Product", icon: Package },
  AI: { label: "AI", icon: Cpu },
  SCIENCE: { label: "Science", icon: Microscope },
  THERAPEUTICS: { label: "Therapeutics", icon: HeartPulse },
  PARTNERSHIPS: { label: "Partnerships", icon: Building2 },
  TEAM: { label: "Team", icon: Users },
};

export const METRIC_CATEGORY_ORDER = Object.keys(METRIC_CATEGORIES) as MetricCategory[];

export const DELEGATION_STATUS: Record<DelegationStatus, Meta> = {
  ACTIVE: { label: "Active", tone: "info" },
  NEEDS_FOLLOW_UP: { label: "Needs follow-up", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "done" },
  RECALLED: { label: "Recalled", tone: "neutral" },
};

// ─── Pillar palette ──────────────────────────────────────────────────────────
// Pillars carry identity color from the validated categorical palette, in a
// fixed order. Identity is never color-alone: the pillar name always renders.

export const PILLAR_COLORS = ["blue", "orange", "aqua", "yellow", "magenta", "green", "violet", "red"] as const;
export type PillarColor = (typeof PILLAR_COLORS)[number];

export const PILLAR_HEX: Record<PillarColor, { light: string; dark: string }> = {
  blue: { light: "#2a78d6", dark: "#3987e5" },
  orange: { light: "#eb6834", dark: "#d95926" },
  aqua: { light: "#1baf7a", dark: "#199e70" },
  yellow: { light: "#eda100", dark: "#c98500" },
  magenta: { light: "#e87ba4", dark: "#d55181" },
  green: { light: "#008300", dark: "#008300" },
  violet: { light: "#4a3aa7", dark: "#9085e9" },
  red: { light: "#e34948", dark: "#e66767" },
};

export function pillarColorVar(color: string | null | undefined): string {
  const c = (PILLAR_COLORS as readonly string[]).includes(color ?? "") ? color : "blue";
  return `var(--cat-${c})`;
}
