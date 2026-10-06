/**
 * Contracts for the CytoHub Brain ingestion pipeline.
 *
 *   Provider adapter ──(Normalized*)──► raw.ts ──► SourceItem
 *   SourceItem ──► mentions + classification ──► resolution ──► relationships
 *              ──► IntelligenceExtraction (validated) ──► writer ──► Brain
 *
 * Every stage takes a PipelineContext and a source item id, reads what the
 * previous stage persisted, and persists its own output. Stages never call
 * each other directly — the job queue sequences them (see pipeline.ts).
 */
import type { Prisma } from "@/generated/prisma/client";
import type {
  CeoCategory,
  CompanyType,
  ConnectionMode,
  DocumentFormat,
  DocumentType,
  EntityType,
  EventStatus,
  MeetingCategory,
  MentionResolution,
  MentionRole,
  MessageDirection,
  ProjectKind,
  Relevance,
  ResponseStatus,
  RunTrigger,
  Sensitivity,
  SourceItemKind,
  SourceProvider,
} from "@/generated/prisma/enums";
import type { Db } from "@/lib/db";

// ─── Provider-normalized items ───────────────────────────────────────────────

export interface Participant {
  name: string | null;
  /** Lower-cased email address. */
  email: string;
}

export interface NormalizedAttachment {
  externalId?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Lazily download the bytes (only when retention allows storing them). */
  fetch?: () => Promise<Buffer>;
}

export interface NormalizedEmail {
  /** Provider message id (unique within the connection). */
  externalId: string;
  /** Provider thread / conversation id. */
  threadExternalId: string;
  /** RFC 5322 Message-ID, used to detect the same message across providers. */
  internetMessageId?: string | null;
  inReplyTo?: string | null;
  from: Participant;
  to: Participant[];
  cc: Participant[];
  bcc?: Participant[];
  replyTo?: Participant | null;
  subject: string;
  sentAt: Date;
  /** Full plain-text body (HTML already converted). Quoted history is stripped later. */
  bodyText: string;
  labels: string[];
  folder?: string | null;
  isRead?: boolean | null;
  /** Selected headers, lower-cased keys: list-unsubscribe, precedence, auto-submitted, x-auto-response-suppress… */
  headers?: Record<string, string>;
  attachments: NormalizedAttachment[];
  webUrl?: string | null;
  /** Original provider payload; stored encrypted and retention-managed. */
  raw?: unknown;
}

export interface NormalizedAttendee extends Participant {
  responseStatus: ResponseStatus;
  optional?: boolean;
}

export interface NormalizedCalendarEvent {
  externalId: string;
  iCalUid?: string | null;
  seriesId?: string | null;
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  timezone?: string | null;
  location?: string | null;
  conferenceUrl?: string | null;
  organizer?: Participant | null;
  attendees: NormalizedAttendee[];
  isRecurring: boolean;
  recurrence?: string | null;
  status: EventStatus;
  /** The connected account's own response. */
  ceoResponse?: ResponseStatus | null;
  updatedAt?: Date | null;
  webUrl?: string | null;
  attachments?: { title: string; url?: string | null; mimeType?: string | null }[];
  raw?: unknown;
}

export interface NormalizedDocumentRef {
  externalId: string;
  title: string;
  mimeType: string;
  sizeBytes?: number | null;
  createdAt?: Date | null;
  modifiedAt: Date;
  author?: string | null;
  path?: string | null;
  webUrl?: string | null;
  /** Provider version tag / etag / revision id: a cheap "did it change?" check before download. */
  versionTag?: string | null;
  download: () => Promise<Buffer>;
  raw?: unknown;
}

// ─── Provider adapters ───────────────────────────────────────────────────────

/** Provider-specific cursor (historyId, syncToken, deltaLink, pageToken, modifiedSince…). JSON-serializable. */
export type SyncCursor = Record<string, unknown>;

export interface ChangeSet<T> {
  items: T[];
  /** Items removed upstream (handled per retention policy). */
  deletedExternalIds: string[];
  /** Cursor to persist after this page is stored. */
  cursor: SyncCursor;
  /** More pages are available right now with `cursor`. */
  hasMore: boolean;
}

