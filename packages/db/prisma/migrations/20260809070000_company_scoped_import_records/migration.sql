-- Complete the company-scoping rollout for migration evidence and idempotency.
-- Existing organizations receive their immutable default company from the
-- multi-company foundation migration. Rows are backfilled before constraints
-- become required so historical source provenance remains intact.

ALTER TABLE "DataImportBatch" ADD COLUMN "companyId" UUID;
ALTER TABLE "DataImportRow" ADD COLUMN "companyId" UUID;
ALTER TABLE "HistoricalImportRecord" ADD COLUMN "companyId" UUID;
ALTER TABLE "IdempotencyRecord" ADD COLUMN "companyId" UUID;

UPDATE "DataImportBatch" batch
SET "companyId" = company.id
FROM "Company" company
WHERE company."organizationId" = batch."organizationId"
  AND company."isDefault" = true;

UPDATE "DataImportRow" row
SET "companyId" = batch."companyId"
FROM "DataImportBatch" batch
WHERE batch.id = row."batchId"
  AND batch."organizationId" = row."organizationId";

UPDATE "HistoricalImportRecord" record
SET "companyId" = batch."companyId"
FROM "DataImportBatch" batch
WHERE batch.id = record."batchId"
  AND batch."organizationId" = record."organizationId";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "DataImportBatch" WHERE "companyId" IS NULL)
     OR EXISTS (SELECT 1 FROM "DataImportRow" WHERE "companyId" IS NULL)
     OR EXISTS (SELECT 1 FROM "HistoricalImportRecord" WHERE "companyId" IS NULL) THEN
    RAISE EXCEPTION 'Every existing import record must resolve to a default company before company scoping is enabled';
  END IF;
END $$;

ALTER TABLE "DataImportBatch" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "DataImportRow" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "HistoricalImportRecord" ALTER COLUMN "companyId" SET NOT NULL;

DROP INDEX IF EXISTS "DataImportBatch_organizationId_importType_checksum_key";
DROP INDEX IF EXISTS "DataImportBatch_organizationId_status_createdAt_idx";
DROP INDEX IF EXISTS "DataImportRow_organizationId_status_idx";
DROP INDEX IF EXISTS "HistoricalImportRecord_organizationId_recordType_occurredAt_idx";

CREATE UNIQUE INDEX "DataImportBatch_organizationId_companyId_importType_checksu_key"
  ON "DataImportBatch"("organizationId", "companyId", "importType", "checksum");
CREATE UNIQUE INDEX "DataImportBatch_organizationId_companyId_id_key"
  ON "DataImportBatch"("organizationId", "companyId", "id");
CREATE INDEX "DataImportBatch_organizationId_companyId_status_createdAt_idx"
  ON "DataImportBatch"("organizationId", "companyId", "status", "createdAt");
CREATE INDEX "DataImportRow_organizationId_companyId_status_idx"
  ON "DataImportRow"("organizationId", "companyId", "status");
CREATE INDEX "HistoricalImportRecord_organizationId_companyId_recordType__idx"
  ON "HistoricalImportRecord"("organizationId", "companyId", "recordType", "occurredAt");

ALTER TABLE "DataImportBatch"
  ADD CONSTRAINT "DataImportBatch_organizationId_companyId_fkey"
  FOREIGN KEY ("organizationId", "companyId")
  REFERENCES "Company"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "DataImportRow"
  DROP CONSTRAINT IF EXISTS "DataImportRow_batch_tenant_fkey";
ALTER TABLE "DataImportRow"
  ADD CONSTRAINT "DataImportRow_organizationId_companyId_fkey"
  FOREIGN KEY ("organizationId", "companyId")
  REFERENCES "Company"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "DataImportRow"
  ADD CONSTRAINT "DataImportRow_organizationId_companyId_batchId_fkey"
  FOREIGN KEY ("organizationId", "companyId", "batchId")
  REFERENCES "DataImportBatch"("organizationId", "companyId", "id") ON DELETE CASCADE;
ALTER TABLE "HistoricalImportRecord"
  DROP CONSTRAINT IF EXISTS "HistoricalImportRecord_batch_tenant_fkey";
ALTER TABLE "HistoricalImportRecord"
  ADD CONSTRAINT "HistoricalImportRecord_organizationId_companyId_fkey"
  FOREIGN KEY ("organizationId", "companyId")
  REFERENCES "Company"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "HistoricalImportRecord"
  ADD CONSTRAINT "HistoricalImportRecord_organizationId_companyId_batchId_fkey"
  FOREIGN KEY ("organizationId", "companyId", "batchId")
  REFERENCES "DataImportBatch"("organizationId", "companyId", "id") ON DELETE RESTRICT;

DROP POLICY IF EXISTS "DataImportBatch_tenant_policy" ON "DataImportBatch";
CREATE POLICY "DataImportBatch_tenant_policy" ON "DataImportBatch"
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
DROP POLICY IF EXISTS "DataImportRow_tenant_policy" ON "DataImportRow";
CREATE POLICY "DataImportRow_tenant_policy" ON "DataImportRow"
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
DROP POLICY IF EXISTS "HistoricalImportRecord_tenant_policy" ON "HistoricalImportRecord";
CREATE POLICY "HistoricalImportRecord_tenant_policy" ON "HistoricalImportRecord"
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
