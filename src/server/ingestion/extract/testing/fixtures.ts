/**
 * Test fixtures for the extraction stage: realistic CytoHub source items and
 * extraction inputs built in memory (no database).
 */
import type { DocumentFormat, DocumentType, MessageDirection, SourceItemKind } from "@/generated/prisma/enums";
import type { Classification, ExtractionInput, KnownEntities, LoadedSourceItem, Participant, PipelineCeo, ResolutionContext } from "../../types";

export const TZ = "America/New_York";

export const CEO: PipelineCeo = {
  userId: "user_ceo",
  personId: "person_ceo",
  name: "Rajib Sen",
  firstName: "Rajib",
  email: "ceo@cytohub.example",
  timezone: TZ,
  today: new Date("2026-10-06T00:00:00Z"),
};

export const CEO_PARTY: Participant = { name: CEO.name, email: CEO.email! };
export const KAREN: Participant = { name: "Karen Liu", email: "karen@brightwater.example" };
export const SARAH: Participant = { name: "Sarah Chen", email: "sarah@northbridge.example" };
export const MAYA: Participant = { name: "Dr. Maya Lindqvist", email: "maya@cytohub.example" };
export const JONAS: Participant = { name: "Jonas Weber", email: "jonas@cytohub.example" };
export const MICHAEL: Participant = { name: "Michael Grant", email: "michael@granite.example" };

export function emptyResolution(): ResolutionContext {
  return { people: [], companies: [], projects: [], primaryCompanyId: null, counterpartPersonIds: [], dealIds: [], unresolved: [] };
}

export const KNOWN: KnownEntities = {
  people: [
    { id: "p_karen", name: "Karen Liu", email: "karen@brightwater.example", company: "Brightwater Therapeutics", isCeo: false },
    { id: "p_sarah", name: "Sarah Chen", email: "sarah@northbridge.example", company: "Northbridge Ventures", isCeo: false },
    { id: "p_maya", name: "Dr. Maya Lindqvist", email: "maya@cytohub.example", company: null, isCeo: false },
    { id: "person_ceo", name: CEO.name, email: CEO.email, company: null, isCeo: true },
  ],
  companies: [
    { id: "c_brightwater", name: "Brightwater Therapeutics", type: "PROSPECT" },
    { id: "c_northbridge", name: "Northbridge Ventures", type: "INVESTOR" },
    { id: "c_aurelius", name: "Aurelius Pharma", type: "CUSTOMER" },
    { id: "c_lumen", name: "Lumen Biologics", type: "CUSTOMER" },
  ],
  projects: [],
  goals: [
    { id: "g_seriesB", title: "Close a $40M Series B" },
    { id: "g_brightwater", title: "Sign the Brightwater Therapeutics MSA" },
    { id: "g_ai", title: "Launch CardioPredict v2 on CytoHub.AI" },
    { id: "g_dataset", title: "Grow the Human Heart Dataset to 500 donor hearts" },
    { id: "g_vpSales", title: "Hire a VP Sales" },
  ],
  milestones: [],
  deals: [{ id: "d_brightwater", name: "Brightwater MSA", company: "Brightwater Therapeutics", value: 2_400_000 }],
};

export function classification(over: Partial<Classification> = {}): Classification {
  return {
    relevance: "HIGH",
    relevanceScore: 0.75,
    category: "COMMERCIAL_OPPORTUNITY",
    reasons: ["Prospect: Brightwater Therapeutics", "Sent to you directly"],
    sensitivity: "CONFIDENTIAL",
    isNoise: false,
    meetingCategory: null,
    docType: null,
    docTypeConfidence: null,
    activityTags: ["COMMERCIAL"],
    ...over,
  };
}

interface EmailInputOpts {
  text: string;
  from?: Participant;
  to?: Participant[];
  cc?: Participant[];
  direction?: MessageDirection;
  subject?: string;
  sentAt?: Date;
  classification?: Partial<Classification>;
  resolution?: ResolutionContext;
}

/** Tuesday Oct 6 2026, 10:00 New York. */
export const SENT = new Date("2026-10-06T14:00:00Z");
export const NOW = new Date("2026-10-06T15:00:00Z");

