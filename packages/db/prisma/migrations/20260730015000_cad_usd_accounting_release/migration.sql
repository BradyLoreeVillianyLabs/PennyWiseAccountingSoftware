-- CAD/USD provider-independent accounting release.
-- Rates remain exact immutable snapshots quoted as:
--   1 transaction-currency major unit = numerator / denominator base major units.

CREATE TYPE "FxRatePurpose" AS ENUM (
  'TRANSACTION', 'CLOSING', 'AVERAGE', 'ACTUAL_SETTLEMENT'
);

ALTER TYPE "MonetaryPositionEventKind" ADD VALUE IF NOT EXISTS 'REVALUATION_REVERSAL';
ALTER TYPE "MonetaryPositionEventKind" ADD VALUE IF NOT EXISTS 'CREDIT';
ALTER TYPE "MonetaryPositionEventKind" ADD VALUE IF NOT EXISTS 'CORRECTION';
ALTER TYPE "MonetaryPositionEventKind" ADD VALUE IF NOT EXISTS 'REVERSED';

ALTER TABLE "FxRateSnapshot"
  ADD COLUMN "purpose" "FxRatePurpose" NOT NULL DEFAULT 'TRANSACTION';

-- The release adds base-currency evidence to historical documents and allocations.
-- Normal application writes must never change issued or posted accounting evidence,
-- but this transactional backfill has to populate the new columns once. Suspend only
-- the existing history-protection update triggers and restore them before commit.
ALTER TABLE "Invoice"
  DISABLE TRIGGER "Invoice_history_protection";
ALTER TABLE "Invoice"
  DISABLE TRIGGER "Invoice_render_data_protection";
ALTER TABLE "InvoiceLine"
  DISABLE TRIGGER "InvoiceLine_history_protection";
ALTER TABLE "InvoiceLine"
  DISABLE TRIGGER "InvoiceLine_tenant_reference";
ALTER TABLE "Bill"
  DISABLE TRIGGER "Bill_history_protection";
ALTER TABLE "BillLine"
  DISABLE TRIGGER "BillLine_history_protection";
ALTER TABLE "BillLine"
  DISABLE TRIGGER "BillLine_tenant_reference";
ALTER TABLE "PaymentAllocation"
  DISABLE TRIGGER "PaymentAllocation_append_only_update";
ALTER TABLE "BillPaymentAllocation"
  DISABLE TRIGGER "BillPaymentAllocation_history_protection";
ALTER TABLE "BillPaymentAllocation"
  DISABLE TRIGGER "BillPaymentAllocation_tenant_reference";

ALTER TABLE "Invoice"
  ADD COLUMN "baseSubtotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseDiscountTotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseTaxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseGrandTotalMinor" BIGINT NOT NULL DEFAULT 0;
UPDATE "Invoice"
SET "baseSubtotalMinor" = "subtotalMinor",
    "baseDiscountTotalMinor" = "discountTotalMinor",
    "baseTaxTotalMinor" = "taxTotalMinor",
    "baseGrandTotalMinor" = "grandTotalMinor";

ALTER TABLE "InvoiceLine"
  ADD COLUMN "baseGrossAmountMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseDiscountMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseNetAmountMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseTaxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseTotalMinor" BIGINT NOT NULL DEFAULT 0;
UPDATE "InvoiceLine"
SET "baseGrossAmountMinor" = "grossAmountMinor",
    "baseDiscountMinor" = "discountMinor",
    "baseNetAmountMinor" = "netAmountMinor",
    "baseTaxTotalMinor" = "taxTotalMinor",
    "baseTotalMinor" = "totalMinor";

ALTER TABLE "Bill"
  ADD COLUMN "baseSubtotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseDiscountTotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseNonRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseTaxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseGrandTotalMinor" BIGINT NOT NULL DEFAULT 0;
UPDATE "Bill"
SET "baseSubtotalMinor" = "subtotalMinor",
    "baseDiscountTotalMinor" = "discountTotalMinor",
    "baseRecoverableTaxMinor" = "recoverableTaxMinor",
    "baseNonRecoverableTaxMinor" = "nonRecoverableTaxMinor",
    "baseTaxTotalMinor" = "taxTotalMinor",
    "baseGrandTotalMinor" = "grandTotalMinor";

