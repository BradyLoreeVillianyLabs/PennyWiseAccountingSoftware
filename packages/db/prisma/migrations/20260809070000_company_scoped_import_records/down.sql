-- Reverse the company-scoping change when the import tables are present. On
-- the verifier replay pass those tables have already been removed by this
-- same down chain, so the guarded block intentionally becomes a no-op.
DO $$
BEGIN
  IF to_regclass('public."DataImportBatch"') IS NULL
     OR to_regclass('public."DataImportRow"') IS NULL
     OR to_regclass('public."HistoricalImportRecord"') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "DataImportBatch_tenant_policy" ON "DataImportBatch";
  DROP POLICY IF EXISTS "DataImportRow_tenant_policy" ON "DataImportRow";
  DROP POLICY IF EXISTS "HistoricalImportRecord_tenant_policy" ON "HistoricalImportRecord";

  ALTER TABLE "DataImportRow"
    DROP CONSTRAINT IF EXISTS "DataImportRow_organizationId_companyId_batchId_fkey",
    DROP CONSTRAINT IF EXISTS "DataImportRow_organizationId_companyId_fkey";
  ALTER TABLE "HistoricalImportRecord"
    DROP CONSTRAINT IF EXISTS "HistoricalImportRecord_organizationId_companyId_batchId_fkey",
    DROP CONSTRAINT IF EXISTS "HistoricalImportRecord_organizationId_companyId_fkey";
  ALTER TABLE "DataImportBatch"
    DROP CONSTRAINT IF EXISTS "DataImportBatch_organizationId_companyId_fkey";

  DROP INDEX IF EXISTS "DataImportBatch_organizationId_companyId_importType_checksu_key";
  DROP INDEX IF EXISTS "DataImportBatch_organizationId_companyId_id_key";
  DROP INDEX IF EXISTS "DataImportBatch_organizationId_companyId_status_createdAt_idx";
  DROP INDEX IF EXISTS "DataImportRow_organizationId_companyId_status_idx";
  DROP INDEX IF EXISTS "HistoricalImportRecord_organizationId_companyId_recordType__idx";

  ALTER TABLE "DataImportRow"
    ADD CONSTRAINT "DataImportRow_batch_tenant_fkey"
    FOREIGN KEY ("organizationId", "batchId")
    REFERENCES "DataImportBatch"("organizationId", "id") ON DELETE CASCADE;
  ALTER TABLE "HistoricalImportRecord"
    ADD CONSTRAINT "HistoricalImportRecord_batch_tenant_fkey"
    FOREIGN KEY ("organizationId", "batchId")
    REFERENCES "DataImportBatch"("organizationId", "id") ON DELETE RESTRICT;

  CREATE UNIQUE INDEX "DataImportBatch_organizationId_importType_checksum_key"
    ON "DataImportBatch"("organizationId", "importType", "checksum");
  CREATE INDEX "DataImportBatch_organizationId_status_createdAt_idx"
    ON "DataImportBatch"("organizationId", "status", "createdAt");
  CREATE INDEX "DataImportRow_organizationId_status_idx"
    ON "DataImportRow"("organizationId", "status");
  CREATE INDEX "HistoricalImportRecord_organizationId_recordType_occurredAt_idx"
    ON "HistoricalImportRecord"("organizationId", "recordType", "occurredAt");

  ALTER TABLE "DataImportBatch" DROP COLUMN IF EXISTS "companyId";
  ALTER TABLE "DataImportRow" DROP COLUMN IF EXISTS "companyId";
  ALTER TABLE "HistoricalImportRecord" DROP COLUMN IF EXISTS "companyId";
  ALTER TABLE "IdempotencyRecord" DROP COLUMN IF EXISTS "companyId";

  CREATE POLICY "DataImportBatch_tenant_policy" ON "DataImportBatch"
    FOR ALL TO clearledger_runtime
    USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
    WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
  CREATE POLICY "DataImportRow_tenant_policy" ON "DataImportRow"
    FOR ALL TO clearledger_runtime
    USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
    WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
  CREATE POLICY "HistoricalImportRecord_tenant_policy" ON "HistoricalImportRecord"
    FOR ALL TO clearledger_runtime
    USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
    WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
END $$;
