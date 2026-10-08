/**
 * Display vocabulary for the ingestion & intelligence layer. Client-safe:
 * only enum *types* are imported from Prisma.
 */
import type {
  AttentionLevel,
  CeoCategory,
  CommitmentDirection,
  CommitmentStatus,
  Confidence,
  ConnectionMode,
  ConnectionStatus,
  DocumentFormat,
  DocumentType,
  JobStatus,
  JobType,
  MeetingCategory,
  OpportunityKind,
  OpportunityStatus,
  ReviewKind,
  ReviewStatus,
  Relevance,
  RiskStatus,
  Sensitivity,
  SourceItemKind,
  SourceKind,
  SourceProvider,
  SyncFrequency,
  ThreadStatus,
  UserRole,
} from "@/generated/prisma/enums";
import type { Tone } from "./domain";

type Meta = { label: string; tone: Tone; description?: string };

export const RELEVANCE: Record<Relevance, Meta & { rank: number }> = {
  CRITICAL: { label: "Critical", tone: "critical", rank: 5 },
  HIGH: { label: "High", tone: "serious", rank: 4 },
  NORMAL: { label: "Normal", tone: "info", rank: 3 },
  LOW: { label: "Low", tone: "neutral", rank: 2 },
  NOISE: { label: "Noise", tone: "neutral", rank: 1 },
};

export const CEO_CATEGORIES: Record<CeoCategory, { label: string; noise?: boolean }> = {
  INVESTOR: { label: "Investor" },
  CUSTOMER: { label: "Customer" },
  STRATEGIC_PARTNER: { label: "Strategic partner" },
  BOARD: { label: "Board" },
  LEGAL: { label: "Legal" },
  FINANCE: { label: "Finance" },
  RECRUITING: { label: "Recruiting" },
  EXECUTIVE_TEAM: { label: "Executive team" },
  SCIENTIFIC_LEADERSHIP: { label: "Scientific leadership" },
  MAJOR_VENDOR: { label: "Major vendor" },
  FUNDRAISING: { label: "Fundraising" },
  COMMERCIAL_OPPORTUNITY: { label: "Commercial opportunity" },
  INTERNAL_ESCALATION: { label: "Internal escalation" },
  OPERATIONS: { label: "Operations" },
  PERSONAL: { label: "Personal" },
  NEWSLETTER: { label: "Newsletter", noise: true },
  MARKETING: { label: "Marketing", noise: true },
  NOTIFICATION: { label: "Notification", noise: true },
  SPAM: { label: "Spam", noise: true },
  OTHER: { label: "Other" },
};

export const ATTENTION_LEVELS: Record<AttentionLevel, Meta & { rank: number }> = {
  IMMEDIATE: { label: "Immediate", tone: "critical", rank: 6, description: "Needs the CEO now." },
  TODAY: { label: "Today", tone: "serious", rank: 5, description: "Handle before the end of the day." },
  THIS_WEEK: { label: "This week", tone: "warning", rank: 4, description: "Plan it into the week." },
  MONITOR: { label: "Monitor", tone: "info", rank: 3, description: "Keep an eye on it; no action yet." },
  DELEGATE: { label: "Delegate", tone: "brain", rank: 2, description: "Someone else should own it." },
  ARCHIVE: { label: "Archive", tone: "neutral", rank: 1, description: "Kept for history only." },
};

export const CONFIDENCE: Record<Confidence, Meta> = {
  HIGH: { label: "High confidence", tone: "good" },
  MEDIUM: { label: "Medium confidence", tone: "warning" },
  LOW: { label: "Low confidence", tone: "neutral" },
};

/** Bucket a 0–1 score. Keep in sync with docs/ingestion/ARCHITECTURE.md §6. */
export function confidenceFromScore(score: number): Confidence {
  if (score >= 0.8) return "HIGH";
  if (score >= 0.55) return "MEDIUM";
  return "LOW";
}

