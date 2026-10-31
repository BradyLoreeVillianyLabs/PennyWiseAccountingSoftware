ALTER TABLE "Invoice"
  ADD COLUMN "paymentReference" TEXT;

UPDATE "Invoice"
SET "paymentReference" = COALESCE(
  NULLIF(btrim("invoiceNumber"), ''),
  'LEGACY-' || replace("id"::text, '-', '')
)
WHERE "paymentReference" IS NULL;

ALTER TABLE "Invoice"
  ALTER COLUMN "paymentReference" SET NOT NULL;

CREATE UNIQUE INDEX "Invoice_organizationId_paymentReference_key"
  ON "Invoice" ("organizationId", "paymentReference");

CREATE TABLE "CustomerPaymentAlias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "displayName" VARCHAR(250) NOT NULL,
  "normalizedName" VARCHAR(250) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerPaymentAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerPaymentAlias_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerPaymentAlias_organizationId_customerId_fkey"
    FOREIGN KEY ("organizationId", "customerId") REFERENCES "Customer"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerPaymentAlias_displayName_check"
    CHECK (btrim("displayName") <> ''),
  CONSTRAINT "CustomerPaymentAlias_normalizedName_check"
    CHECK (btrim("normalizedName") <> '')
);

CREATE UNIQUE INDEX "CustomerPaymentAlias_organizationId_customerId_normalizedName_key"
  ON "CustomerPaymentAlias" ("organizationId", "customerId", "normalizedName");
CREATE UNIQUE INDEX "CustomerPaymentAlias_organizationId_id_key"
  ON "CustomerPaymentAlias" ("organizationId", "id");
CREATE INDEX "CustomerPaymentAlias_organizationId_normalizedName_idx"
  ON "CustomerPaymentAlias" ("organizationId", "normalizedName");

GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomerPaymentAlias" TO clearledger_runtime;
ALTER TABLE "CustomerPaymentAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerPaymentAlias" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CustomerPaymentAlias_tenant_policy" ON "CustomerPaymentAlias"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
