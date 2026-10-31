CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "ProjectBillingMethod" AS ENUM ('FIXED', 'TIME_AND_MATERIALS', 'NON_BILLABLE');
CREATE TYPE "TimeEntryStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'LOCKED');
CREATE TYPE "CaptureReviewStatus" AS ENUM ('RECEIVED', 'REVIEW_REQUIRED', 'APPROVED', 'REJECTED');
CREATE TYPE "CaptureKind" AS ENUM ('RECEIPT', 'BILL');
CREATE TYPE "MileageStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'CONVERTED');

CREATE TABLE "Project" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "projectNumber" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "billingMethod" "ProjectBillingMethod" NOT NULL DEFAULT 'TIME_AND_MATERIALS',
  "startDate" DATE,
  "endDate" DATE,
  "budgetMinor" BIGINT,
  "tags" JSONB,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Project_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Project_organizationId_projectNumber_key" ON "Project"("organizationId", "projectNumber");
CREATE INDEX "Project_organizationId_customerId_status_idx" ON "Project"("organizationId", "customerId", "status");
CREATE INDEX "Project_organizationId_status_startDate_idx" ON "Project"("organizationId", "status", "startDate");

CREATE TABLE "ProjectTimeEntry" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "entryDate" DATE NOT NULL,
  "durationMicros" BIGINT NOT NULL,
  "rateMinor" BIGINT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "description" TEXT,
  "billable" BOOLEAN NOT NULL DEFAULT true,
  "status" "TimeEntryStatus" NOT NULL DEFAULT 'DRAFT',
  "startedAt" TIMESTAMPTZ(6),
  "endedAt" TIMESTAMPTZ(6),
  "approvedAt" TIMESTAMPTZ(6),
  "approvedByUserId" UUID,
  "correctionOfId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectTimeEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectTimeEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectTimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProjectTimeEntry_organizationId_projectId_entryDate_idx" ON "ProjectTimeEntry"("organizationId", "projectId", "entryDate");
CREATE INDEX "ProjectTimeEntry_organizationId_status_entryDate_idx" ON "ProjectTimeEntry"("organizationId", "status", "entryDate");

CREATE TABLE "MileageLog" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "projectId" UUID,
  "entryDate" DATE NOT NULL,
  "purpose" TEXT NOT NULL,
  "distanceMicros" BIGINT NOT NULL,
  "vehicleLabel" TEXT,
  "reimbursementRateMinor" BIGINT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "status" "MileageStatus" NOT NULL DEFAULT 'DRAFT',
  "attachmentReference" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MileageLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MileageLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MileageLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MileageLog_organizationId_projectId_entryDate_idx" ON "MileageLog"("organizationId", "projectId", "entryDate");
CREATE INDEX "MileageLog_organizationId_status_entryDate_idx" ON "MileageLog"("organizationId", "status", "entryDate");

CREATE TABLE "CaptureReview" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "projectId" UUID,
  "kind" "CaptureKind" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "mediaType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "scanStatus" TEXT NOT NULL,
  "ocrProvider" TEXT,
  "ocrVersion" TEXT,
  "ocrConfidence" DECIMAL(6,5),
  "extractedData" JSONB,
  "status" "CaptureReviewStatus" NOT NULL DEFAULT 'RECEIVED',
  "reviewNotes" TEXT,
  "reviewedByUserId" UUID,
  "reviewedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaptureReview_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaptureReview_organizationId_checksum_key" UNIQUE ("organizationId", "checksum"),
  CONSTRAINT "CaptureReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CaptureReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "CaptureReview_organizationId_status_createdAt_idx" ON "CaptureReview"("organizationId", "status", "createdAt");
CREATE INDEX "CaptureReview_organizationId_projectId_createdAt_idx" ON "CaptureReview"("organizationId", "projectId", "createdAt");

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Project', 'ProjectTimeEntry', 'MileageLog', 'CaptureReview']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END;
$$;