export const COMMITMENT_DIRECTION: Record<CommitmentDirection, { label: string; short: string; description: string }> = {
  OUTBOUND: { label: "We owe", short: "Owed by us", description: "CytoHub or the CEO promised this to someone." },
  INBOUND: { label: "Owed to us", short: "Owed to us", description: "Someone promised this to CytoHub." },
  INTERNAL: { label: "Internal", short: "Internal", description: "A commitment inside the team." },
};

export const COMMITMENT_STATUS: Record<CommitmentStatus, Meta> = {
  OPEN: { label: "Open", tone: "info" },
  FULFILLED: { label: "Fulfilled", tone: "done" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  SUPERSEDED: { label: "Superseded", tone: "neutral" },
};

export const RISK_STATUS: Record<RiskStatus, Meta> = {
  OPEN: { label: "Open", tone: "critical" },
  MONITORING: { label: "Monitoring", tone: "warning" },
  MITIGATED: { label: "Mitigated", tone: "good" },
  RESOLVED: { label: "Resolved", tone: "done" },
  ACCEPTED: { label: "Accepted", tone: "neutral" },
};

export const OPPORTUNITY_KIND: Record<OpportunityKind, { label: string }> = {
  COMMERCIAL: { label: "Commercial" },
  FUNDRAISING: { label: "Fundraising" },
  PARTNERSHIP: { label: "Partnership" },
  SCIENTIFIC: { label: "Scientific" },
  EXPANSION: { label: "Expansion" },
  HIRING: { label: "Hiring" },
  OTHER: { label: "Other" },
};

export const OPPORTUNITY_STATUS: Record<OpportunityStatus, Meta> = {
  OPEN: { label: "Open", tone: "info" },
  PURSUING: { label: "Pursuing", tone: "good" },
  WON: { label: "Won", tone: "done" },
  LOST: { label: "Lost", tone: "neutral" },
  DISMISSED: { label: "Dismissed", tone: "neutral" },
};

export const DOCUMENT_TYPES: Record<DocumentType, { label: string }> = {
  INVESTOR_DECK: { label: "Investor deck" },
  FINANCIAL_MODEL: { label: "Financial model" },
  CUSTOMER_PROPOSAL: { label: "Customer proposal" },
  CUSTOMER_CONTRACT: { label: "Customer contract" },
  NDA: { label: "NDA" },
  STRATEGIC_PLAN: { label: "Strategic plan" },
  SCIENTIFIC_REPORT: { label: "Scientific report" },
  EXPERIMENT_REPORT: { label: "Experiment report" },
  PUBLICATION: { label: "Publication" },
  REGULATORY_DOCUMENT: { label: "Regulatory document" },
  PRODUCT_SPECIFICATION: { label: "Product specification" },
  MEETING_NOTES: { label: "Meeting notes" },
  BOARD_DOCUMENT: { label: "Board document" },
  FUNDRAISING_MATERIAL: { label: "Fundraising material" },
  SALES_MATERIAL: { label: "Sales material" },
  EMPLOYEE_DOCUMENT: { label: "Employee document" },
  LEGAL_DOCUMENT: { label: "Legal document" },
  PARTNERSHIP_AGREEMENT: { label: "Partnership agreement" },
  SCIENTIFIC_DATA_SUMMARY: { label: "Scientific data summary" },
  INTERNAL_MEMO: { label: "Internal memo" },
  OTHER: { label: "Other" },
};

export const DOCUMENT_FORMATS: Record<DocumentFormat, { label: string; extensions: string[] }> = {
  PDF: { label: "PDF", extensions: ["pdf"] },
  DOCX: { label: "Word", extensions: ["docx"] },
  PPTX: { label: "PowerPoint", extensions: ["pptx"] },
  XLSX: { label: "Excel", extensions: ["xlsx"] },
  CSV: { label: "CSV", extensions: ["csv"] },
  TXT: { label: "Text", extensions: ["txt"] },
  MARKDOWN: { label: "Markdown", extensions: ["md", "markdown"] },
  HTML: { label: "HTML", extensions: ["html", "htm"] },
  IMAGE: { label: "Image", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
  OTHER: { label: "Other", extensions: [] },
};

export const MEETING_CATEGORIES: Record<MeetingCategory, { label: string; important: boolean }> = {
  INVESTOR: { label: "Investor", important: true },
  CUSTOMER: { label: "Customer", important: true },
  BOARD: { label: "Board", important: true },
  INTERNAL_LEADERSHIP: { label: "Internal leadership", important: false },
  SCIENTIFIC: { label: "Scientific", important: false },
  PARTNER: { label: "Partner", important: true },
  RECRUITING: { label: "Recruiting", important: false },
  LEGAL: { label: "Legal", important: true },
  FINANCE: { label: "Finance", important: false },
  PRODUCT: { label: "Product", important: false },
  SALES: { label: "Sales", important: true },
  FUNDRAISING: { label: "Fundraising", important: true },
  NETWORKING: { label: "Networking", important: false },
  PERSONAL: { label: "Personal", important: false },
  OTHER: { label: "Other", important: false },
};

export const SOURCE_KINDS: Record<SourceKind, { label: string; description: string }> = {
  EMAIL: { label: "Email & chat", description: "Messages, Teams chats, threads, commitments and follow-ups." },
  CALENDAR: { label: "Calendar", description: "Meetings, attendees, reschedules and preparation." },
  DOCUMENTS: { label: "Documents", description: "Decks, models, contracts, reports and their versions." },
  MEETINGS: { label: "Meeting notes", description: "Notes and transcripts become decisions, action items and commitments." },
  CRM: { label: "CRM", description: "Deals, pipeline stages and companies for the scoreboard and deal alerts." },
  FINANCE: { label: "Finance", description: "Revenue, expenses, cash and burn for the scoreboard and runway." },
  CONTRACTS: { label: "Contracts", description: "Agreements sent, signed, declined or waiting on you." },
};

/** OAuth apps the server can be configured with (client id + secret in the environment). */
export type OAuthVendor = "google" | "microsoft" | "dropbox" | "intuit" | "docusign";

/**
 * How a provider is connected:
 * - oauth    sign in with the vendor (the server holds the app's client id and secret)
 * - apiKey   paste a read-only key created in the vendor's admin (stored encrypted)
 * - webhook  the vendor posts signed events to this server (signing key stored encrypted)
 * - none     uploads and in-app content
 */
export type ProviderAuth = "oauth" | "apiKey" | "webhook" | "none";

export interface ProviderMeta {
  label: string;
  vendor: string;
  kind: SourceKind;
  auth: ProviderAuth;
  oauth: OAuthVendor | null;
}

export const SOURCE_PROVIDERS: Record<SourceProvider, ProviderMeta> = {
  GMAIL: { label: "Gmail", vendor: "Google", kind: "EMAIL", auth: "oauth", oauth: "google" },
  OUTLOOK_MAIL: { label: "Outlook Mail", vendor: "Microsoft 365", kind: "EMAIL", auth: "oauth", oauth: "microsoft" },
  TEAMS_CHAT: { label: "Teams chats", vendor: "Microsoft 365", kind: "EMAIL", auth: "oauth", oauth: "microsoft" },
  GOOGLE_CALENDAR: { label: "Google Calendar", vendor: "Google", kind: "CALENDAR", auth: "oauth", oauth: "google" },
  OUTLOOK_CALENDAR: { label: "Outlook Calendar", vendor: "Microsoft 365", kind: "CALENDAR", auth: "oauth", oauth: "microsoft" },
  GOOGLE_DRIVE: { label: "Google Drive", vendor: "Google", kind: "DOCUMENTS", auth: "oauth", oauth: "google" },
  ONEDRIVE: { label: "OneDrive", vendor: "Microsoft 365", kind: "DOCUMENTS", auth: "oauth", oauth: "microsoft" },
  SHAREPOINT: { label: "SharePoint", vendor: "Microsoft 365", kind: "DOCUMENTS", auth: "oauth", oauth: "microsoft" },
  DROPBOX: { label: "Dropbox", vendor: "Dropbox", kind: "DOCUMENTS", auth: "oauth", oauth: "dropbox" },
  LOCAL_UPLOAD: { label: "Uploads", vendor: "CytoHub", kind: "DOCUMENTS", auth: "none", oauth: null },
  CYTOHUB_INTERNAL: { label: "CytoHub workspace", vendor: "CytoHub", kind: "DOCUMENTS", auth: "none", oauth: null },
  GRANOLA: { label: "Granola", vendor: "Granola", kind: "MEETINGS", auth: "apiKey", oauth: null },
  READ_AI: { label: "Read AI", vendor: "Read AI", kind: "MEETINGS", auth: "webhook", oauth: null },
  HUBSPOT: { label: "HubSpot", vendor: "HubSpot", kind: "CRM", auth: "apiKey", oauth: null },
  QUICKBOOKS: { label: "QuickBooks Online", vendor: "Intuit", kind: "FINANCE", auth: "oauth", oauth: "intuit" },
  BREX: { label: "Brex", vendor: "Brex", kind: "FINANCE", auth: "apiKey", oauth: null },
  DOCUSIGN: { label: "DocuSign", vendor: "DocuSign", kind: "CONTRACTS", auth: "oauth", oauth: "docusign" },
};

/** Kinds whose items run through the AI ingestion pipeline (source items → extraction → Brain). */
export const PIPELINE_KINDS: SourceKind[] = ["EMAIL", "CALENDAR", "DOCUMENTS", "MEETINGS"];

export const CONNECTION_MODE: Record<ConnectionMode, { label: string }> = {
  LIVE: { label: "Live" },
  DEMO: { label: "Demo data" },
};

export const CONNECTION_STATUS: Record<ConnectionStatus, Meta> = {
  CONNECTED: { label: "Connected", tone: "good" },
  SYNCING: { label: "Syncing", tone: "info" },
  ERROR: { label: "Error", tone: "critical" },
  NEEDS_REAUTH: { label: "Reconnect needed", tone: "serious" },
  PAUSED: { label: "Paused", tone: "neutral" },
  DISCONNECTED: { label: "Disconnected", tone: "neutral" },
};

export const SYNC_FREQUENCY: Record<SyncFrequency, { label: string; description: string; minutes: number | null }> = {
  MANUAL: { label: "Manual", description: "Only when you run a sync.", minutes: null },
  HOURLY: { label: "Hourly", description: "Incremental sync every hour.", minutes: 60 },
  DAILY: { label: "Daily", description: "Once a day, before the Daily Brain Refresh.", minutes: 24 * 60 },
  REALTIME: { label: "Near real-time", description: "Provider webhooks, with an hourly safety sync.", minutes: 60 },
};

export const SOURCE_ITEM_KINDS: Record<SourceItemKind, { label: string }> = {
  EMAIL_MESSAGE: { label: "Email" },
  CALENDAR_EVENT: { label: "Calendar event" },
  DOCUMENT: { label: "Document" },
  MEETING_NOTES: { label: "Meeting notes" },
};

export const THREAD_STATUS: Record<ThreadStatus, Meta> = {
  AWAITING_CEO: { label: "Awaiting your reply", tone: "serious" },
  AWAITING_THEM: { label: "Waiting on them", tone: "warning" },
  ACTIVE: { label: "Active", tone: "info" },
  FYI: { label: "FYI", tone: "neutral" },
  RESOLVED: { label: "Resolved", tone: "done" },
};

export const REVIEW_KINDS: Record<ReviewKind, { label: string; description: string }> = {
  TASK: { label: "Possible task", description: "A request or action item the Brain is not sure about." },
  COMMITMENT: { label: "Possible commitment", description: "Something promised, by you or to you." },
  DEADLINE: { label: "Possible deadline", description: "A date the Brain wants to attach to work." },
  DECISION: { label: "Possible decision", description: "A decision that appears to have been made or requested." },
  RISK: { label: "Potential risk", description: "Something that could hurt a goal, deal or relationship." },
  OPPORTUNITY: { label: "Potential opportunity", description: "A possible upside worth pursuing." },
  MEETING: { label: "Meeting", description: "A meeting the Brain wants to add or change." },
  ENTITY_MERGE: { label: "Possible duplicate", description: "Two records that may be the same person or company." },
  NEW_PERSON: { label: "New person", description: "Someone not yet in CytoHub Brain." },
  NEW_COMPANY: { label: "New company", description: "An organization not yet in CytoHub Brain." },
  NEW_INVESTOR: { label: "Possible investor", description: "An organization that looks like a new investor." },
  FIELD_CHANGE: { label: "Proposed change", description: "A change to existing work: a date, owner, value or status." },
  DOCUMENT_CHANGE: { label: "Document change", description: "A significant change between document versions." },
};

export const REVIEW_STATUS: Record<ReviewStatus, Meta> = {
  PENDING: { label: "Pending", tone: "warning" },
  APPROVED: { label: "Approved", tone: "good" },
  REJECTED: { label: "Rejected", tone: "neutral" },
  MERGED: { label: "Merged", tone: "good" },
  IGNORED: { label: "Ignored", tone: "neutral" },
};

export const JOB_TYPES: Record<JobType, { label: string }> = {
  EMAIL_SYNC: { label: "Email sync" },
  CALENDAR_SYNC: { label: "Calendar sync" },
  DOCUMENT_SYNC: { label: "Document sync" },
  MEETINGS_SYNC: { label: "Meeting notes sync" },
  BUSINESS_SYNC: { label: "Business system sync" },
  DOCUMENT_PARSE: { label: "Document parsing" },
  ENTITY_EXTRACTION: { label: "Entity extraction" },
  ENTITY_RESOLUTION: { label: "Entity resolution" },
  RELATIONSHIP_MAPPING: { label: "Relationship mapping" },
  INTELLIGENCE_EXTRACTION: { label: "Intelligence extraction" },
  BRAIN_WRITE: { label: "Brain write" },
  THREAD_SUMMARY: { label: "Thread summary" },
  PRIORITY_RECALC: { label: "Priority recalculation" },
  DAILY_BRAIN_REFRESH: { label: "Daily Brain Refresh" },
  RETENTION_SWEEP: { label: "Retention sweep" },
};

export const JOB_STATUS: Record<JobStatus, Meta> = {
  QUEUED: { label: "Queued", tone: "neutral" },
  RUNNING: { label: "Running", tone: "info" },
  SUCCEEDED: { label: "Succeeded", tone: "good" },
  FAILED: { label: "Retrying", tone: "warning" },
  DEAD: { label: "Failed", tone: "critical" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const SENSITIVITY: Record<Sensitivity, Meta & { rank: number }> = {
  INTERNAL: { label: "Internal", tone: "neutral", rank: 1, description: "Anyone on the team." },
  CONFIDENTIAL: { label: "Confidential", tone: "warning", rank: 2, description: "Executives and above." },
  RESTRICTED: { label: "Restricted", tone: "critical", rank: 3, description: "CEO and explicitly granted people." },
};

export const USER_ROLES: Record<UserRole, { label: string; description: string }> = {
  CEO: { label: "CEO", description: "Everything, including restricted sources and private performance." },
  EXECUTIVE: { label: "Executive", description: "Company execution and confidential sources; no CEO-private views." },
  TEAM_MEMBER: { label: "Team member", description: "Internal sources and anything explicitly shared." },
  ADMIN: { label: "Admin", description: "Integrations, users, retention and audit; no confidential content." },
  ADVISOR: { label: "Advisor", description: "Only what is explicitly shared." },
};
