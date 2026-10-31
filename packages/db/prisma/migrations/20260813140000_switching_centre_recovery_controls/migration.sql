ALTER TYPE "DataImportRowStatus" ADD VALUE IF NOT EXISTS 'STAGED' BEFORE 'IMPORTED';
ALTER TYPE "DataImportStatus" ADD VALUE IF NOT EXISTS 'RETRYABLE' AFTER 'COMMITTING';
CREATE TYPE "DataImportCommitAttemptStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

ALTER TABLE "DataImportBatch"
  ADD COLUMN "sourceMetadata" JSONB,
  ADD COLUMN "sourceControls" JSONB,
  ADD COLUMN "commitStartedAt" TIMESTAMPTZ(6),
  ADD COLUMN "commitLeaseExpiresAt" TIMESTAMPTZ(6);

CREATE TABLE "DataImportCommitAttempt" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "unitKey" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "DataImportCommitAttemptStatus" NOT NULL DEFAULT 'STARTED',
  "attemptNumber" INTEGER NOT NULL DEFAULT 1,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "error" JSONB,
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DataImportCommitAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataImportCommitAttempt_organizationId_companyId_batchId_unitKey_key"
  ON "DataImportCommitAttempt"("organizationId", "companyId", "batchId", "unitKey");
CREATE INDEX "DataImportCommitAttempt_organizationId_companyId_batchId_status_idx"
  ON "DataImportCommitAttempt"("organizationId", "companyId", "batchId", "status");

ALTER TABLE "DataImportCommitAttempt"
  ADD CONSTRAINT "DataImportCommitAttempt_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataImportCommitAttempt"
  ADD CONSTRAINT "DataImportCommitAttempt_organizationId_companyId_fkey"
  FOREIGN KEY ("organizationId", "companyId") REFERENCES "Company"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DataImportCommitAttempt"
  ADD CONSTRAINT "DataImportCommitAttempt_organizationId_companyId_batchId_fkey"
  FOREIGN KEY ("organizationId", "companyId", "batchId") REFERENCES "DataImportBatch"("organizationId", "companyId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DataImportCommitAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DataImportCommitAttempt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DataImportCommitAttempt_tenant_policy"
  ON "DataImportCommitAttempt"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  );
GRANT SELECT, INSERT, UPDATE ON "DataImportCommitAttempt" TO clearledger_runtime;

CREATE OR REPLACE FUNCTION phase12_import_batch_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD.status = 'UPLOADED' AND NEW.status NOT IN ('UPLOADED', 'VALIDATED', 'PREVIEWED'))
    OR (OLD.status = 'VALIDATED' AND NEW.status NOT IN ('VALIDATED', 'PREVIEWED'))
    OR (
      OLD.status = 'PREVIEWED'
      AND NEW.status NOT IN ('PREVIEWED', 'VALIDATED', 'DRY_RUN')
    )
    OR (
      OLD.status = 'DRY_RUN'
      AND NEW.status NOT IN ('DRY_RUN', 'PREVIEWED', 'VALIDATED', 'COMMITTING')
    )
    OR (
      OLD.status = 'COMMITTING'
      AND NEW.status NOT IN ('COMMITTING', 'COMMITTED', 'RETRYABLE', 'FAILED', 'COMPENSATION_REQUIRED')
    )
    OR (
      OLD.status = 'RETRYABLE'
      AND NEW.status NOT IN ('RETRYABLE', 'COMMITTING', 'COMPENSATION_REQUIRED')
    )
    OR (
      OLD.status = 'FAILED'
      AND NEW.status NOT IN ('FAILED', 'VALIDATED', 'PREVIEWED')
    )
    OR (
      OLD.status = 'COMMITTED'
      AND NEW.status NOT IN ('COMMITTED', 'RECONCILED')
    )
    OR (OLD.status = 'RECONCILED' AND NEW.status <> 'RECONCILED')
    OR (OLD.status = 'COMPENSATION_REQUIRED' AND NEW.status <> 'COMPENSATION_REQUIRED')
  THEN
    RAISE EXCEPTION 'Invalid import batch status transition';
  END IF;
  IF NEW.status IN ('FAILED', 'RETRYABLE', 'COMPENSATION_REQUIRED') AND NEW."errorReport" IS NULL THEN
    RAISE EXCEPTION 'Failed import state requires error evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION phase12_import_batch_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId"
    OR NEW."companyId" <> OLD."companyId"
    OR NEW."importType" <> OLD."importType"
    OR NEW."sourceSystem" <> OLD."sourceSystem"
    OR NEW."sourceFilename" <> OLD."sourceFilename"
    OR NEW."storageKey" <> OLD."storageKey"
    OR NEW."mediaType" <> OLD."mediaType"
    OR NEW."byteSize" <> OLD."byteSize"
    OR NEW.checksum <> OLD.checksum
    OR NEW."sourceMetadata" IS DISTINCT FROM OLD."sourceMetadata"
    OR NEW."createdByUserId" <> OLD."createdByUserId"
    OR NEW."createdAt" <> OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Import source evidence is immutable';
  END IF;
  IF OLD.status IN ('RECONCILED', 'COMPENSATION_REQUIRED')
    AND NEW IS DISTINCT FROM OLD
  THEN
    RAISE EXCEPTION 'Final import evidence is immutable';
  END IF;
  IF OLD.status = 'COMMITTED' AND NEW.status NOT IN ('COMMITTED', 'RECONCILED') THEN
    RAISE EXCEPTION 'Committed import status cannot move backward';
  END IF;
  IF NEW.status = 'COMMITTED'
    AND (NEW."committedAt" IS NULL OR NEW.reconciliation IS NULL)
  THEN
    RAISE EXCEPTION 'Committed import requires reconciliation evidence';
  END IF;
  IF NEW.status = 'RECONCILED' AND NEW."acknowledgedAt" IS NULL THEN
    RAISE EXCEPTION 'Reconciled import requires acknowledgement evidence';
  END IF;
  RETURN NEW;
END;
$$;