ALTER TABLE "BillLine"
  ADD COLUMN "baseGrossAmountMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseDiscountMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseNetAmountMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseNonRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseTaxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "baseTotalMinor" BIGINT NOT NULL DEFAULT 0;
UPDATE "BillLine"
SET "baseGrossAmountMinor" = "grossAmountMinor",
    "baseDiscountMinor" = "discountMinor",
    "baseNetAmountMinor" = "netAmountMinor",
    "baseRecoverableTaxMinor" = "recoverableTaxMinor",
    "baseNonRecoverableTaxMinor" = "nonRecoverableTaxMinor",
    "baseTaxTotalMinor" = "taxTotalMinor",
    "baseTotalMinor" = "totalMinor";

ALTER TABLE "PaymentAllocation"
  ADD COLUMN "carryingBaseRelievedMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "settlementBaseMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "realizedFxBaseMinor" BIGINT NOT NULL DEFAULT 0;
UPDATE "PaymentAllocation"
SET "carryingBaseRelievedMinor" = "amountMinor",
    "settlementBaseMinor" = "amountMinor";

ALTER TABLE "BillPayment"
  ADD COLUMN "fxRateSnapshotId" UUID;
ALTER TABLE "BillPayment"
  ADD CONSTRAINT "BillPayment_fxRateSnapshotId_fkey"
  FOREIGN KEY ("organizationId", "fxRateSnapshotId")
  REFERENCES "FxRateSnapshot" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "BillPayment_fxRateSnapshotId_idx" ON "BillPayment" ("fxRateSnapshotId");

ALTER TABLE "BillPaymentAllocation"
  ADD COLUMN "carryingBaseRelievedMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "settlementBaseMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "realizedFxBaseMinor" BIGINT NOT NULL DEFAULT 0;
UPDATE "BillPaymentAllocation"
SET "carryingBaseRelievedMinor" = "amountMinor",
    "settlementBaseMinor" = "amountMinor";

ALTER TABLE "BillPaymentAllocation"
  ENABLE TRIGGER "BillPaymentAllocation_tenant_reference";
ALTER TABLE "BillPaymentAllocation"
  ENABLE TRIGGER "BillPaymentAllocation_history_protection";
ALTER TABLE "PaymentAllocation"
  ENABLE TRIGGER "PaymentAllocation_append_only_update";
ALTER TABLE "BillLine"
  ENABLE TRIGGER "BillLine_tenant_reference";
ALTER TABLE "BillLine"
  ENABLE TRIGGER "BillLine_history_protection";
ALTER TABLE "Bill"
  ENABLE TRIGGER "Bill_history_protection";
ALTER TABLE "InvoiceLine"
  ENABLE TRIGGER "InvoiceLine_tenant_reference";
ALTER TABLE "InvoiceLine"
  ENABLE TRIGGER "InvoiceLine_history_protection";
ALTER TABLE "Invoice"
  ENABLE TRIGGER "Invoice_render_data_protection";
ALTER TABLE "Invoice"
  ENABLE TRIGGER "Invoice_history_protection";

ALTER TABLE "MonetaryPosition"
  ADD COLUMN "originalTransactionMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "outstandingTransactionMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "originalBaseMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "carryingBaseMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "cumulativeRealizedFxMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "cumulativeUnrealizedFxMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
UPDATE "MonetaryPosition"
SET "originalBaseMinor" = "carryingMinor",
    "carryingBaseMinor" = "carryingMinor";

ALTER TABLE "MonetaryPositionEvent"
  ADD COLUMN "sequence" INTEGER,
  ADD COLUMN "transactionDeltaMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "carryingBaseDeltaMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "realizedFxBaseMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "unrealizedFxBaseMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "outstandingAfterMinor" BIGINT,
  ADD COLUMN "carryingBaseAfterMinor" BIGINT,
  ADD COLUMN "sourceType" TEXT,
  ADD COLUMN "sourceId" TEXT;

WITH ordered AS (
  SELECT "id",
    row_number() OVER (
      PARTITION BY "organizationId", "monetaryPositionId"
      ORDER BY "eventDate", "createdAt", "id"
    )::integer AS sequence
  FROM "MonetaryPositionEvent"
)
UPDATE "MonetaryPositionEvent" event
SET "sequence" = ordered.sequence,
    "transactionDeltaMinor" = COALESCE(event."transactionMinor", 0),
    "carryingBaseDeltaMinor" = event."baseMinor",
    "outstandingAfterMinor" = 0,
    "carryingBaseAfterMinor" = 0,
    "sourceType" = 'legacy_event',
    "sourceId" = event."id"::text
