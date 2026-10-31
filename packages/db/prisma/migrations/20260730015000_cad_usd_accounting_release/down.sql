DO $rollback$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'JournalLine'
      AND column_name = 'transactionCurrency'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "JournalLine"
    WHERE "transactionCurrency" IS NOT NULL
      AND trim("transactionCurrency") <> trim("baseCurrency")
  ) OR EXISTS (
    SELECT 1 FROM "MonetaryPosition"
    WHERE trim("currency") NOT IN (
      SELECT trim("currency")
      FROM "Organization"
      WHERE "Organization"."id" = "MonetaryPosition"."organizationId"
    )
  ) THEN
    RAISE EXCEPTION
      'Refusing CAD/USD release rollback because foreign-currency accounting evidence exists';
  END IF;

DROP TRIGGER IF EXISTS "JournalLine_cad_usd_posting_gate" ON "JournalLine";
DROP FUNCTION IF EXISTS validate_cad_usd_foreign_journal_line();
DROP TRIGGER IF EXISTS "MonetaryPositionEvent_immutable" ON "MonetaryPositionEvent";
DROP FUNCTION IF EXISTS prevent_monetary_position_event_mutation();

UPDATE "OrganizationSettings"
SET "multiCurrencyEnabled" = false,
    "fxRateMode" = 'MANUAL',
    "updatedAt" = CURRENT_TIMESTAMP;
ALTER TABLE "OrganizationSettings"
  DROP CONSTRAINT IF EXISTS "OrganizationSettings_cad_usd_release_check";
ALTER TABLE "OrganizationSettings"
  ADD CONSTRAINT "OrganizationSettings_multi_currency_release_gate_check"
  CHECK (NOT "multiCurrencyEnabled" AND "fxRateMode" = 'MANUAL');

ALTER TABLE "BillPayment" DROP CONSTRAINT IF EXISTS "BillPayment_currency_check";
ALTER TABLE "BillPayment"
  ADD CONSTRAINT "BillPayment_currency_check" CHECK ("currency" = 'CAD');
ALTER TABLE "BankImportedTransaction"
  DROP CONSTRAINT IF EXISTS "BankImportedTransaction_currency_check";
ALTER TABLE "BankImportedTransaction"
  ADD CONSTRAINT "BankImportedTransaction_currency_check" CHECK ("currency" = 'CAD');
ALTER TABLE "BankAccount" DROP CONSTRAINT IF EXISTS "BankAccount_currency_check";
ALTER TABLE "BankAccount"
  ADD CONSTRAINT "BankAccount_currency_check" CHECK ("currency" = 'CAD');
ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_currency_check";
ALTER TABLE "Bill"
  ADD CONSTRAINT "Bill_currency_check" CHECK ("currency" = 'CAD');
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_currency_check";
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_currency_check" CHECK ("currency" = 'CAD');
ALTER TABLE "Customer" DROP CONSTRAINT IF EXISTS "Customer_currency_check";
ALTER TABLE "Customer"
  ADD CONSTRAINT "Customer_currency_check" CHECK ("defaultCurrency" = 'CAD');

