-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'MEETINGS_SYNC';
ALTER TYPE "JobType" ADD VALUE 'BUSINESS_SYNC';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SourceKind" ADD VALUE 'MEETINGS';
ALTER TYPE "SourceKind" ADD VALUE 'CRM';
ALTER TYPE "SourceKind" ADD VALUE 'FINANCE';
ALTER TYPE "SourceKind" ADD VALUE 'CONTRACTS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SourceProvider" ADD VALUE 'TEAMS_CHAT';
ALTER TYPE "SourceProvider" ADD VALUE 'GRANOLA';
ALTER TYPE "SourceProvider" ADD VALUE 'READ_AI';
ALTER TYPE "SourceProvider" ADD VALUE 'HUBSPOT';
ALTER TYPE "SourceProvider" ADD VALUE 'QUICKBOOKS';
ALTER TYPE "SourceProvider" ADD VALUE 'BREX';
ALTER TYPE "SourceProvider" ADD VALUE 'DOCUSIGN';

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalSource" TEXT,
ADD COLUMN     "pipeline" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Deal_externalSource_externalId_key" ON "Deal"("externalSource", "externalId");


-- Placeholder connectors that never had an implementation leave the catalog.
-- Metrics that pointed at them are recorded by hand until a real source exists.
UPDATE "Metric" SET "sourceKey" = 'manual' WHERE "sourceKey" IN ('finance', 'eln-lims', 'hris');
DELETE FROM "BrainSource" WHERE "key" IN ('finance', 'eln-lims', 'hris');
