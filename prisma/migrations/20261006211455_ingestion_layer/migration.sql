-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CEO', 'EXECUTIVE', 'TEAM_MEMBER', 'ADMIN', 'ADVISOR');

-- CreateEnum
CREATE TYPE "Sensitivity" AS ENUM ('INTERNAL', 'CONFIDENTIAL', 'RESTRICTED');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "GrantResource" AS ENUM ('CONNECTION', 'SOURCE_ITEM', 'DOCUMENT', 'EMAIL_THREAD');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('EMAIL', 'CALENDAR', 'DOCUMENTS');

-- CreateEnum
CREATE TYPE "SourceProvider" AS ENUM ('GMAIL', 'OUTLOOK_MAIL', 'GOOGLE_CALENDAR', 'OUTLOOK_CALENDAR', 'GOOGLE_DRIVE', 'ONEDRIVE', 'SHAREPOINT', 'DROPBOX', 'LOCAL_UPLOAD', 'CYTOHUB_INTERNAL');

-- CreateEnum
CREATE TYPE "ConnectionMode" AS ENUM ('LIVE', 'DEMO');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'SYNCING', 'ERROR', 'NEEDS_REAUTH', 'PAUSED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncFrequency" AS ENUM ('MANUAL', 'HOURLY', 'DAILY', 'REALTIME');

-- CreateEnum
CREATE TYPE "SourceItemKind" AS ENUM ('EMAIL_MESSAGE', 'CALENDAR_EVENT', 'DOCUMENT', 'MEETING_NOTES');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('RAW', 'NORMALIZED', 'PARSED', 'ENTITIES_EXTRACTED', 'ENTITIES_RESOLVED', 'RELATIONSHIPS_MAPPED', 'INTELLIGENCE_EXTRACTED', 'WRITTEN');

-- CreateEnum
CREATE TYPE "Relevance" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW', 'NOISE');

-- CreateEnum
CREATE TYPE "CeoCategory" AS ENUM ('INVESTOR', 'CUSTOMER', 'STRATEGIC_PARTNER', 'BOARD', 'LEGAL', 'FINANCE', 'RECRUITING', 'EXECUTIVE_TEAM', 'SCIENTIFIC_LEADERSHIP', 'MAJOR_VENDOR', 'FUNDRAISING', 'COMMERCIAL_OPPORTUNITY', 'INTERNAL_ESCALATION', 'OPERATIONS', 'PERSONAL', 'NEWSLETTER', 'MARKETING', 'NOTIFICATION', 'SPAM', 'OTHER');

