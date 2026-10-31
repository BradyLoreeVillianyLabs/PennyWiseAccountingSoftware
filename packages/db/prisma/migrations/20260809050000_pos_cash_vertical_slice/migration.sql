CREATE TYPE "PosRegisterStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'RETIRED');
CREATE TYPE "PosShiftStatus" AS ENUM ('OPENING_COUNT', 'OPEN', 'CLOSING_COUNT', 'PENDING_REVIEW', 'CLOSED');
CREATE TYPE "PosSaleStatus" AS ENUM ('DRAFT', 'PAYMENT_PENDING', 'COMPLETED', 'VOIDED');
CREATE TYPE "PosTenderType" AS ENUM ('CASH', 'MANUAL');
CREATE TYPE "PosTenderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');
CREATE TYPE "PosCashEventType" AS ENUM ('OPENING_FLOAT', 'SALE', 'REFUND', 'PAID_IN', 'PAID_OUT', 'DROP', 'SAFE_TRANSFER', 'VARIANCE');

CREATE TABLE "PosRegister" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "inventoryLocationId" UUID NOT NULL,
  "cashAccountId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "PosRegisterStatus" NOT NULL DEFAULT 'DRAFT',
  "receiptPrefix" TEXT NOT NULL DEFAULT 'POS',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosRegister_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PosDevice" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "registerId" UUID NOT NULL,
  "deviceCode" TEXT NOT NULL,
  "deviceKeyHash" CHAR(64),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "enrolledAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(6),
  "lastSeenAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  CONSTRAINT "PosDevice_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PosShift" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "registerId" UUID NOT NULL,
  "deviceId" UUID,
  "status" "PosShiftStatus" NOT NULL DEFAULT 'OPENING_COUNT',
  "businessDate" DATE NOT NULL,
  "openingFloatMinor" BIGINT NOT NULL DEFAULT 0,
  "expectedCashMinor" BIGINT,
  "countedCashMinor" BIGINT,
  "varianceMinor" BIGINT,
  "openedByUserId" UUID NOT NULL,
  "closedByUserId" UUID,
  "openedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "PosShift_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PosSale" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "registerId" UUID NOT NULL,
  "deviceId" UUID,
  "shiftId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "invoiceId" UUID,
  "idempotencyKey" VARCHAR(200),
  "requestHash" CHAR(64),
  "receiptNumber" TEXT,
  "status" "PosSaleStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" CHAR(3) NOT NULL,
  "businessDate" DATE NOT NULL,
  "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
  "discountTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "grandTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PosSaleLine" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "saleId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "productItemId" UUID,
  "description" TEXT NOT NULL,
  "skuSnapshot" TEXT,
  "quantityMicros" BIGINT NOT NULL,
  "unitPriceMinor" BIGINT NOT NULL,
  "grossAmountMinor" BIGINT NOT NULL,
  "discountMinor" BIGINT NOT NULL DEFAULT 0,
  "netAmountMinor" BIGINT NOT NULL,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "totalMinor" BIGINT NOT NULL,
  "taxCodeId" UUID,
  "taxSnapshot" JSONB,
  "incomeAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosSaleLine_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PosTender" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "saleId" UUID NOT NULL,
  "paymentId" UUID,
  "type" "PosTenderType" NOT NULL DEFAULT 'CASH',
  "status" "PosTenderStatus" NOT NULL DEFAULT 'PENDING',
  "amountReceivedMinor" BIGINT NOT NULL,
  "appliedAmountMinor" BIGINT NOT NULL,
  "changeMinor" BIGINT NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "reference" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosTender_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PosCashEvent" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "shiftId" UUID NOT NULL,
  "saleId" UUID,
  "eventType" "PosCashEventType" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "reason" TEXT,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosCashEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosRegister_organizationId_code_key" ON "PosRegister"("organizationId", "code");