export interface ProviderConnection {
  id: string;
  provider: SourceProvider;
  mode: ConnectionMode;
  accountEmail: string | null;
  settings: Record<string, unknown>;
}

export interface ProviderContext {
  connection: ProviderConnection;
  now: Date;
  /** Valid OAuth access token (refreshed + re-encrypted as needed). LIVE connections only. */
  getAccessToken(): Promise<string>;
  log(message: string): void;
  signal?: AbortSignal;
}

export interface EmailProvider {
  kind: "EMAIL";
  listChanges(ctx: ProviderContext, cursor: SyncCursor | null, opts: { pageSize: number; initialSince: Date }): Promise<ChangeSet<NormalizedEmail>>;
}

export interface CalendarProvider {
  kind: "CALENDAR";
  listChanges(
    ctx: ProviderContext,
    cursor: SyncCursor | null,
    opts: { pageSize: number; windowStart: Date; windowEnd: Date },
  ): Promise<ChangeSet<NormalizedCalendarEvent>>;
}

export interface DocumentProvider {
  kind: "DOCUMENTS";
  listChanges(ctx: ProviderContext, cursor: SyncCursor | null, opts: { pageSize: number }): Promise<ChangeSet<NormalizedDocumentRef>>;
}

export type SourceProviderAdapter = EmailProvider | CalendarProvider | DocumentProvider;

/** Optional push support (Gmail/Graph/Drive). */
export interface WebhookSubscriber {
  subscribe(ctx: ProviderContext, opts: { callbackUrl: string; secret: string }): Promise<{ channelId: string; expiresAt: Date }>;
  unsubscribe(ctx: ProviderContext, channelId: string): Promise<void>;
}

/** Thrown by adapters when the grant is revoked/expired: the connection becomes NEEDS_REAUTH and retries stop. */
export class ProviderAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderAuthError";
  }
}

/** Thrown when the stored cursor is no longer valid (e.g. Gmail 404 historyId, Graph 410): resync from scratch. */
export class CursorExpiredError extends Error {
  constructor(message = "Sync cursor expired") {
    super(message);
    this.name = "CursorExpiredError";
  }
}

// ─── Pipeline context ────────────────────────────────────────────────────────

export interface PipelineCeo {
  userId: string;
  personId: string;
  name: string;
  firstName: string;
  email: string | null;
  timezone: string;
  today: Date;
}

export interface PipelineCounters {
  duplicatesPrevented: number;
  extractionErrors: number;
  recordsWritten: number;
  reviewItems: number;
}

export interface PipelineContext {
  db: Db;
  now: Date;
  ceo: PipelineCeo;
  /** IngestionRun the current work belongs to (counters roll up into it). */
  runId: string | null;
  trigger: RunTrigger;
  log(stage: string, message: string): void;
  /** Increment run counters (persisted by the worker). */
  count(counter: keyof PipelineCounters, by?: number): void;
}

// ─── Stage outputs (persisted on SourceItem.stageData) ──────────────────────

export interface MentionDraft {
  entityType: Extract<EntityType, "PERSON" | "COMPANY" | "PROJECT">;
  text: string;
  email?: string | null;
  /** Email domain or org name hint, e.g. "brightwater.example" for a sender. */
  domain?: string | null;
  companyHint?: string | null;
  role: MentionRole;
  /** 0–1 */
  confidence: number;
}

export interface Classification {
  relevance: Relevance;
  /** 0–1 */
  relevanceScore: number;
  category: CeoCategory;
  reasons: string[];
  sensitivity: Sensitivity;
  /** True for newsletters, marketing, spam, routine notifications. */
  isNoise: boolean;
  meetingCategory?: MeetingCategory | null;
  docType?: DocumentType | null;
  docTypeConfidence?: number | null;
  activityTags: string[];
}

export interface ResolvedEntityRef {
  type: Extract<EntityType, "PERSON" | "COMPANY" | "PROJECT">;
  id: string;
  label: string;
  /** 0–1 */
  confidence: number;
  resolution: MentionResolution;
}