FROM ordered
WHERE ordered."id" = event."id";

ALTER TABLE "MonetaryPositionEvent"
  ALTER COLUMN "sequence" SET NOT NULL,
  ALTER COLUMN "outstandingAfterMinor" SET NOT NULL,
  ALTER COLUMN "carryingBaseAfterMinor" SET NOT NULL,
  ALTER COLUMN "sourceType" SET NOT NULL,
  ALTER COLUMN "sourceId" SET NOT NULL;

ALTER TABLE "MonetaryPosition"
  ADD CONSTRAINT "MonetaryPosition_amounts_nonnegative_check"
  CHECK (
    "originalTransactionMinor" >= 0
    AND "outstandingTransactionMinor" >= 0
    AND "originalBaseMinor" >= 0
    AND "carryingBaseMinor" >= 0
    AND "version" > 0
  );
ALTER TABLE "MonetaryPositionEvent"
  ADD CONSTRAINT "MonetaryPositionEvent_sequence_check" CHECK ("sequence" > 0),
  ADD CONSTRAINT "MonetaryPositionEvent_projection_nonnegative_check"
  CHECK ("outstandingAfterMinor" >= 0 AND "carryingBaseAfterMinor" >= 0);

CREATE UNIQUE INDEX "MonetaryPositionEvent_org_position_sequence_key"
  ON "MonetaryPositionEvent" ("organizationId", "monetaryPositionId", "sequence");
CREATE UNIQUE INDEX "MonetaryPositionEvent_org_source_key"
  ON "MonetaryPositionEvent" ("organizationId", "sourceType", "sourceId");
CREATE INDEX "MonetaryPosition_org_active_currency_account_idx"
  ON "MonetaryPosition" ("organizationId", "active", "currency", "accountId");
CREATE INDEX "FxRateSnapshot_org_purpose_pair_date_idx"
  ON "FxRateSnapshot" (
    "organizationId", "purpose", "transactionCurrency", "baseCurrency", "effectiveAt"
  );

CREATE OR REPLACE FUNCTION prevent_monetary_position_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Monetary position events are immutable accounting evidence';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "MonetaryPositionEvent_immutable"
BEFORE UPDATE OR DELETE ON "MonetaryPositionEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_monetary_position_event_mutation();

DROP TRIGGER IF EXISTS "JournalLine_foreign_posting_release_gate" ON "JournalLine";
DROP FUNCTION IF EXISTS reject_unreleased_foreign_journal_line();
ALTER TABLE "OrganizationSettings"
  DROP CONSTRAINT IF EXISTS "OrganizationSettings_multi_currency_release_gate_check";

ALTER TABLE "OrganizationSettings"
  ADD CONSTRAINT "OrganizationSettings_cad_usd_release_check"
  CHECK (
    NOT "multiCurrencyEnabled"
    OR (
      "fxRateMode" = 'MANUAL'
      AND trim("baseCurrency") IN ('CAD', 'USD')
    )
  );

ALTER TABLE "Customer" DROP CONSTRAINT "Customer_currency_check";
ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_currency_check"
  CHECK (trim("defaultCurrency") IN ('CAD', 'USD'));
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_currency_check";
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_currency_check"
  CHECK (trim("currency") IN ('CAD', 'USD'));
ALTER TABLE "Bill" DROP CONSTRAINT "Bill_currency_check";
ALTER TABLE "Bill"
  ADD CONSTRAINT "Bill_currency_check"
  CHECK (trim("currency") IN ('CAD', 'USD'));
ALTER TABLE "BillPayment" DROP CONSTRAINT "BillPayment_currency_check";
ALTER TABLE "BillPayment"
  ADD CONSTRAINT "BillPayment_currency_check"
  CHECK (trim("currency") IN ('CAD', 'USD'));
ALTER TABLE "BankAccount" DROP CONSTRAINT "BankAccount_currency_check";
ALTER TABLE "BankAccount"
  ADD CONSTRAINT "BankAccount_currency_check"
  CHECK (trim("currency") IN ('CAD', 'USD'));