CREATE OR REPLACE FUNCTION phase4_validate_invoice_totals() RETURNS TRIGGER AS $$
DECLARE line_subtotal BIGINT; line_discount BIGINT; line_tax BIGINT; line_total BIGINT;
BEGIN
  IF NEW."status" IN ('POSTED','PARTIALLY_CREDITED','CREDITED','VOIDED') THEN
    SELECT COALESCE(SUM("grossAmountMinor"),0), COALESCE(SUM("discountMinor"),0), COALESCE(SUM("taxTotalMinor"),0), COALESCE(SUM("totalMinor"),0)
      INTO line_subtotal, line_discount, line_tax, line_total FROM "InvoiceLine" WHERE "invoiceId" = NEW."id";
    IF NEW."subtotalMinor" <> line_subtotal OR NEW."discountTotalMinor" <> line_discount OR NEW."taxTotalMinor" <> line_tax OR NEW."grandTotalMinor" <> line_total
      OR NEW."grandTotalMinor" <> NEW."subtotalMinor" - NEW."discountTotalMinor" + NEW."taxTotalMinor"
      OR NEW."journalId" IS NULL OR NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL
      OR NOT EXISTS (SELECT 1 FROM "Journal" WHERE "id" = NEW."journalId" AND "organizationId" = NEW."organizationId" AND "sourceType" = 'invoice' AND "sourceId" = NEW."id"::text AND "status" = 'POSTED')
      OR COALESCE((SELECT SUM("debitMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."grandTotalMinor"
      OR COALESCE((SELECT SUM("creditMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."grandTotalMinor" THEN
      RAISE EXCEPTION 'Invoice totals and posted journal must agree';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reject_unreleased_foreign_journal_line()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."transactionCurrency" IS NOT NULL
     AND trim(NEW."transactionCurrency") <> trim(NEW."baseCurrency") THEN
    RAISE EXCEPTION 'Multi-currency posting is not released'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "JournalLine_foreign_posting_release_gate"
BEFORE INSERT OR UPDATE OF "transactionCurrency", "baseCurrency" ON "JournalLine"
FOR EACH ROW EXECUTE FUNCTION reject_unreleased_foreign_journal_line();

DROP INDEX IF EXISTS "FxRateSnapshot_org_purpose_pair_date_idx";
DROP INDEX IF EXISTS "MonetaryPosition_org_active_currency_account_idx";
DROP INDEX IF EXISTS "MonetaryPositionEvent_org_source_key";
DROP INDEX IF EXISTS "MonetaryPositionEvent_org_position_sequence_key";

ALTER TABLE "MonetaryPositionEvent"
  DROP CONSTRAINT IF EXISTS "MonetaryPositionEvent_projection_nonnegative_check",
  DROP CONSTRAINT IF EXISTS "MonetaryPositionEvent_sequence_check",
  DROP COLUMN IF EXISTS "sourceId",
  DROP COLUMN IF EXISTS "sourceType",
  DROP COLUMN IF EXISTS "carryingBaseAfterMinor",
  DROP COLUMN IF EXISTS "outstandingAfterMinor",
  DROP COLUMN IF EXISTS "unrealizedFxBaseMinor",
  DROP COLUMN IF EXISTS "realizedFxBaseMinor",
  DROP COLUMN IF EXISTS "carryingBaseDeltaMinor",
  DROP COLUMN IF EXISTS "transactionDeltaMinor",
  DROP COLUMN IF EXISTS "sequence";
ALTER TABLE "MonetaryPosition"
  DROP CONSTRAINT IF EXISTS "MonetaryPosition_amounts_nonnegative_check",
  DROP COLUMN IF EXISTS "version",
  DROP COLUMN IF EXISTS "cumulativeUnrealizedFxMinor",
  DROP COLUMN IF EXISTS "cumulativeRealizedFxMinor",
  DROP COLUMN IF EXISTS "carryingBaseMinor",
  DROP COLUMN IF EXISTS "originalBaseMinor",
  DROP COLUMN IF EXISTS "outstandingTransactionMinor",
  DROP COLUMN IF EXISTS "originalTransactionMinor";

ALTER TABLE "BillPaymentAllocation"
  DROP COLUMN IF EXISTS "realizedFxBaseMinor",
  DROP COLUMN IF EXISTS "settlementBaseMinor",
  DROP COLUMN IF EXISTS "carryingBaseRelievedMinor";
DROP INDEX IF EXISTS "BillPayment_fxRateSnapshotId_idx";
ALTER TABLE "BillPayment" DROP CONSTRAINT IF EXISTS "BillPayment_fxRateSnapshotId_fkey";
ALTER TABLE "BillPayment" DROP COLUMN IF EXISTS "fxRateSnapshotId";
ALTER TABLE "PaymentAllocation"
  DROP COLUMN IF EXISTS "realizedFxBaseMinor",
  DROP COLUMN IF EXISTS "settlementBaseMinor",
  DROP COLUMN IF EXISTS "carryingBaseRelievedMinor";

ALTER TABLE "BillLine"
  DROP COLUMN IF EXISTS "baseTotalMinor",
  DROP COLUMN IF EXISTS "baseTaxTotalMinor",
  DROP COLUMN IF EXISTS "baseNonRecoverableTaxMinor",
  DROP COLUMN IF EXISTS "baseRecoverableTaxMinor",
  DROP COLUMN IF EXISTS "baseNetAmountMinor",
  DROP COLUMN IF EXISTS "baseDiscountMinor",
  DROP COLUMN IF EXISTS "baseGrossAmountMinor";
ALTER TABLE "Bill"
  DROP COLUMN IF EXISTS "baseGrandTotalMinor",
  DROP COLUMN IF EXISTS "baseTaxTotalMinor",
  DROP COLUMN IF EXISTS "baseNonRecoverableTaxMinor",
  DROP COLUMN IF EXISTS "baseRecoverableTaxMinor",
  DROP COLUMN IF EXISTS "baseDiscountTotalMinor",
  DROP COLUMN IF EXISTS "baseSubtotalMinor";
ALTER TABLE "InvoiceLine"
  DROP COLUMN IF EXISTS "baseTotalMinor",
  DROP COLUMN IF EXISTS "baseTaxTotalMinor",
  DROP COLUMN IF EXISTS "baseNetAmountMinor",
  DROP COLUMN IF EXISTS "baseDiscountMinor",
  DROP COLUMN IF EXISTS "baseGrossAmountMinor";
ALTER TABLE "Invoice"
  DROP COLUMN IF EXISTS "baseGrandTotalMinor",
  DROP COLUMN IF EXISTS "baseTaxTotalMinor",
  DROP COLUMN IF EXISTS "baseDiscountTotalMinor",
  DROP COLUMN IF EXISTS "baseSubtotalMinor";
ALTER TABLE "FxRateSnapshot" DROP COLUMN IF EXISTS "purpose";
DROP TYPE IF EXISTS "FxRatePurpose";

END;
$rollback$;