-- CreateEnum
CREATE TYPE "AttentionLevel" AS ENUM ('IMMEDIATE', 'TODAY', 'THIS_WEEK', 'MONITOR', 'DELEGATE', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "ReplyStatus" AS ENUM ('REPLIED', 'AWAITING_CEO', 'AWAITING_THEM', 'NO_REPLY_NEEDED');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('AWAITING_CEO', 'AWAITING_THEM', 'ACTIVE', 'FYI', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('CONFIRMED', 'TENTATIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResponseStatus" AS ENUM ('ACCEPTED', 'DECLINED', 'TENTATIVE', 'NEEDS_ACTION', 'ORGANIZER');

-- CreateEnum
CREATE TYPE "MeetingCategory" AS ENUM ('INVESTOR', 'CUSTOMER', 'BOARD', 'INTERNAL_LEADERSHIP', 'SCIENTIFIC', 'PARTNER', 'RECRUITING', 'LEGAL', 'FINANCE', 'PRODUCT', 'SALES', 'FUNDRAISING', 'NETWORKING', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('INVESTOR_DECK', 'FINANCIAL_MODEL', 'CUSTOMER_PROPOSAL', 'CUSTOMER_CONTRACT', 'NDA', 'STRATEGIC_PLAN', 'SCIENTIFIC_REPORT', 'EXPERIMENT_REPORT', 'PUBLICATION', 'REGULATORY_DOCUMENT', 'PRODUCT_SPECIFICATION', 'MEETING_NOTES', 'BOARD_DOCUMENT', 'FUNDRAISING_MATERIAL', 'SALES_MATERIAL', 'EMPLOYEE_DOCUMENT', 'LEGAL_DOCUMENT', 'PARTNERSHIP_AGREEMENT', 'SCIENTIFIC_DATA_SUMMARY', 'INTERNAL_MEMO', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentFormat" AS ENUM ('PDF', 'DOCX', 'PPTX', 'XLSX', 'CSV', 'TXT', 'MARKDOWN', 'HTML', 'IMAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "CommitmentDirection" AS ENUM ('OUTBOUND', 'INBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('OPEN', 'FULFILLED', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MONITORING', 'MITIGATED', 'RESOLVED', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "OpportunityKind" AS ENUM ('COMMERCIAL', 'FUNDRAISING', 'PARTNERSHIP', 'SCIENTIFIC', 'EXPANSION', 'HIRING', 'OTHER');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'PURSUING', 'WON', 'LOST', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ProjectKind" AS ENUM ('PROJECT', 'SCIENTIFIC_PROGRAM', 'PRODUCT');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('PERSON', 'COMPANY', 'PROJECT', 'GOAL', 'MILESTONE', 'TASK', 'DECISION', 'MEETING', 'DEAL', 'DOCUMENT', 'EMAIL_THREAD', 'SOURCE_ITEM', 'COMMITMENT', 'RISK', 'OPPORTUNITY', 'RESOURCE', 'INSIGHT', 'INBOX_ITEM');

-- CreateEnum
CREATE TYPE "AliasKind" AS ENUM ('NAME', 'NICKNAME', 'ABBREVIATION', 'EMAIL', 'DOMAIN', 'SUBSIDIARY', 'FORMER_NAME');

-- CreateEnum
CREATE TYPE "AliasSource" AS ENUM ('SYSTEM', 'SEED', 'LEARNED', 'USER');

-- CreateEnum
CREATE TYPE "MentionRole" AS ENUM ('SENDER', 'RECIPIENT', 'CC', 'ORGANIZER', 'ATTENDEE', 'AUTHOR', 'MENTIONED');

-- CreateEnum
CREATE TYPE "MentionResolution" AS ENUM ('RESOLVED', 'CREATED', 'AMBIGUOUS', 'UNRESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('WORKS_AT', 'SUBSIDIARY_OF', 'ASSOCIATED_WITH', 'CAME_FROM', 'RELATED_TO', 'SUPPORTS', 'ORIGINATED_FROM', 'AFFECTS', 'MADE_BY', 'OWED_TO', 'MENTIONS', 'ATTENDED', 'AUTHORED', 'ABOUT', 'INVESTS_IN', 'CUSTOMER_OF', 'PARTNER_OF');

-- CreateEnum
CREATE TYPE "ReferenceRole" AS ENUM ('CREATED_FROM', 'UPDATED_FROM', 'CORROBORATED_BY');

-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('TASK', 'COMMITMENT', 'DEADLINE', 'DECISION', 'RISK', 'OPPORTUNITY', 'MEETING', 'ENTITY_MERGE', 'NEW_PERSON', 'NEW_COMPANY', 'NEW_INVESTOR', 'FIELD_CHANGE', 'DOCUMENT_CHANGE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED', 'IGNORED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('EMAIL_SYNC', 'CALENDAR_SYNC', 'DOCUMENT_SYNC', 'DOCUMENT_PARSE', 'ENTITY_EXTRACTION', 'ENTITY_RESOLUTION', 'RELATIONSHIP_MAPPING', 'INTELLIGENCE_EXTRACTION', 'BRAIN_WRITE', 'THREAD_SUMMARY', 'PRIORITY_RECALC', 'DAILY_BRAIN_REFRESH', 'RETENTION_SWEEP');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "RunTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'REFRESH', 'SEED', 'UPLOAD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'COMMITMENT_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'COMMITMENT_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE 'COMMITMENT_FULFILLED';
ALTER TYPE "ActivityType" ADD VALUE 'DEADLINE_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE 'OWNER_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE 'STATUS_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE 'MEETING_OCCURRED';
ALTER TYPE "ActivityType" ADD VALUE 'MEETING_RESCHEDULED';
ALTER TYPE "ActivityType" ADD VALUE 'MEETING_CANCELLED';
ALTER TYPE "ActivityType" ADD VALUE 'DOCUMENT_CHANGED';
ALTER TYPE "ActivityType" ADD VALUE 'RISK_EMERGED';
ALTER TYPE "ActivityType" ADD VALUE 'RISK_RESOLVED';
ALTER TYPE "ActivityType" ADD VALUE 'OPPORTUNITY_IDENTIFIED';
ALTER TYPE "ActivityType" ADD VALUE 'ENTITY_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'ENTITY_MERGED';
ALTER TYPE "ActivityType" ADD VALUE 'SOURCE_CONNECTED';
ALTER TYPE "ActivityType" ADD VALUE 'SOURCE_DISCONNECTED';
ALTER TYPE "ActivityType" ADD VALUE 'REVIEW_RESOLVED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InboxType" ADD VALUE 'COMMITMENT';
ALTER TYPE "InboxType" ADD VALUE 'CHANGE';
ALTER TYPE "InboxType" ADD VALUE 'REQUEST';

-- AlterEnum
ALTER TYPE "InsightType" ADD VALUE 'CHANGE';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "commitmentId" TEXT,
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "riskId" TEXT,
ADD COLUMN     "sourceItemId" TEXT;

-- AlterTable
ALTER TABLE "BrainInsight" ADD COLUMN     "changeKind" TEXT,
ADD COLUMN     "commitmentId" TEXT,
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "meetingId" TEXT,
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "riskId" TEXT,
ADD COLUMN     "sourceItemId" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "domain" TEXT,
ADD COLUMN     "parentId" TEXT;

-- AlterTable
ALTER TABLE "InboxItem" ADD COLUMN     "attention" "AttentionLevel",
ADD COLUMN     "commitmentId" TEXT,
ADD COLUMN     "confidence" "Confidence",
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "riskId" TEXT,
ADD COLUMN     "sourceItemId" TEXT,
ADD COLUMN     "strategicRelevance" TEXT;

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "category" "MeetingCategory",
ADD COLUMN     "notesProcessedAt" TIMESTAMP(3),
ADD COLUMN     "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "extractionConfidence" "Confidence";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "failedLogins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'TEAM_MEMBER';

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessGrant" (
    "id" TEXT NOT NULL,
    "resourceType" "GrantResource" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "userId" TEXT,
    "role" "UserRole",
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "AccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS',
    "targetType" TEXT,
    "targetId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SourceConnection" (
    "id" TEXT NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "provider" "SourceProvider" NOT NULL,
    "mode" "ConnectionMode" NOT NULL DEFAULT 'LIVE',
    "label" TEXT NOT NULL,
    "accountEmail" TEXT,
    "externalAccountId" TEXT,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "syncFrequency" "SyncFrequency" NOT NULL DEFAULT 'HOURLY',
    "scopes" TEXT[],
    "credentials" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "cursor" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "nextSyncAt" TIMESTAMP(3),
    "webhookChannelId" TEXT,
    "webhookSecretHash" TEXT,
    "webhookExpiresAt" TIMESTAMP(3),
    "includeNoise" BOOLEAN NOT NULL DEFAULT false,
    "defaultSensitivity" "Sensitivity" NOT NULL DEFAULT 'CONFIDENTIAL',
    "settings" JSONB,
    "itemsIngested" INTEGER NOT NULL DEFAULT 0,
    "ownerUserId" TEXT,
    "brainSourceId" TEXT,
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceItem" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" "SourceItemKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "externalUrl" TEXT,
    "title" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "rawPayload" TEXT,
    "text" TEXT,
    "snippet" TEXT,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "stage" "PipelineStage" NOT NULL DEFAULT 'RAW',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3),
    "relevance" "Relevance",
    "relevanceScore" DOUBLE PRECISION,
    "category" "CeoCategory",
    "relevanceReasons" TEXT[],
    "attention" "AttentionLevel",
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'CONFIDENTIAL',
    "stageData" JSONB,
    "extraction" JSONB,
    "extractionEngine" TEXT,
    "extractedAt" TIMESTAMP(3),
    "duplicateOfId" TEXT,
    "meetingId" TEXT,
    "deletedAtSource" TIMESTAMP(3),
    "contentPurgedAt" TIMESTAMP(3),
    "searchVector" tsvector,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailThread" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "firstMessageAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "participants" JSONB NOT NULL,
    "relevance" "Relevance",
    "category" "CeoCategory",
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'CONFIDENTIAL',
    "status" "ThreadStatus" NOT NULL DEFAULT 'ACTIVE',
    "awaitingSince" TIMESTAMP(3),
    "summary" TEXT,
    "currentStatus" TEXT,
    "keyParticipants" JSONB,
    "openQuestions" TEXT[],
    "decisionsSummary" TEXT[],
    "nextStep" TEXT,
    "recommendedAction" TEXT,
    "summaryEngine" TEXT,
    "summarizedAt" TIMESTAMP(3),
    "summarizedMessages" INTEGER NOT NULL DEFAULT 0,
    "companyId" TEXT,
    "dealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "internetMessageId" TEXT,
    "inReplyTo" TEXT,
    "fromName" TEXT,
    "fromEmail" TEXT NOT NULL,
    "to" JSONB NOT NULL,
    "cc" JSONB NOT NULL,
    "bcc" JSONB,
    "subject" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "labels" TEXT[],
    "folder" TEXT,
    "isRead" BOOLEAN,
    "isAutomated" BOOLEAN NOT NULL DEFAULT false,
    "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
    "replyStatus" "ReplyStatus" NOT NULL DEFAULT 'NO_REPLY_NEEDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "externalAttachmentId" TEXT,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentHash" TEXT,
    "blobId" TEXT,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "iCalUid" TEXT,
    "seriesId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT,
    "location" TEXT,
    "conferenceUrl" TEXT,
    "organizerName" TEXT,
    "organizerEmail" TEXT,
    "attendees" JSONB NOT NULL,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrence" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "ceoResponse" "ResponseStatus",
    "category" "MeetingCategory",
    "importance" INTEGER NOT NULL DEFAULT 3,
    "previousStartsAt" TIMESTAMP(3),
    "meetingId" TEXT,
    "relatedThreadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" "DocumentType" NOT NULL DEFAULT 'OTHER',
    "docTypeConfidence" DOUBLE PRECISION,
    "format" "DocumentFormat" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "author" TEXT,
    "createdAtSource" TIMESTAMP(3),
    "modifiedAtSource" TIMESTAMP(3),
    "url" TEXT,
    "path" TEXT,
    "sizeBytes" INTEGER,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "contentHash" TEXT NOT NULL,
    "summary" TEXT,
    "keyFacts" JSONB,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'CONFIDENTIAL',
    "resourceId" TEXT,
    "companyId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "modifiedAt" TIMESTAMP(3) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "previousVersionId" TEXT,
    "text" TEXT,
    "textLength" INTEGER NOT NULL DEFAULT 0,
    "pageCount" INTEGER,
    "parser" TEXT NOT NULL,
    "blobId" TEXT,
    "changeSummary" TEXT,
    "significantChanges" JSONB,
    "isSignificant" BOOLEAN NOT NULL DEFAULT false,
    "keyFacts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredBlob" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "StoredBlob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commitment" (
    "id" TEXT NOT NULL,
    "direction" "CommitmentDirection" NOT NULL,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dueDate" DATE,
    "dueText" TEXT,
    "followUpDate" DATE,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "fulfilledAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "confidence" "Confidence" NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ownerPersonId" TEXT,
    "counterpartyPersonId" TEXT,
    "companyId" TEXT,
    "taskId" TEXT,
    "threadId" TEXT,
    "meetingId" TEXT,
    "dealId" TEXT,
    "goalId" TEXT,
    "opportunityId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Risk" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "severity" INTEGER NOT NULL DEFAULT 3,
    "likelihood" INTEGER,
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "mitigation" TEXT,
    "identifiedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "confidence" "Confidence" NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "ownerPersonId" TEXT,
    "companyId" TEXT,
    "goalId" TEXT,
    "milestoneId" TEXT,
    "dealId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "OpportunityKind" NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "estimatedValue" DOUBLE PRECISION,
    "nextStep" TEXT,
    "identifiedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "confidence" "Confidence" NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "companyId" TEXT,
    "personId" TEXT,
    "dealId" TEXT,
    "goalId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ProjectKind" NOT NULL,
    "description" TEXT,
    "status" TEXT,
    "goalId" TEXT,
    "pillarId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityAlias" (
    "id" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "kind" "AliasKind" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "source" "AliasSource" NOT NULL DEFAULT 'SYSTEM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityMention" (
    "id" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "entityId" TEXT,
    "text" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "email" TEXT,
    "role" "MentionRole" NOT NULL DEFAULT 'MENTIONED',
    "confidence" DOUBLE PRECISION NOT NULL,
    "resolution" "MentionResolution" NOT NULL DEFAULT 'UNRESOLVED',
    "candidates" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "fromType" "EntityType" NOT NULL,
    "fromId" TEXT NOT NULL,
    "relation" "RelationType" NOT NULL,
    "toType" "EntityType" NOT NULL,
    "toId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "sourceItemId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceReference" (
    "id" TEXT NOT NULL,
    "targetType" "EntityType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "role" "ReferenceRole" NOT NULL DEFAULT 'CREATED_FROM',
    "sourceItemId" TEXT,
    "sourceKind" "SourceItemKind" NOT NULL,
    "provider" "SourceProvider" NOT NULL,
    "sourceTitle" TEXT NOT NULL,
    "sourceExternalId" TEXT,
    "sourceUrl" TEXT,
    "sourceOccurredAt" TIMESTAMP(3) NOT NULL,
    "excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "engine" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewQueueItem" (
    "id" TEXT NOT NULL,
    "kind" "ReviewKind" NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "impact" INTEGER NOT NULL DEFAULT 3,
    "confidence" "Confidence" NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "proposal" JSONB NOT NULL,
    "edited" JSONB,
    "targetType" "EntityType",
    "targetId" TEXT,
    "candidates" JSONB,
    "excerpt" TEXT,
    "fingerprint" TEXT NOT NULL,
    "sensitivity" "Sensitivity" NOT NULL DEFAULT 'CONFIDENTIAL',
    "sourceItemId" TEXT,
    "assignedToUserId" TEXT,
    "resolvedByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "resultType" "EntityType",
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "dedupeKey" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "lastError" TEXT,
    "result" JSONB,
    "connectionId" TEXT,
    "sourceItemId" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionRun" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "trigger" "RunTrigger" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "cursorBefore" JSONB,
    "cursorAfter" JSONB,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "noise" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "duplicatesPrevented" INTEGER NOT NULL DEFAULT 0,
    "recordsWritten" INTEGER NOT NULL DEFAULT 0,
    "reviewItems" INTEGER NOT NULL DEFAULT 0,
    "extractionErrors" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "log" JSONB,

    CONSTRAINT "IngestionRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AccessGrant_resourceType_resourceId_idx" ON "AccessGrant"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "AccessGrant_userId_idx" ON "AccessGrant"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- CreateIndex
CREATE INDEX "SourceConnection_kind_status_idx" ON "SourceConnection"("kind", "status");

-- CreateIndex
CREATE INDEX "SourceItem_kind_occurredAt_idx" ON "SourceItem"("kind", "occurredAt");

-- CreateIndex
CREATE INDEX "SourceItem_status_idx" ON "SourceItem"("status");

-- CreateIndex
CREATE INDEX "SourceItem_relevance_idx" ON "SourceItem"("relevance");

-- CreateIndex
CREATE INDEX "SourceItem_searchVector_idx" ON "SourceItem" USING GIN ("searchVector");

-- CreateIndex
CREATE UNIQUE INDEX "SourceItem_connectionId_externalId_key" ON "SourceItem"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "EmailThread_lastMessageAt_idx" ON "EmailThread"("lastMessageAt");

-- CreateIndex
CREATE INDEX "EmailThread_status_idx" ON "EmailThread"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailThread_connectionId_externalThreadId_key" ON "EmailThread"("connectionId", "externalThreadId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_sourceItemId_key" ON "EmailMessage"("sourceItemId");

-- CreateIndex
CREATE INDEX "EmailMessage_threadId_sentAt_idx" ON "EmailMessage"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX "EmailMessage_internetMessageId_idx" ON "EmailMessage"("internetMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_fromEmail_idx" ON "EmailMessage"("fromEmail");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_sourceItemId_key" ON "CalendarEvent"("sourceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_meetingId_key" ON "CalendarEvent"("meetingId");

-- CreateIndex
CREATE INDEX "CalendarEvent_startsAt_idx" ON "CalendarEvent"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_sourceItemId_key" ON "Document"("sourceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_resourceId_key" ON "Document"("resourceId");

-- CreateIndex
CREATE INDEX "Document_docType_idx" ON "Document"("docType");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_previousVersionId_key" ON "DocumentVersion"("previousVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "StoredBlob_sha256_key" ON "StoredBlob"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Commitment_fingerprint_key" ON "Commitment"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Commitment_taskId_key" ON "Commitment"("taskId");

-- CreateIndex
CREATE INDEX "Commitment_direction_status_dueDate_idx" ON "Commitment"("direction", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Commitment_companyId_idx" ON "Commitment"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Risk_fingerprint_key" ON "Risk"("fingerprint");

-- CreateIndex
CREATE INDEX "Risk_status_severity_idx" ON "Risk"("status", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_fingerprint_key" ON "Opportunity"("fingerprint");

-- CreateIndex
CREATE INDEX "Opportunity_status_idx" ON "Opportunity"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Project_name_key" ON "Project"("name");

-- CreateIndex
CREATE INDEX "EntityAlias_normalized_idx" ON "EntityAlias"("normalized");

-- CreateIndex
CREATE UNIQUE INDEX "EntityAlias_entityType_entityId_normalized_key" ON "EntityAlias"("entityType", "entityId", "normalized");

-- CreateIndex
CREATE INDEX "EntityMention_sourceItemId_idx" ON "EntityMention"("sourceItemId");

-- CreateIndex
CREATE INDEX "EntityMention_entityType_entityId_idx" ON "EntityMention"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Relationship_fromType_fromId_idx" ON "Relationship"("fromType", "fromId");

-- CreateIndex
CREATE INDEX "Relationship_toType_toId_idx" ON "Relationship"("toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_fromType_fromId_relation_toType_toId_key" ON "Relationship"("fromType", "fromId", "relation", "toType", "toId");

-- CreateIndex
CREATE INDEX "SourceReference_targetType_targetId_idx" ON "SourceReference"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "SourceReference_sourceItemId_idx" ON "SourceReference"("sourceItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceReference_targetType_targetId_sourceItemId_role_key" ON "SourceReference"("targetType", "targetId", "sourceItemId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewQueueItem_fingerprint_key" ON "ReviewQueueItem"("fingerprint");

-- CreateIndex
CREATE INDEX "ReviewQueueItem_status_impact_idx" ON "ReviewQueueItem"("status", "impact");

-- CreateIndex
CREATE INDEX "ReviewQueueItem_kind_idx" ON "ReviewQueueItem"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionJob_dedupeKey_key" ON "IngestionJob"("dedupeKey");

-- CreateIndex
CREATE INDEX "IngestionJob_status_runAt_priority_idx" ON "IngestionJob"("status", "runAt", "priority");

-- CreateIndex
CREATE INDEX "IngestionJob_type_status_idx" ON "IngestionJob"("type", "status");

-- CreateIndex
CREATE INDEX "IngestionJob_runId_idx" ON "IngestionJob"("runId");

-- CreateIndex
CREATE INDEX "IngestionRun_startedAt_idx" ON "IngestionRun"("startedAt");

-- CreateIndex
CREATE INDEX "IngestionRun_connectionId_startedAt_idx" ON "IngestionRun"("connectionId", "startedAt");

-- CreateIndex
CREATE INDEX "Activity_commitmentId_idx" ON "Activity"("commitmentId");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "Risk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessGrant" ADD CONSTRAINT "AccessGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceConnection" ADD CONSTRAINT "SourceConnection_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceConnection" ADD CONSTRAINT "SourceConnection_brainSourceId_fkey" FOREIGN KEY ("brainSourceId") REFERENCES "BrainSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceItem" ADD CONSTRAINT "SourceItem_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceItem" ADD CONSTRAINT "SourceItem_duplicateOfId_fkey" FOREIGN KEY ("duplicateOfId") REFERENCES "SourceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceItem" ADD CONSTRAINT "SourceItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailThread" ADD CONSTRAINT "EmailThread_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "StoredBlob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailAttachment" ADD CONSTRAINT "EmailAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_relatedThreadId_fkey" FOREIGN KEY ("relatedThreadId") REFERENCES "EmailThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_blobId_fkey" FOREIGN KEY ("blobId") REFERENCES "StoredBlob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_counterpartyPersonId_fkey" FOREIGN KEY ("counterpartyPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Risk" ADD CONSTRAINT "Risk_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "StrategicPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityMention" ADD CONSTRAINT "EntityMention_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceReference" ADD CONSTRAINT "SourceReference_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewQueueItem" ADD CONSTRAINT "ReviewQueueItem_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewQueueItem" ADD CONSTRAINT "ReviewQueueItem_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewQueueItem" ADD CONSTRAINT "ReviewQueueItem_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "IngestionRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionRun" ADD CONSTRAINT "IngestionRun_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SourceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Full-text search over ingested sources ─────────────────────────────────
-- Weighted: title (A) above body text (B). Maintained by trigger so writers
-- never have to remember it; cleared automatically when content is purged.
CREATE OR REPLACE FUNCTION source_item_search_vector() RETURNS trigger AS $$
BEGIN
  NEW."searchVector" :=
    setweight(to_tsvector('english', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('english', coalesce(left(NEW."text", 200000), '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER source_item_search_vector_trg
  BEFORE INSERT OR UPDATE OF "title", "text" ON "SourceItem"
  FOR EACH ROW EXECUTE FUNCTION source_item_search_vector();

-- ─── Data migration: existing CEO keeps full access ─────────────────────────
UPDATE "User" SET "role" = 'CEO'
WHERE "personId" IN (SELECT "id" FROM "Person" WHERE "isCeo" = true);