/** What entity resolution established about one source item. */
export interface ResolutionContext {
  people: (ResolvedEntityRef & { email?: string | null; companyId?: string | null; isCeo: boolean; role: MentionRole })[];
  companies: (ResolvedEntityRef & { companyType: CompanyType })[];
  projects: (ResolvedEntityRef & { kind: ProjectKind })[];
  /** The main external organization this item is about (sender's company, meeting counterpart…). */
  primaryCompanyId: string | null;
  /** External people the CEO is dealing with in this item. */
  counterpartPersonIds: string[];
  /** Ids of open deals tied to the primary company. */
  dealIds: string[];
  unresolved: { text: string; entityType: string; reason: string }[];
}

export interface WriteSummary {
  created: { type: EntityType; id: string }[];
  updated: { type: EntityType; id: string }[];
  reviewItemIds: string[];
  insightIds: string[];
  inboxItemIds: string[];
  duplicatesPrevented: number;
}

export interface StageData {
  mentions?: MentionDraft[];
  classification?: Classification;
  resolution?: ResolutionContext;
  relationshipsMapped?: number;
  extractionErrors?: { path: string; reason: string }[];
  write?: WriteSummary;
  /** Document stage: whether this sync produced a new version. */
  document?: { versionId: string | null; changed: boolean };
  /** Sensitivity chosen explicitly by an uploader; classification never lowers or replaces it. */
  sensitivityOverride?: Sensitivity;
  /** Provider (modifiedAt, versionTag) stamp used to skip unchanged documents without downloading. */
  sourceVersion?: { modifiedAt: string; versionTag: string | null };
}

// ─── Loaded source items ─────────────────────────────────────────────────────

export const SOURCE_ITEM_INCLUDE = {
  connection: { select: { id: true, provider: true, mode: true, kind: true, label: true, accountEmail: true, includeNoise: true, defaultSensitivity: true, ownerUserId: true, settings: true } },
  emailMessage: { include: { thread: true, attachments: true } },
  calendarEvent: true,
  document: true,
  meeting: { select: { id: true, title: true, startsAt: true, companyId: true } },
} satisfies Prisma.SourceItemInclude;

export type LoadedSourceItem = Prisma.SourceItemGetPayload<{ include: typeof SOURCE_ITEM_INCLUDE }>;

export async function loadSourceItem(db: Db, id: string): Promise<LoadedSourceItem | null> {
  return db.sourceItem.findUnique({ where: { id }, include: SOURCE_ITEM_INCLUDE });
}

// ─── Extraction input ────────────────────────────────────────────────────────

export interface KnownEntities {
  people: { id: string; name: string; email: string | null; company: string | null; isCeo: boolean }[];
  companies: { id: string; name: string; type: CompanyType }[];
  projects: { id: string; name: string; kind: ProjectKind }[];
  goals: { id: string; title: string }[];
  milestones: { id: string; title: string; dueDate: string }[];
  deals: { id: string; name: string; company: string | null; value: number | null }[];
}

/** Everything the intelligence extractor (Claude or rules) sees for one item. */
export interface ExtractionInput {
  sourceItemId: string;
  kind: SourceItemKind;
  title: string;
  /** Text to analyze: for email the new message content (quoted history stripped); documents may be long. */
  text: string;
  occurredAt: Date;
  /** CEO timezone, for resolving relative dates ("by Friday"). */
  timezone: string;
  ceo: { personId: string; name: string; firstName: string; email: string | null };
  email?: {
    direction: MessageDirection;
    from: Participant;
    to: Participant[];
    cc: Participant[];
    threadSubject: string;
    /** Up to the last few earlier messages in the thread, oldest first (context only). */
    previousMessages: { from: string; sentAt: Date; text: string }[];
  };
  event?: { startsAt: Date; endsAt: Date; attendees: Participant[]; organizer: Participant | null; category: MeetingCategory | null; status: EventStatus };
  document?: { docType: DocumentType; format: DocumentFormat; author: string | null; version: number };
  meeting?: { id: string; title: string; startsAt: Date };
  classification: Classification;
  resolution: ResolutionContext;
  known: KnownEntities;
}
