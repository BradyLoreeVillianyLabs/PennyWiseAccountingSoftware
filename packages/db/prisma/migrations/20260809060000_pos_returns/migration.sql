CREATE TYPE "PosReturnStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TABLE "PosReturn" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "saleId" UUID NOT NULL,
  "creditNoteId" UUID,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "status" "PosReturnStatus" NOT NULL DEFAULT 'PENDING',
  "totalMinor" BIGINT NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosReturn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PosReturn_organizationId_id_key" ON "PosReturn"("organizationId", "id");
CREATE UNIQUE INDEX "PosReturn_organizationId_idempotencyKey_key" ON "PosReturn"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "PosReturn_creditNoteId_key" ON "PosReturn"("creditNoteId");
CREATE INDEX "PosReturn_organizationId_saleId_status_idx" ON "PosReturn"("organizationId", "saleId", "status");
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosReturn" ADD CONSTRAINT "PosReturn_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE OR REPLACE FUNCTION pos_return_company_guard() RETURNS trigger AS $$
DECLARE sale_company UUID;
BEGIN
  SELECT "companyId" INTO sale_company FROM "PosSale" WHERE id = NEW."saleId";
  IF sale_company IS NULL OR sale_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'POS return company mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PosReturn_company_guard" BEFORE INSERT OR UPDATE ON "PosReturn" FOR EACH ROW EXECUTE FUNCTION pos_return_company_guard();
ALTER TABLE "PosReturn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PosReturn" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PosReturn_tenant_policy" ON "PosReturn" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access() AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id()))
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access() AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id()));
GRANT SELECT, INSERT, UPDATE ON "PosReturn" TO clearledger_runtime;
