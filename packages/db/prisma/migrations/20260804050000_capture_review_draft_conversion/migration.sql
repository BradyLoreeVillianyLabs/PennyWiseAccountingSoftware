CREATE TYPE "CaptureConversionTarget" AS ENUM ('BILL', 'IMMEDIATE_EXPENSE');

CREATE UNIQUE INDEX "CaptureReview_organizationId_id_key"
  ON "CaptureReview" ("organizationId", "id");
CREATE UNIQUE INDEX "TaxCode_organizationId_id_key"
  ON "TaxCode" ("organizationId", "id");
CREATE UNIQUE INDEX "TaxCodeVersion_organizationId_id_key"
  ON "TaxCodeVersion" ("organizationId", "id");

CREATE TABLE "ImmediateExpenseDraft" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "vendorId" UUID,
  "reference" TEXT,
  "expenseDate" DATE NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "method" "PurchasePaymentMethod" NOT NULL,
  "payingAccountId" UUID NOT NULL,
  "subtotalMinor" BIGINT NOT NULL,
  "recoverableTaxMinor" BIGINT NOT NULL,
  "nonRecoverableTaxMinor" BIGINT NOT NULL,
  "taxTotalMinor" BIGINT NOT NULL,
  "grandTotalMinor" BIGINT NOT NULL,
  "internalNotes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImmediateExpenseDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImmediateExpenseDraft_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ImmediateExpenseDraft_vendor_tenant_fkey"
    FOREIGN KEY ("organizationId", "vendorId")
    REFERENCES "Vendor"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseDraft_paying_account_tenant_fkey"
    FOREIGN KEY ("organizationId", "payingAccountId")
    REFERENCES "Account"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseDraft_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ImmediateExpenseDraft_amounts_check" CHECK (
    "subtotalMinor" >= 0
    AND "recoverableTaxMinor" >= 0
    AND "nonRecoverableTaxMinor" >= 0
    AND "taxTotalMinor" = "recoverableTaxMinor" + "nonRecoverableTaxMinor"
    AND "grandTotalMinor" > 0
  ),
  CONSTRAINT "ImmediateExpenseDraft_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "ImmediateExpenseDraft_organizationId_id_key"
  ON "ImmediateExpenseDraft" ("organizationId", "id");
CREATE INDEX "ImmediateExpenseDraft_organizationId_vendorId_expenseDate_idx"
  ON "ImmediateExpenseDraft" ("organizationId", "vendorId", "expenseDate");
CREATE INDEX "ImmediateExpenseDraft_organizationId_payingAccountId_idx"
  ON "ImmediateExpenseDraft" ("organizationId", "payingAccountId");
CREATE INDEX "ImmediateExpenseDraft_organizationId_reference_idx"
  ON "ImmediateExpenseDraft" ("organizationId", "reference");

CREATE TABLE "ImmediateExpenseDraftLine" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "immediateExpenseDraftId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantityMicros" BIGINT NOT NULL,
  "unitCostMinor" BIGINT NOT NULL,
  "discountMinor" BIGINT NOT NULL DEFAULT 0,
  "netAmountMinor" BIGINT NOT NULL,
  "recoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  "nonRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "totalMinor" BIGINT NOT NULL,
  "accountId" UUID NOT NULL,
  "taxCodeId" UUID,
  "taxCodeVersionId" UUID,
  "taxSnapshot" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImmediateExpenseDraftLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImmediateExpenseDraftLine_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ImmediateExpenseDraftLine_draft_tenant_fkey"
    FOREIGN KEY ("organizationId", "immediateExpenseDraftId")
    REFERENCES "ImmediateExpenseDraft"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseDraftLine_account_tenant_fkey"
    FOREIGN KEY ("organizationId", "accountId")
    REFERENCES "Account"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseDraftLine_tax_code_tenant_fkey"
    FOREIGN KEY ("organizationId", "taxCodeId")
    REFERENCES "TaxCode"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseDraftLine_tax_code_version_tenant_fkey"
    FOREIGN KEY ("organizationId", "taxCodeVersionId")
    REFERENCES "TaxCodeVersion"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseDraftLine_line_check"
    CHECK ("lineNumber" > 0 AND "quantityMicros" > 0),
  CONSTRAINT "ImmediateExpenseDraftLine_amounts_check" CHECK (
    "unitCostMinor" >= 0
    AND "discountMinor" >= 0
    AND "netAmountMinor" >= 0
    AND "recoverableTaxMinor" >= 0
    AND "nonRecoverableTaxMinor" >= 0
    AND "taxTotalMinor" = "recoverableTaxMinor" + "nonRecoverableTaxMinor"
    AND "totalMinor" > 0
  )
);