CREATE UNIQUE INDEX "PosRegister_organizationId_id_key" ON "PosRegister"("organizationId", "id");
CREATE INDEX "PosRegister_organizationId_companyId_status_idx" ON "PosRegister"("organizationId", "companyId", "status");
CREATE UNIQUE INDEX "PosDevice_organizationId_deviceCode_key" ON "PosDevice"("organizationId", "deviceCode");
CREATE UNIQUE INDEX "PosDevice_organizationId_id_key" ON "PosDevice"("organizationId", "id");
CREATE INDEX "PosDevice_organizationId_registerId_active_idx" ON "PosDevice"("organizationId", "registerId", "active");
CREATE UNIQUE INDEX "PosShift_organizationId_id_key" ON "PosShift"("organizationId", "id");
CREATE INDEX "PosShift_organizationId_registerId_status_idx" ON "PosShift"("organizationId", "registerId", "status");
CREATE INDEX "PosShift_organizationId_businessDate_idx" ON "PosShift"("organizationId", "businessDate");
CREATE UNIQUE INDEX "PosShift_one_active_register" ON "PosShift"("registerId") WHERE "status" IN ('OPENING_COUNT', 'OPEN', 'CLOSING_COUNT', 'PENDING_REVIEW');
CREATE UNIQUE INDEX "PosSale_organizationId_invoiceId_key" ON "PosSale"("invoiceId");
CREATE UNIQUE INDEX "PosSale_organizationId_id_key" ON "PosSale"("organizationId", "id");
CREATE UNIQUE INDEX "PosSale_organizationId_idempotencyKey_key" ON "PosSale"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "PosSale_organizationId_receiptNumber_key" ON "PosSale"("organizationId", "receiptNumber");
CREATE INDEX "PosSale_organizationId_companyId_status_businessDate_idx" ON "PosSale"("organizationId", "companyId", "status", "businessDate");
CREATE INDEX "PosSale_organizationId_shiftId_status_idx" ON "PosSale"("organizationId", "shiftId", "status");
CREATE UNIQUE INDEX "PosSaleLine_saleId_lineNumber_key" ON "PosSaleLine"("saleId", "lineNumber");
CREATE UNIQUE INDEX "PosSaleLine_organizationId_id_key" ON "PosSaleLine"("organizationId", "id");
CREATE INDEX "PosSaleLine_organizationId_productItemId_idx" ON "PosSaleLine"("organizationId", "productItemId");
CREATE UNIQUE INDEX "PosTender_organizationId_paymentId_key" ON "PosTender"("paymentId");
CREATE UNIQUE INDEX "PosTender_organizationId_id_key" ON "PosTender"("organizationId", "id");
CREATE INDEX "PosTender_organizationId_saleId_status_idx" ON "PosTender"("organizationId", "saleId", "status");
CREATE UNIQUE INDEX "PosCashEvent_organizationId_id_key" ON "PosCashEvent"("organizationId", "id");
CREATE INDEX "PosCashEvent_organizationId_shiftId_createdAt_idx" ON "PosCashEvent"("organizationId", "shiftId", "createdAt");
CREATE INDEX "PosCashEvent_organizationId_saleId_idx" ON "PosCashEvent"("organizationId", "saleId");

ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosRegister" ADD CONSTRAINT "PosRegister_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosDevice" ADD CONSTRAINT "PosDevice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosDevice" ADD CONSTRAINT "PosDevice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosDevice" ADD CONSTRAINT "PosDevice_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosShift" ADD CONSTRAINT "PosShift_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PosDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_registerId_fkey" FOREIGN KEY ("registerId") REFERENCES "PosRegister"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PosDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosSaleLine" ADD CONSTRAINT "PosSaleLine_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosTender" ADD CONSTRAINT "PosTender_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosTender" ADD CONSTRAINT "PosTender_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosTender" ADD CONSTRAINT "PosTender_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosTender" ADD CONSTRAINT "PosTender_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosCashEvent" ADD CONSTRAINT "PosCashEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosCashEvent" ADD CONSTRAINT "PosCashEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PosCashEvent" ADD CONSTRAINT "PosCashEvent_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PosCashEvent" ADD CONSTRAINT "PosCashEvent_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PosSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION pos_company_guard() RETURNS trigger AS $$
DECLARE ref_org UUID; ref_company UUID;
BEGIN
  SELECT "organizationId" INTO ref_org FROM "Company" WHERE id = NEW."companyId";
  IF ref_org IS NULL OR ref_org <> NEW."organizationId" THEN RAISE EXCEPTION 'POS company mismatch'; END IF;
  IF TG_TABLE_NAME = 'PosRegister' THEN
    SELECT "companyId" INTO ref_company FROM "InventoryLocation" WHERE id = NEW."inventoryLocationId";
    IF ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'POS location company mismatch'; END IF;
    SELECT "companyId" INTO ref_company FROM "Account" WHERE id = NEW."cashAccountId";
    IF ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'POS cash account company mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'PosDevice' THEN
    SELECT "companyId" INTO ref_company FROM "PosRegister" WHERE id = NEW."registerId";
    IF ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'POS device register company mismatch'; END IF;
  ELSIF TG_TABLE_NAME IN ('PosShift', 'PosSale') THEN
    SELECT "companyId" INTO ref_company FROM "PosRegister" WHERE id = NEW."registerId";
    IF ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'POS register company mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'PosSaleLine' THEN
    SELECT "companyId" INTO ref_company FROM "PosSale" WHERE id = NEW."saleId";
    IF ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'POS sale line company mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'PosTender' THEN
    SELECT "companyId" INTO ref_company FROM "PosSale" WHERE id = NEW."saleId";
    IF ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'POS tender sale company mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'PosCashEvent' THEN
    SELECT "companyId" INTO ref_company FROM "PosShift" WHERE id = NEW."shiftId";
    IF ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'POS cash event shift company mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PosRegister_company_guard" BEFORE INSERT OR UPDATE ON "PosRegister" FOR EACH ROW EXECUTE FUNCTION pos_company_guard();
CREATE TRIGGER "PosDevice_company_guard" BEFORE INSERT OR UPDATE ON "PosDevice" FOR EACH ROW EXECUTE FUNCTION pos_company_guard();
CREATE TRIGGER "PosShift_company_guard" BEFORE INSERT OR UPDATE ON "PosShift" FOR EACH ROW EXECUTE FUNCTION pos_company_guard();
CREATE TRIGGER "PosSale_company_guard" BEFORE INSERT OR UPDATE ON "PosSale" FOR EACH ROW EXECUTE FUNCTION pos_company_guard();
CREATE TRIGGER "PosSaleLine_company_guard" BEFORE INSERT OR UPDATE ON "PosSaleLine" FOR EACH ROW EXECUTE FUNCTION pos_company_guard();
CREATE TRIGGER "PosTender_company_guard" BEFORE INSERT OR UPDATE ON "PosTender" FOR EACH ROW EXECUTE FUNCTION pos_company_guard();
CREATE TRIGGER "PosCashEvent_company_guard" BEFORE INSERT OR UPDATE ON "PosCashEvent" FOR EACH ROW EXECUTE FUNCTION pos_company_guard();

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['PosRegister','PosDevice','PosShift','PosSale','PosSaleLine','PosTender','PosCashEvent'] LOOP
    EXECUTE format('ALTER TABLE "%s" ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "%s" FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON "%s" FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access() AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access() AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id()))', t || '_tenant_policy', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON "PosRegister", "PosDevice", "PosShift", "PosSale", "PosSaleLine", "PosTender", "PosCashEvent" TO clearledger_runtime;