export function emailInput(o: EmailInputOpts): ExtractionInput {
  const from = o.from ?? KAREN;
  const subject = o.subject ?? "Revised data package";
  return {
    sourceItemId: "si_test",
    kind: "EMAIL_MESSAGE",
    title: subject,
    text: o.text,
    occurredAt: o.sentAt ?? SENT,
    timezone: TZ,
    ceo: { personId: CEO.personId, name: CEO.name, firstName: CEO.firstName, email: CEO.email },
    email: {
      direction: o.direction ?? (from.email === CEO.email ? "OUTBOUND" : from.email.endsWith("@cytohub.example") ? "INTERNAL" : "INBOUND"),
      from,
      to: o.to ?? [CEO_PARTY],
      cc: o.cc ?? [],
      threadSubject: subject,
      previousMessages: [],
    },
    classification: classification(o.classification),
    resolution: o.resolution ?? emptyResolution(),
    known: KNOWN,
  };
}

export function notesInput(text: string, title = "Brightwater MSA working session — notes"): ExtractionInput {
  return {
    sourceItemId: "si_notes",
    kind: "MEETING_NOTES",
    title,
    text,
    occurredAt: SENT,
    timezone: TZ,
    ceo: { personId: CEO.personId, name: CEO.name, firstName: CEO.firstName, email: CEO.email },
    meeting: { id: "m1", title: "Brightwater MSA working session", startsAt: SENT },
    classification: classification({ category: "EXECUTIVE_TEAM", relevance: "NORMAL", relevanceScore: 0.5 }),
    resolution: emptyResolution(),
    known: KNOWN,
  };
}

export function eventInput(o: { title: string; description: string; startsAt?: Date; attendees?: Participant[] }): ExtractionInput {
  const startsAt = o.startsAt ?? new Date("2026-10-08T15:00:00Z");
  return {
    sourceItemId: "si_event",
    kind: "CALENDAR_EVENT",
    title: o.title,
    text: o.description,
    occurredAt: startsAt,
    timezone: TZ,
    ceo: { personId: CEO.personId, name: CEO.name, firstName: CEO.firstName, email: CEO.email },
    event: { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), attendees: o.attendees ?? [CEO_PARTY, SARAH], organizer: SARAH, category: "INVESTOR", status: "CONFIRMED" },
    classification: classification({ category: "INVESTOR", meetingCategory: "INVESTOR" }),
    resolution: emptyResolution(),
    known: KNOWN,
  };
}

export function documentInput(o: { title: string; text: string; docType?: DocumentType; format?: DocumentFormat; author?: string | null }): ExtractionInput {
  return {
    sourceItemId: "si_doc",
    kind: "DOCUMENT",
    title: o.title,
    text: o.text,
    occurredAt: SENT,
    timezone: TZ,
    ceo: { personId: CEO.personId, name: CEO.name, firstName: CEO.firstName, email: CEO.email },
    document: { docType: o.docType ?? "OTHER", format: o.format ?? "DOCX", author: o.author ?? null, version: 1 },
    classification: classification({ category: "LEGAL", relevance: "HIGH" }),
    resolution: emptyResolution(),
    known: KNOWN,
  };
}

// ─── Loaded source items (for mentions / classification) ────────────────────

const CONNECTION = {
  id: "conn_1",
  provider: "GMAIL",
  mode: "DEMO",
  kind: "EMAIL",
  label: "CEO mailbox",
  accountEmail: CEO.email,
  includeNoise: false,
  defaultSensitivity: "CONFIDENTIAL",
  ownerUserId: CEO.userId,
  settings: null,
} as const;

function baseItem(kind: SourceItemKind, title: string, text: string, occurredAt: Date) {
  return {
    id: `si_${Math.random().toString(36).slice(2, 8)}`,
    connectionId: CONNECTION.id,
    kind,
    externalId: "ext",
    externalUrl: null,
    title,
    occurredAt,
    ingestedAt: occurredAt,
    sourceUpdatedAt: null,
    contentHash: "hash",
    version: 1,
    rawPayload: null,
    text,
    snippet: text.slice(0, 200),
    status: "PENDING",
    stage: "NORMALIZED",
    attempts: 0,
    processingError: null,
    processedAt: null,
    relevance: null,
    relevanceScore: null,
    category: null,
    relevanceReasons: [],
    attention: null,
    sensitivity: "CONFIDENTIAL",
    stageData: null,
    extraction: null,
    extractionEngine: null,
    extractedAt: null,
    duplicateOfId: null,
    meetingId: null,
    deletedAtSource: null,
    contentPurgedAt: null,
    createdAt: occurredAt,
    updatedAt: occurredAt,
    connection: CONNECTION,
    emailMessage: null,
    calendarEvent: null,
    document: null,
    meeting: null,
  };
}

