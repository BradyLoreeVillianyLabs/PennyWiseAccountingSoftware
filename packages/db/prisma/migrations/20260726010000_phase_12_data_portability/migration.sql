CREATE TYPE "DataImportType" AS ENUM (
  'CHART_OF_ACCOUNTS', 'CUSTOMERS', 'VENDORS', 'PRODUCTS',
  'OPENING_BALANCES', 'OUTSTANDING_INVOICES', 'OUTSTANDING_BILLS',
  'CUSTOMER_CREDITS', 'VENDOR_CREDITS', 'INVENTORY_OPENING',
  'HISTORICAL_ARCHIVE'
);
CREATE TYPE "DataImportStatus" AS ENUM (
  'UPLOADED', 'VALIDATED', 'PREVIEWED', 'DRY_RUN', 'COMMITTING',
  'COMMITTED', 'RECONCILED', 'FAILED', 'COMPENSATION_REQUIRED'
);
CREATE TYPE "DataImportRowStatus" AS ENUM (
  'PENDING', 'VALID', 'INVALID', 'IMPORTED', 'SKIPPED', 'FAILED'
);
CREATE TYPE "OrganizationExportStatus" AS ENUM (
  'PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED'
);
CREATE TYPE "OrganizationClosureStatus" AS ENUM (
  'REQUESTED', 'EXPORT_PENDING', 'RETENTION_SCHEDULED', 'LEGAL_HOLD',
  'CANCELLED'
);

CREATE TABLE "DataImportBatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "importType" "DataImportType" NOT NULL,
  "status" "DataImportStatus" NOT NULL DEFAULT 'UPLOADED',
  "sourceFilename" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "mapping" JSONB,
  "errorReport" JSONB,
  "reconciliation" JSONB,
  "committedAt" TIMESTAMPTZ(6),
  "acknowledgedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DataImportBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataImportBatch_byte_size_check" CHECK ("byteSize" > 0 AND "byteSize" <= 5242880)
);

CREATE TABLE "DataImportRow" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "status" "DataImportRowStatus" NOT NULL DEFAULT 'PENDING',
  "rawData" JSONB NOT NULL,
  "mappedData" JSONB,
  "errors" JSONB,
  "externalId" TEXT,
  "createdResourceType" TEXT,
  "createdResourceId" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataImportRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DataImportRow_number_check" CHECK ("rowNumber" > 1)
);

CREATE TABLE "HistoricalImportRecord" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "externalId" TEXT,
  "recordType" TEXT NOT NULL,
  "occurredAt" TIMESTAMPTZ(6),
  "originalData" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HistoricalImportRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationExportJob" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "status" "OrganizationExportStatus" NOT NULL DEFAULT 'PENDING',
  "includeAttachments" BOOLEAN NOT NULL DEFAULT false,
  "storageKey" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "checksum" CHAR(64),
  "byteSize" INTEGER,
  "downloadTokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "errorMessage" TEXT,
  "requestedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(6),
  "completedAt" TIMESTAMPTZ(6),
  CONSTRAINT "OrganizationExportJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationExportJob_size_check" CHECK ("byteSize" IS NULL OR "byteSize" >= 0)
);

CREATE TABLE "OrganizationClosureRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "status" "OrganizationClosureStatus" NOT NULL DEFAULT 'REQUESTED',
  "reason" TEXT NOT NULL,
  "exportJobId" UUID,
  "legalHold" BOOLEAN NOT NULL DEFAULT false,
  "retentionUntil" TIMESTAMPTZ(6),
  "scheduledDeletionAt" TIMESTAMPTZ(6),
  "requestedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrganizationClosureRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DataImportBatch_storageKey_key" ON "DataImportBatch"("storageKey");
CREATE UNIQUE INDEX "DataImportBatch_organizationId_importType_checksum_key"
  ON "DataImportBatch"("organizationId", "importType", "checksum");
CREATE UNIQUE INDEX "DataImportBatch_organizationId_id_key"
  ON "DataImportBatch"("organizationId", "id");
CREATE INDEX "DataImportBatch_organizationId_status_createdAt_idx"
  ON "DataImportBatch"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "DataImportRow_batchId_rowNumber_key"
  ON "DataImportRow"("batchId", "rowNumber");
CREATE INDEX "DataImportRow_organizationId_status_idx"
  ON "DataImportRow"("organizationId", "status");
CREATE INDEX "HistoricalImportRecord_organizationId_recordType_occurredAt_idx"
  ON "HistoricalImportRecord"("organizationId", "recordType", "occurredAt");
