-- CreateEnum
CREATE TYPE "GoalType" AS ENUM ('COMPANY', 'ANNUAL', 'QUARTERLY', 'CEO', 'DEPARTMENT');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'COMPLETED', 'PAUSED');

-- CreateEnum
CREATE TYPE "MilestoneType" AS ENUM ('ARR', 'PHARMA_CONTRACT', 'FUNDRAISING', 'PRODUCT_RELEASE', 'AI_MODEL', 'SCIENTIFIC_VALIDATION', 'PUBLICATION', 'REGULATORY', 'PARTNERSHIP', 'HIRING', 'THERAPEUTIC', 'OTHER');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'AT_RISK', 'BLOCKED', 'COMPLETED', 'MISSED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'WAITING', 'BLOCKED', 'DONE', 'CANCELLED', 'SOMEDAY');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "FocusArea" AS ENUM ('FUNDRAISING', 'REVENUE', 'CUSTOMERS', 'PRODUCT', 'CYTOHUB_AI', 'SCIENCE', 'PARTNERSHIPS', 'TEAM', 'FINANCE', 'OPERATIONS', 'LEGAL', 'RECRUITING', 'STRATEGY', 'CEO_DEVELOPMENT');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('MANUAL', 'BRAIN', 'EMAIL', 'CALENDAR', 'CRM', 'MEETING', 'DOCUMENT', 'DECISION', 'INBOX');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('NEEDED', 'WAITING_INFO', 'DECIDED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('DOCUMENT', 'PRESENTATION', 'CONTRACT', 'FINANCIAL_MODEL', 'MEETING_NOTES', 'SCIENTIFIC_PAPER', 'DATASET', 'LINK', 'INTELLIGENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('TEAM', 'INVESTOR', 'CUSTOMER', 'PARTNER', 'ADVISOR', 'BOARD', 'CANDIDATE', 'OTHER');

-- CreateEnum
CREATE TYPE "CompanyType" AS ENUM ('CUSTOMER', 'PROSPECT', 'INVESTOR', 'PARTNER', 'ACADEMIC', 'VENDOR', 'COMPETITOR', 'OTHER');

-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('SALES', 'FUNDRAISING', 'PARTNERSHIP');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('INVESTOR', 'CUSTOMER', 'BOARD', 'PARTNER', 'INTERNAL', 'ONE_ON_ONE', 'CANDIDATE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "MetricCategory" AS ENUM ('REVENUE', 'ARR', 'PIPELINE', 'CUSTOMERS', 'FUNDRAISING', 'CASH', 'PRODUCT', 'AI', 'SCIENCE', 'THERAPEUTICS', 'PARTNERSHIPS', 'TEAM');

-- CreateEnum
CREATE TYPE "MetricUnit" AS ENUM ('CURRENCY', 'PERCENT', 'COUNT', 'NUMBER', 'MONTHS', 'DAYS');

-- CreateEnum
CREATE TYPE "MetricDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');

-- CreateEnum
CREATE TYPE "DelegationStatus" AS ENUM ('ACTIVE', 'NEEDS_FOLLOW_UP', 'COMPLETED', 'RECALLED');

-- CreateEnum
CREATE TYPE "InboxType" AS ENUM ('APPROVAL', 'DECISION', 'RESPONSE', 'ESCALATION', 'CUSTOMER_ISSUE', 'INVESTOR_FOLLOW_UP', 'DEADLINE_RISK', 'HIRING_DECISION', 'OPPORTUNITY');

-- CreateEnum
CREATE TYPE "InboxStatus" AS ENUM ('OPEN', 'SNOOZED', 'DONE', 'DISMISSED');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('DEVELOPMENT', 'OPPORTUNITY', 'RISK', 'DEAL_PROGRESS', 'DEAL_SLOWING', 'COMMUNICATION', 'MILESTONE_REACHED', 'MILESTONE_AT_RISK', 'DECISION_NEEDED', 'DEADLINE', 'FOLLOW_UP', 'COMMITMENT', 'DELEGATION', 'ATTENTION');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "RefreshStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "RefreshTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'SEED');

-- CreateEnum
CREATE TYPE "SourceCategory" AS ENUM ('WORKSPACE', 'COMMUNICATION', 'CALENDAR', 'CRM', 'DOCUMENTS', 'FINANCE', 'SCIENCE', 'PEOPLE');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('CONNECTED', 'NOT_CONNECTED', 'SYNCING', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "SignalKind" AS ENUM ('EMAIL', 'CALENDAR_EVENT', 'CRM_UPDATE', 'DOCUMENT', 'MEETING_NOTE', 'METRIC_UPDATE', 'MESSAGE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('TASK_CREATED', 'TASK_UPDATED', 'TASK_COMPLETED', 'TASK_REOPENED', 'TASK_RESCHEDULED', 'TASK_DELEGATED', 'TASK_PRIORITY_CHANGED', 'NOTE_ADDED', 'GOAL_CREATED', 'GOAL_UPDATED', 'MILESTONE_CREATED', 'MILESTONE_UPDATED', 'MILESTONE_COMPLETED', 'DECISION_CREATED', 'DECISION_UPDATED', 'DECISION_MADE', 'RESOURCE_ADDED', 'INBOX_RESOLVED', 'DELEGATION_UPDATED', 'METRIC_RECORDED', 'MEETING_PREPARED', 'BRAIN_REFRESH', 'TOP5_CONFIRMED', 'END_OF_DAY', 'REVIEW_COMPLETED');

-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PrioritySource" AS ENUM ('BRAIN', 'CEO');

-- CreateEnum
CREATE TYPE "TimeSource" AS ENUM ('CALENDAR', 'TASK', 'MANUAL');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Chief Executive Officer',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "personId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StrategicPillar" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT 'slate',
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategicPillar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttentionTarget" (
    "focusArea" "FocusArea" NOT NULL,
    "recommendedPct" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttentionTarget_pkey" PRIMARY KEY ("focusArea")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CompanyType" NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "description" TEXT,
    "location" TEXT,
    "relationship" INTEGER NOT NULL DEFAULT 3,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "title" TEXT,
    "type" "PersonType" NOT NULL,
    "isCeo" BOOLEAN NOT NULL DEFAULT false,
    "department" TEXT,
    "expertise" "FocusArea"[],
    "companyId" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "notesText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "GoalType" NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'ON_TRACK',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER NOT NULL DEFAULT 70,
    "department" TEXT,
    "period" TEXT,
    "startDate" DATE,
    "targetDate" DATE,
    "risks" TEXT,
    "notesText" TEXT,
    "pillarId" TEXT,
    "ownerId" TEXT,
    "parentId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "MilestoneType" NOT NULL,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "dueDate" DATE NOT NULL,
    "completedAt" TIMESTAMP(3),
    "blocker" TEXT,
    "successMetric" TEXT,
    "goalId" TEXT,
    "pillarId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "Priority" NOT NULL DEFAULT 'P2',
    "focusArea" "FocusArea" NOT NULL DEFAULT 'OPERATIONS',
    "dueDate" DATE,
    "originalDueDate" DATE,
    "postponeCount" INTEGER NOT NULL DEFAULT 0,
    "hardDeadline" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "estimatedMinutes" INTEGER,
    "actualMinutes" INTEGER,
    "blocker" TEXT,
    "source" "ItemSource" NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "notesText" TEXT,
    "tags" TEXT[],
    "strategicImpact" INTEGER NOT NULL DEFAULT 3,
    "revenueImpact" INTEGER NOT NULL DEFAULT 0,
    "fundraisingImpact" INTEGER NOT NULL DEFAULT 0,
    "customerImpact" INTEGER NOT NULL DEFAULT 0,
    "scientificImpact" INTEGER NOT NULL DEFAULT 0,
    "riskLevel" INTEGER NOT NULL DEFAULT 1,
    "ceoUniqueness" INTEGER NOT NULL DEFAULT 3,
    "opportunityCost" INTEGER NOT NULL DEFAULT 2,
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoreBreakdown" JSONB,
    "scoredAt" TIMESTAMP(3),
    "aiRecommendation" TEXT,
    "delegationRecommended" BOOLEAN NOT NULL DEFAULT false,
    "suggestedDelegateId" TEXT,
    "ownerId" TEXT,
    "goalId" TEXT,
    "milestoneId" TEXT,
    "pillarId" TEXT,
    "companyId" TEXT,
    "decisionId" TEXT,
    "meetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context" TEXT,
    "status" "DecisionStatus" NOT NULL DEFAULT 'NEEDED',
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" DATE,
    "strategicImpact" INTEGER NOT NULL DEFAULT 3,
    "supportingInfo" TEXT,
    "recommendation" TEXT,
    "waitingOn" TEXT,
    "finalDecision" TEXT,
    "decidedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "lessonsLearned" TEXT,
    "goalId" TEXT,
    "pillarId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionOption" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pros" TEXT[],
    "cons" TEXT[],
    "risks" TEXT[],
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DecisionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "summary" TEXT,
    "tags" TEXT[],
    "source" "ItemSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delegation" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "delegateId" TEXT NOT NULL,
    "status" "DelegationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expectations" TEXT,
    "delegatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATE,
    "lastUpdateAt" TIMESTAMP(3),
    "lastUpdateNote" TEXT,
    "followUpAt" DATE,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DealType" NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "stage" TEXT NOT NULL,
    "stageOrder" INTEGER NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION,
    "probability" INTEGER NOT NULL DEFAULT 20,
    "expectedClose" DATE,
    "stageChangedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),
    "nextStep" TEXT,
    "companyId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL,
    "focusArea" "FocusArea" NOT NULL DEFAULT 'OPERATIONS',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "objective" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "source" "ItemSource" NOT NULL DEFAULT 'CALENDAR',
    "externalId" TEXT,
    "companyId" TEXT,
    "goalId" TEXT,
    "prepBrief" JSONB,
    "preparedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metric" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MetricCategory" NOT NULL,
    "unit" "MetricUnit" NOT NULL,
    "direction" "MetricDirection" NOT NULL DEFAULT 'HIGHER_IS_BETTER',
    "description" TEXT,
    "target" DOUBLE PRECISION,
    "targetDate" DATE,
    "sourceKey" TEXT NOT NULL DEFAULT 'manual',
    "order" INTEGER NOT NULL DEFAULT 0,
    "pillarId" TEXT,
    "goalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Metric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricValue" (
    "id" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "recordedAt" DATE NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "focusArea" "FocusArea" NOT NULL,
    "source" "TimeSource" NOT NULL,
    "description" TEXT,
    "taskId" TEXT,
    "meetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "SourceCategory" NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
    "description" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "itemsIndexed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainSignal" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "externalId" TEXT,
    "kind" "SignalKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "personId" TEXT,
    "companyId" TEXT,
    "dealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrainSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainRefresh" (
    "id" TEXT NOT NULL,
    "status" "RefreshStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" "RefreshTrigger" NOT NULL DEFAULT 'MANUAL',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "signalsScanned" INTEGER NOT NULL DEFAULT 0,
    "insightsCreated" INTEGER NOT NULL DEFAULT 0,
    "tasksCreated" INTEGER NOT NULL DEFAULT 0,
    "tasksUpdated" INTEGER NOT NULL DEFAULT 0,
    "milestonesChanged" INTEGER NOT NULL DEFAULT 0,
    "inboxCreated" INTEGER NOT NULL DEFAULT 0,
    "sourceResults" JSONB,
    "log" JSONB,
    "error" TEXT,

    CONSTRAINT "BrainRefresh_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainInsight" (
    "id" TEXT NOT NULL,
    "type" "InsightType" NOT NULL,
    "status" "InsightStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "requiresCeo" BOOLEAN NOT NULL DEFAULT false,
    "recommendation" TEXT,
    "fingerprint" TEXT NOT NULL,
    "refreshId" TEXT,
    "signalId" TEXT,
    "personId" TEXT,
    "companyId" TEXT,
    "goalId" TEXT,
    "milestoneId" TEXT,
    "taskId" TEXT,
    "decisionId" TEXT,
    "dealId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyBrief" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "refreshId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyBrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InboxItem" (
    "id" TEXT NOT NULL,
    "type" "InboxType" NOT NULL,
    "status" "InboxStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "whyCeo" TEXT NOT NULL,
    "recommendedAction" TEXT NOT NULL,
    "urgency" INTEGER NOT NULL DEFAULT 3,
    "dueDate" DATE,
    "snoozedUntil" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "source" "ItemSource" NOT NULL DEFAULT 'BRAIN',
    "fingerprint" TEXT,
    "insightId" TEXT,
    "personId" TEXT,
    "companyId" TEXT,
    "taskId" TEXT,
    "decisionId" TEXT,
    "goalId" TEXT,
    "dealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayPlan" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "briefReviewedAt" TIMESTAMP(3),
    "top5ConfirmedAt" TIMESTAMP(3),
    "endOfDayAt" TIMESTAMP(3),
    "endOfDayNotes" TEXT,
    "intention" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DayPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPriority" (
    "id" TEXT NOT NULL,
    "dayPlanId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT,
    "source" "PrioritySource" NOT NULL DEFAULT 'BRAIN',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyPriority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'CEO',
    "metadata" JSONB,
    "taskId" TEXT,
    "goalId" TEXT,
    "milestoneId" TEXT,
    "decisionId" TEXT,
    "meetingId" TEXT,
    "companyId" TEXT,
    "personId" TEXT,
    "delegationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'CEO',
    "taskId" TEXT,
    "goalId" TEXT,
    "milestoneId" TEXT,
    "decisionId" TEXT,
    "meetingId" TEXT,
    "personId" TEXT,
    "companyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "type" "ReviewType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "whatWorked" TEXT,
    "whatDidnt" TEXT,
    "learned" TEXT,
    "changeNext" TEXT,
    "snapshot" JSONB,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatThread" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "engine" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ResourceCompanies" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ResourceCompanies_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_DecisionCompanies" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_DecisionCompanies_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TaskPeople" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TaskPeople_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ResourcePeople" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ResourcePeople_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ResourceGoals" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ResourceGoals_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ResourceMilestones" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ResourceMilestones_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TaskDependencies" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TaskDependencies_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ResourceDecisions" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ResourceDecisions_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ResourceTasks" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ResourceTasks_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_MeetingAttendees" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_MeetingAttendees_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_personId_key" ON "User"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategicPillar_name_key" ON "StrategicPillar"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- CreateIndex
CREATE INDEX "Person_type_idx" ON "Person"("type");

-- CreateIndex
CREATE INDEX "Person_companyId_idx" ON "Person"("companyId");

-- CreateIndex
CREATE INDEX "Goal_type_status_idx" ON "Goal"("type", "status");

-- CreateIndex
CREATE INDEX "Goal_pillarId_idx" ON "Goal"("pillarId");

-- CreateIndex
CREATE INDEX "Milestone_dueDate_idx" ON "Milestone"("dueDate");

-- CreateIndex
CREATE INDEX "Milestone_status_idx" ON "Milestone"("status");

-- CreateIndex
CREATE INDEX "Milestone_goalId_idx" ON "Milestone"("goalId");

-- CreateIndex
CREATE INDEX "Task_status_dueDate_idx" ON "Task"("status", "dueDate");

-- CreateIndex
CREATE INDEX "Task_ownerId_idx" ON "Task"("ownerId");

-- CreateIndex
CREATE INDEX "Task_goalId_idx" ON "Task"("goalId");

-- CreateIndex
CREATE INDEX "Task_milestoneId_idx" ON "Task"("milestoneId");

-- CreateIndex
CREATE INDEX "Task_priorityScore_idx" ON "Task"("priorityScore");

-- CreateIndex
CREATE INDEX "Task_completedAt_idx" ON "Task"("completedAt");

-- CreateIndex
CREATE INDEX "Decision_status_deadline_idx" ON "Decision"("status", "deadline");

-- CreateIndex
CREATE INDEX "Resource_type_idx" ON "Resource"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Delegation_taskId_key" ON "Delegation"("taskId");

-- CreateIndex
CREATE INDEX "Delegation_status_idx" ON "Delegation"("status");

-- CreateIndex
CREATE INDEX "Deal_type_status_idx" ON "Deal"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_externalId_key" ON "Meeting"("externalId");

-- CreateIndex
CREATE INDEX "Meeting_startsAt_idx" ON "Meeting"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Metric_key_key" ON "Metric"("key");

-- CreateIndex
CREATE INDEX "Metric_category_idx" ON "Metric"("category");

-- CreateIndex
CREATE UNIQUE INDEX "MetricValue_metricId_recordedAt_key" ON "MetricValue"("metricId", "recordedAt");

-- CreateIndex
CREATE INDEX "TimeEntry_date_idx" ON "TimeEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "BrainSource_key_key" ON "BrainSource"("key");

-- CreateIndex
CREATE INDEX "BrainSignal_processedAt_idx" ON "BrainSignal"("processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrainSignal_sourceId_externalId_key" ON "BrainSignal"("sourceId", "externalId");

-- CreateIndex
CREATE INDEX "BrainRefresh_startedAt_idx" ON "BrainRefresh"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BrainInsight_fingerprint_key" ON "BrainInsight"("fingerprint");

-- CreateIndex
CREATE INDEX "BrainInsight_type_status_idx" ON "BrainInsight"("type", "status");

-- CreateIndex
CREATE INDEX "BrainInsight_createdAt_idx" ON "BrainInsight"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyBrief_date_key" ON "DailyBrief"("date");

-- CreateIndex
CREATE UNIQUE INDEX "InboxItem_fingerprint_key" ON "InboxItem"("fingerprint");

-- CreateIndex
CREATE INDEX "InboxItem_status_urgency_idx" ON "InboxItem"("status", "urgency");

-- CreateIndex
CREATE UNIQUE INDEX "DayPlan_date_key" ON "DayPlan"("date");

-- CreateIndex
CREATE INDEX "DailyPriority_dayPlanId_rank_idx" ON "DailyPriority"("dayPlanId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPriority_dayPlanId_taskId_key" ON "DailyPriority"("dayPlanId", "taskId");

-- CreateIndex
CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");

-- CreateIndex
CREATE INDEX "Activity_type_idx" ON "Activity"("type");

-- CreateIndex
CREATE INDEX "Note_createdAt_idx" ON "Note"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_type_periodStart_key" ON "Review"("type", "periodStart");

-- CreateIndex
CREATE INDEX "ChatMessage_threadId_createdAt_idx" ON "ChatMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "_ResourceCompanies_B_index" ON "_ResourceCompanies"("B");

-- CreateIndex
CREATE INDEX "_DecisionCompanies_B_index" ON "_DecisionCompanies"("B");

-- CreateIndex
CREATE INDEX "_TaskPeople_B_index" ON "_TaskPeople"("B");

-- CreateIndex
CREATE INDEX "_ResourcePeople_B_index" ON "_ResourcePeople"("B");

-- CreateIndex
CREATE INDEX "_ResourceGoals_B_index" ON "_ResourceGoals"("B");

-- CreateIndex
CREATE INDEX "_ResourceMilestones_B_index" ON "_ResourceMilestones"("B");

-- CreateIndex
CREATE INDEX "_TaskDependencies_B_index" ON "_TaskDependencies"("B");

-- CreateIndex
CREATE INDEX "_ResourceDecisions_B_index" ON "_ResourceDecisions"("B");

-- CreateIndex
CREATE INDEX "_ResourceTasks_B_index" ON "_ResourceTasks"("B");

-- CreateIndex
CREATE INDEX "_MeetingAttendees_B_index" ON "_MeetingAttendees"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "StrategicPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "StrategicPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_suggestedDelegateId_fkey" FOREIGN KEY ("suggestedDelegateId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "StrategicPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "StrategicPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionOption" ADD CONSTRAINT "DecisionOption_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_pillarId_fkey" FOREIGN KEY ("pillarId") REFERENCES "StrategicPillar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricValue" ADD CONSTRAINT "MetricValue_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "Metric"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainSignal" ADD CONSTRAINT "BrainSignal_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "BrainSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainSignal" ADD CONSTRAINT "BrainSignal_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainSignal" ADD CONSTRAINT "BrainSignal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainSignal" ADD CONSTRAINT "BrainSignal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "BrainRefresh"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "BrainSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainInsight" ADD CONSTRAINT "BrainInsight_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyBrief" ADD CONSTRAINT "DailyBrief_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "BrainRefresh"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "BrainInsight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboxItem" ADD CONSTRAINT "InboxItem_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPriority" ADD CONSTRAINT "DailyPriority_dayPlanId_fkey" FOREIGN KEY ("dayPlanId") REFERENCES "DayPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPriority" ADD CONSTRAINT "DailyPriority_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_delegationId_fkey" FOREIGN KEY ("delegationId") REFERENCES "Delegation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatThread" ADD CONSTRAINT "ChatThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "ChatThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceCompanies" ADD CONSTRAINT "_ResourceCompanies_A_fkey" FOREIGN KEY ("A") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceCompanies" ADD CONSTRAINT "_ResourceCompanies_B_fkey" FOREIGN KEY ("B") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DecisionCompanies" ADD CONSTRAINT "_DecisionCompanies_A_fkey" FOREIGN KEY ("A") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_DecisionCompanies" ADD CONSTRAINT "_DecisionCompanies_B_fkey" FOREIGN KEY ("B") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskPeople" ADD CONSTRAINT "_TaskPeople_A_fkey" FOREIGN KEY ("A") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskPeople" ADD CONSTRAINT "_TaskPeople_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourcePeople" ADD CONSTRAINT "_ResourcePeople_A_fkey" FOREIGN KEY ("A") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourcePeople" ADD CONSTRAINT "_ResourcePeople_B_fkey" FOREIGN KEY ("B") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceGoals" ADD CONSTRAINT "_ResourceGoals_A_fkey" FOREIGN KEY ("A") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceGoals" ADD CONSTRAINT "_ResourceGoals_B_fkey" FOREIGN KEY ("B") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceMilestones" ADD CONSTRAINT "_ResourceMilestones_A_fkey" FOREIGN KEY ("A") REFERENCES "Milestone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceMilestones" ADD CONSTRAINT "_ResourceMilestones_B_fkey" FOREIGN KEY ("B") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskDependencies" ADD CONSTRAINT "_TaskDependencies_A_fkey" FOREIGN KEY ("A") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TaskDependencies" ADD CONSTRAINT "_TaskDependencies_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceDecisions" ADD CONSTRAINT "_ResourceDecisions_A_fkey" FOREIGN KEY ("A") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceDecisions" ADD CONSTRAINT "_ResourceDecisions_B_fkey" FOREIGN KEY ("B") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceTasks" ADD CONSTRAINT "_ResourceTasks_A_fkey" FOREIGN KEY ("A") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ResourceTasks" ADD CONSTRAINT "_ResourceTasks_B_fkey" FOREIGN KEY ("B") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MeetingAttendees" ADD CONSTRAINT "_MeetingAttendees_A_fkey" FOREIGN KEY ("A") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MeetingAttendees" ADD CONSTRAINT "_MeetingAttendees_B_fkey" FOREIGN KEY ("B") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