export function emailItem(o: { from: Participant; to?: Participant[]; cc?: Participant[]; subject: string; text: string; direction?: MessageDirection; isAutomated?: boolean; labels?: string[]; lastOutboundAt?: Date | null }): LoadedSourceItem {
  const item = baseItem("EMAIL_MESSAGE", o.subject, o.text, SENT);
  return {
    ...item,
    emailMessage: {
      id: "em_1",
      sourceItemId: item.id,
      threadId: "th_1",
      externalMessageId: "m1",
      internetMessageId: null,
      inReplyTo: null,
      fromName: o.from.name,
      fromEmail: o.from.email,
      to: o.to ?? [CEO_PARTY],
      cc: o.cc ?? [],
      bcc: null,
      subject: o.subject,
      sentAt: SENT,
      direction: o.direction ?? (o.from.email === CEO.email ? "OUTBOUND" : o.from.email.endsWith("@cytohub.example") ? "INTERNAL" : "INBOUND"),
      labels: o.labels ?? ["INBOX"],
      folder: null,
      isRead: false,
      isAutomated: o.isAutomated ?? false,
      hasAttachments: false,
      replyStatus: "NO_REPLY_NEEDED",
      createdAt: SENT,
      attachments: [],
      thread: {
        id: "th_1",
        connectionId: CONNECTION.id,
        externalThreadId: "t1",
        subject: o.subject,
        firstMessageAt: SENT,
        lastMessageAt: SENT,
        lastInboundAt: SENT,
        lastOutboundAt: o.lastOutboundAt ?? null,
        messageCount: 1,
        participants: [],
        relevance: null,
        category: null,
        sensitivity: "CONFIDENTIAL",
        status: "ACTIVE",
        awaitingSince: null,
        summary: null,
        currentStatus: null,
        keyParticipants: null,
        openQuestions: [],
        decisionsSummary: [],
        nextStep: null,
        recommendedAction: null,
        summaryEngine: null,
        summarizedAt: null,
        summarizedMessages: 0,
        companyId: null,
        dealId: null,
        createdAt: SENT,
        updatedAt: SENT,
      },
    },
  } as unknown as LoadedSourceItem;
}

export function eventItem(o: { title: string; description?: string; organizer?: Participant; attendees: Participant[]; startsAt?: Date }): LoadedSourceItem {
  const startsAt = o.startsAt ?? new Date("2026-10-08T15:00:00Z");
  const item = baseItem("CALENDAR_EVENT", o.title, `${o.title}\n${o.description ?? ""}`, startsAt);
  return {
    ...item,
    connection: { ...CONNECTION, kind: "CALENDAR", provider: "GOOGLE_CALENDAR" },
    calendarEvent: {
      id: "ev_1",
      sourceItemId: item.id,
      externalEventId: "e1",
      iCalUid: null,
      seriesId: null,
      title: o.title,
      description: o.description ?? null,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      allDay: false,
      timezone: TZ,
      location: null,
      conferenceUrl: null,
      organizerName: o.organizer?.name ?? null,
      organizerEmail: o.organizer?.email ?? null,
      attendees: o.attendees.map((a) => ({ ...a, responseStatus: "ACCEPTED" })),
      isRecurring: false,
      recurrence: null,
      status: "CONFIRMED",
      ceoResponse: "ACCEPTED",
      category: null,
      importance: 3,
      previousStartsAt: null,
      meetingId: null,
      relatedThreadId: null,
      createdAt: startsAt,
      updatedAt: startsAt,
    },
  } as unknown as LoadedSourceItem;
}

export function documentItem(o: { title: string; text: string; author?: string | null; format?: DocumentFormat; path?: string | null }): LoadedSourceItem {
  const item = baseItem("DOCUMENT", o.title, o.text, SENT);
  return {
    ...item,
    connection: { ...CONNECTION, kind: "DOCUMENTS", provider: "GOOGLE_DRIVE" },
    document: {
      id: "doc_1",
      sourceItemId: item.id,
      title: o.title,
      docType: "OTHER",
      docTypeConfidence: null,
      format: o.format ?? "DOCX",
      mimeType: "application/octet-stream",
      author: o.author ?? null,
      createdAtSource: null,
      modifiedAtSource: SENT,
      url: null,
      path: o.path ?? null,
      sizeBytes: 1000,
      currentVersion: 1,
      contentHash: "h",
      summary: null,
      keyFacts: null,
      sensitivity: "CONFIDENTIAL",
      resourceId: null,
      companyId: null,
      projectId: null,
      createdAt: SENT,
      updatedAt: SENT,
    },
  } as unknown as LoadedSourceItem;
}

export function notesItem(text: string, title = "Leadership sync — notes"): LoadedSourceItem {
  return { ...baseItem("MEETING_NOTES", title, text, SENT), connection: { ...CONNECTION, kind: "DOCUMENTS", provider: "CYTOHUB_INTERNAL" } } as unknown as LoadedSourceItem;
}