CREATE UNIQUE INDEX "ImmediateExpenseDraftLine_immediateExpenseDraftId_lineNumber_key"
  ON "ImmediateExpenseDraftLine" ("immediateExpenseDraftId", "lineNumber");
CREATE INDEX "ImmediateExpenseDraftLine_organizationId_immediateExpenseDraftId_idx"
  ON "ImmediateExpenseDraftLine" ("organizationId", "immediateExpenseDraftId");
CREATE INDEX "ImmediateExpenseDraftLine_organizationId_accountId_idx"
  ON "ImmediateExpenseDraftLine" ("organizationId", "accountId");

CREATE TABLE "CaptureReviewConversion" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "captureReviewId" UUID NOT NULL,
  "captureReviewVersion" INTEGER NOT NULL,
  "targetType" "CaptureConversionTarget" NOT NULL,
  "billId" UUID,
  "immediateExpenseDraftId" UUID,
  "convertedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CaptureReviewConversion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CaptureReviewConversion_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "CaptureReviewConversion_capture_tenant_fkey"
    FOREIGN KEY ("organizationId", "captureReviewId")
    REFERENCES "CaptureReview"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "CaptureReviewConversion_bill_tenant_fkey"
    FOREIGN KEY ("organizationId", "billId")
    REFERENCES "Bill"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "CaptureReviewConversion_expense_draft_tenant_fkey"
    FOREIGN KEY ("organizationId", "immediateExpenseDraftId")
    REFERENCES "ImmediateExpenseDraft"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "CaptureReviewConversion_version_check" CHECK ("captureReviewVersion" > 0),
  CONSTRAINT "CaptureReviewConversion_target_check" CHECK (
    ("targetType" = 'BILL' AND "billId" IS NOT NULL AND "immediateExpenseDraftId" IS NULL)
    OR
    ("targetType" = 'IMMEDIATE_EXPENSE' AND "billId" IS NULL AND "immediateExpenseDraftId" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "CaptureReviewConversion_organizationId_id_key"
  ON "CaptureReviewConversion" ("organizationId", "id");
CREATE UNIQUE INDEX "CaptureReviewConversion_organizationId_captureReviewId_key"
  ON "CaptureReviewConversion" ("organizationId", "captureReviewId");
CREATE UNIQUE INDEX "CaptureReviewConversion_organizationId_billId_key"
  ON "CaptureReviewConversion" ("organizationId", "billId");
CREATE UNIQUE INDEX "CaptureReviewConversion_organizationId_immediateExpenseDraftId_key"
  ON "CaptureReviewConversion" ("organizationId", "immediateExpenseDraftId");
CREATE INDEX "CaptureReviewConversion_organizationId_targetType_createdAt_idx"
  ON "CaptureReviewConversion" ("organizationId", "targetType", "createdAt");

CREATE OR REPLACE FUNCTION prevent_capture_review_conversion_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Capture review conversions are append-only';
END;
$$;

CREATE TRIGGER "CaptureReviewConversion_append_only"
BEFORE UPDATE OR DELETE ON "CaptureReviewConversion"
FOR EACH ROW EXECUTE FUNCTION prevent_capture_review_conversion_mutation();

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "ImmediateExpenseDraft", "ImmediateExpenseDraftLine"
TO clearledger_runtime;
GRANT SELECT, INSERT ON "CaptureReviewConversion" TO clearledger_runtime;

ALTER TABLE "CaptureReview" FORCE ROW LEVEL SECURITY;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ImmediateExpenseDraft', 'ImmediateExpenseDraftLine', 'CaptureReviewConversion'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;