ALTER TABLE "BankImportedTransaction"
  DROP CONSTRAINT "BankImportedTransaction_currency_check";
ALTER TABLE "BankImportedTransaction"
  ADD CONSTRAINT "BankImportedTransaction_currency_check"
  CHECK (trim("currency") IN ('CAD', 'USD'));

CREATE OR REPLACE FUNCTION phase4_validate_invoice_totals() RETURNS TRIGGER AS $$
DECLARE
  line_subtotal BIGINT;
  line_discount BIGINT;
  line_tax BIGINT;
  line_total BIGINT;
  line_base_subtotal BIGINT;
  line_base_discount BIGINT;
  line_base_tax BIGINT;
  line_base_total BIGINT;
BEGIN
  IF NEW."status" IN ('POSTED','PARTIALLY_CREDITED','CREDITED','VOIDED') THEN
    SELECT
      COALESCE(SUM("grossAmountMinor"),0),
      COALESCE(SUM("discountMinor"),0),
      COALESCE(SUM("taxTotalMinor"),0),
      COALESCE(SUM("totalMinor"),0),
      COALESCE(SUM("baseGrossAmountMinor"),0),
      COALESCE(SUM("baseDiscountMinor"),0),
      COALESCE(SUM("baseTaxTotalMinor"),0),
      COALESCE(SUM("baseTotalMinor"),0)
    INTO
      line_subtotal, line_discount, line_tax, line_total,
      line_base_subtotal, line_base_discount, line_base_tax, line_base_total
    FROM "InvoiceLine" WHERE "invoiceId" = NEW."id";
    IF NEW."subtotalMinor" <> line_subtotal
      OR NEW."discountTotalMinor" <> line_discount
      OR NEW."taxTotalMinor" <> line_tax
      OR NEW."grandTotalMinor" <> line_total
      OR NEW."grandTotalMinor" <> NEW."subtotalMinor" - NEW."discountTotalMinor" + NEW."taxTotalMinor"
      OR NEW."baseSubtotalMinor" <> line_base_subtotal
      OR NEW."baseDiscountTotalMinor" <> line_base_discount
      OR NEW."baseTaxTotalMinor" <> line_base_tax
      OR NEW."baseGrandTotalMinor" <> line_base_total
      OR NEW."baseGrandTotalMinor" <> NEW."baseSubtotalMinor" - NEW."baseDiscountTotalMinor" + NEW."baseTaxTotalMinor"
      OR NEW."journalId" IS NULL OR NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM "Journal"
        WHERE "id" = NEW."journalId"
          AND "organizationId" = NEW."organizationId"
          AND "sourceType" = 'invoice'
          AND "sourceId" = NEW."id"::text
          AND "status" = 'POSTED'
      )
      OR COALESCE((SELECT SUM("debitMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."baseGrandTotalMinor"
      OR COALESCE((SELECT SUM("creditMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."baseGrandTotalMinor"
    THEN
      RAISE EXCEPTION 'Invoice totals and posted journal must agree';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_cad_usd_foreign_journal_line()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."transactionCurrency" IS NULL
     OR trim(NEW."transactionCurrency") = trim(NEW."baseCurrency") THEN
    RETURN NEW;
  END IF;
  IF trim(NEW."transactionCurrency") NOT IN ('CAD', 'USD')
     OR trim(NEW."baseCurrency") NOT IN ('CAD', 'USD') THEN
    RAISE EXCEPTION 'Only CAD and USD foreign posting is released'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "OrganizationSettings" settings
    WHERE settings."organizationId" = NEW."organizationId"
      AND settings."multiCurrencyEnabled"
      AND trim(settings."baseCurrency") = trim(NEW."baseCurrency")
  ) THEN
    RAISE EXCEPTION 'Multi-currency posting is not enabled for this organization'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "OrganizationCurrency" currency
    WHERE currency."organizationId" = NEW."organizationId"
      AND trim(currency."currencyCode") = trim(NEW."transactionCurrency")
      AND currency."enabled"
  ) THEN
    RAISE EXCEPTION 'Transaction currency is not enabled for this organization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalLine_cad_usd_posting_gate"
BEFORE INSERT OR UPDATE OF "organizationId", "transactionCurrency", "baseCurrency"
ON "JournalLine"
FOR EACH ROW EXECUTE FUNCTION validate_cad_usd_foreign_journal_line();