CREATE UNIQUE INDEX "OrganizationExportJob_storageKey_key"
  ON "OrganizationExportJob"("storageKey");
CREATE UNIQUE INDEX "OrganizationExportJob_downloadTokenHash_key"
  ON "OrganizationExportJob"("downloadTokenHash");
CREATE UNIQUE INDEX "OrganizationExportJob_organizationId_id_key"
  ON "OrganizationExportJob"("organizationId", "id");
CREATE INDEX "OrganizationExportJob_organizationId_status_createdAt_idx"
  ON "OrganizationExportJob"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "OrganizationClosureRequest_organizationId_id_key"
  ON "OrganizationClosureRequest"("organizationId", "id");
CREATE INDEX "OrganizationClosureRequest_organizationId_status_createdAt_idx"
  ON "OrganizationClosureRequest"("organizationId", "status", "createdAt");

ALTER TABLE "DataImportBatch" ADD CONSTRAINT "DataImportBatch_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "DataImportRow" ADD CONSTRAINT "DataImportRow_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "DataImportRow" ADD CONSTRAINT "DataImportRow_batch_tenant_fkey"
  FOREIGN KEY ("organizationId", "batchId")
  REFERENCES "DataImportBatch"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "HistoricalImportRecord" ADD CONSTRAINT "HistoricalImportRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "HistoricalImportRecord" ADD CONSTRAINT "HistoricalImportRecord_batch_tenant_fkey"
  FOREIGN KEY ("organizationId", "batchId")
  REFERENCES "DataImportBatch"("organizationId", "id") ON DELETE RESTRICT;
ALTER TABLE "OrganizationExportJob" ADD CONSTRAINT "OrganizationExportJob_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "OrganizationClosureRequest" ADD CONSTRAINT "OrganizationClosureRequest_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "OrganizationClosureRequest" ADD CONSTRAINT "OrganizationClosureRequest_export_tenant_fkey"
  FOREIGN KEY ("organizationId", "exportJobId")
  REFERENCES "OrganizationExportJob"("organizationId", "id") ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION phase12_import_evidence_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  batch_status "DataImportStatus";
  linked_batch_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'HistoricalImportRecord' THEN
    RAISE EXCEPTION 'Historical import records are append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN linked_batch_id := OLD."batchId";
  ELSE linked_batch_id := NEW."batchId"; END IF;
  SELECT status INTO batch_status
    FROM "DataImportBatch"
   WHERE id = linked_batch_id;
  IF batch_status IN ('COMMITTED', 'RECONCILED', 'COMPENSATION_REQUIRED') THEN
    RAISE EXCEPTION 'Committed import rows are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DataImportRow_evidence_trigger"
  BEFORE UPDATE OR DELETE ON "DataImportRow"
  FOR EACH ROW EXECUTE FUNCTION phase12_import_evidence_guard();
CREATE TRIGGER "HistoricalImportRecord_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "HistoricalImportRecord"
  FOR EACH ROW EXECUTE FUNCTION phase12_import_evidence_guard();

CREATE OR REPLACE FUNCTION phase12_import_batch_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId"
    OR NEW."importType" <> OLD."importType"
    OR NEW."sourceFilename" <> OLD."sourceFilename"
    OR NEW."storageKey" <> OLD."storageKey"
    OR NEW."mediaType" <> OLD."mediaType"
    OR NEW."byteSize" <> OLD."byteSize"
    OR NEW.checksum <> OLD.checksum
    OR NEW."createdByUserId" <> OLD."createdByUserId"
    OR NEW."createdAt" <> OLD."createdAt"
  THEN RAISE EXCEPTION 'Import source evidence is immutable'; END IF;
  IF OLD.status IN ('COMMITTED', 'RECONCILED', 'COMPENSATION_REQUIRED')
    AND NEW.status NOT IN ('RECONCILED', OLD.status)
  THEN RAISE EXCEPTION 'Final import status cannot move backward'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "DataImportBatch_evidence_trigger"
  BEFORE UPDATE ON "DataImportBatch"
  FOR EACH ROW EXECUTE FUNCTION phase12_import_batch_guard();

GRANT SELECT, INSERT, UPDATE ON "DataImportBatch", "DataImportRow",
  "OrganizationExportJob", "OrganizationClosureRequest" TO clearledger_runtime;
GRANT SELECT, INSERT ON "HistoricalImportRecord" TO clearledger_runtime;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'DataImportBatch', 'DataImportRow', 'HistoricalImportRecord',
    'OrganizationExportJob', 'OrganizationClosureRequest'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING (
        "organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()
      ) WITH CHECK (
        "organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()
      )',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;
