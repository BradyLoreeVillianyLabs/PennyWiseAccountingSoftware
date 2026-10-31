DO $rollback$
BEGIN
  IF to_regclass('public."OrganizationCurrency"') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Journal'
        AND column_name = 'baseCurrency'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'JournalLine'
        AND column_name = 'transactionCurrency'
    ) THEN
    RETURN;
  END IF;

DO $check$
BEGIN
  IF to_regclass('public."OrganizationCurrency"') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Journal'
        AND column_name = 'baseCurrency'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'JournalLine'
        AND column_name = 'transactionCurrency'
    ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Journal" journal
    JOIN "Organization" organization ON organization."id" = journal."organizationId"
    WHERE trim(journal."baseCurrency") <> trim(organization."currency")
  ) OR EXISTS (
    SELECT 1
    FROM "JournalLine"
    WHERE "transactionCurrency" IS NOT NULL
      AND trim("transactionCurrency") <> trim("baseCurrency")
  ) OR EXISTS (
    SELECT 1
    FROM "Invoice" invoice
    JOIN "Organization" organization ON organization."id" = invoice."organizationId"
    WHERE trim(invoice."currency") <> trim(organization."currency")
  ) OR EXISTS (
    SELECT 1
    FROM "Payment" payment
    JOIN "Organization" organization ON organization."id" = payment."organizationId"
    WHERE trim(payment."currency") <> trim(organization."currency")
  ) OR EXISTS (
    SELECT 1
    FROM "Bill" bill
    JOIN "Organization" organization ON organization."id" = bill."organizationId"
    WHERE trim(bill."currency") <> trim(organization."currency")
  ) OR EXISTS (
    SELECT 1
    FROM "MonetaryPosition" position
    JOIN "Organization" organization ON organization."id" = position."organizationId"
    WHERE trim(position."currency") <> trim(organization."currency")
  ) OR EXISTS (
    SELECT 1
    FROM "FxRateSnapshot" rate
    WHERE trim(rate."transactionCurrency") <> trim(rate."baseCurrency")
      AND (
        EXISTS (SELECT 1 FROM "Journal" WHERE "fxRateSnapshotId" = rate."id")
        OR EXISTS (SELECT 1 FROM "JournalLine" WHERE "fxRateSnapshotId" = rate."id")
        OR EXISTS (SELECT 1 FROM "Invoice" WHERE "fxRateSnapshotId" = rate."id")
        OR EXISTS (SELECT 1 FROM "Payment" WHERE "fxRateSnapshotId" = rate."id")
        OR EXISTS (SELECT 1 FROM "Bill" WHERE "fxRateSnapshotId" = rate."id")
        OR EXISTS (
          SELECT 1 FROM "MonetaryPositionEvent" WHERE "rateSnapshotId" = rate."id"
        )
      )
  ) THEN
    RAISE EXCEPTION
      'Refusing MCFX foundation rollback because foreign-currency evidence exists; disable the feature, deploy a forward repair, or restore a complete backup';
  END IF;
END;
$check$;

DROP TRIGGER IF EXISTS "MonetaryPositionEvent_validate_tenant" ON "MonetaryPositionEvent";
DROP TRIGGER IF EXISTS "Journal_mark_fx_revaluation_stale" ON "Journal";
DROP TRIGGER IF EXISTS "FxRateSnapshot_immutable" ON "FxRateSnapshot";
DROP FUNCTION IF EXISTS validate_monetary_position_event_tenant();
DROP FUNCTION IF EXISTS mark_fx_revaluation_runs_stale();
DROP FUNCTION IF EXISTS prevent_fx_rate_snapshot_mutation();

DROP POLICY IF EXISTS "OrganizationCurrency_tenant_policy" ON "OrganizationCurrency";
DROP POLICY IF EXISTS "FxRateSnapshot_tenant_policy" ON "FxRateSnapshot";
DROP POLICY IF EXISTS "FxPolicy_tenant_policy" ON "FxPolicy";
DROP POLICY IF EXISTS "FxRevaluationRun_tenant_policy" ON "FxRevaluationRun";
DROP POLICY IF EXISTS "MonetaryPosition_tenant_policy" ON "MonetaryPosition";
DROP POLICY IF EXISTS "MonetaryPositionEvent_tenant_policy" ON "MonetaryPositionEvent";

ALTER TABLE "JournalLine" DROP CONSTRAINT IF EXISTS "JournalLine_fxRateSnapshotId_fkey";
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_fxRateSnapshotId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_fxRateSnapshotId_fkey";
ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_fxRateSnapshotId_fkey";
ALTER TABLE "Journal" DROP CONSTRAINT IF EXISTS "Journal_fxRateSnapshotId_fkey";
ALTER TABLE "MonetaryPositionEvent" DROP CONSTRAINT IF EXISTS "MonetaryPositionEvent_journalId_fkey";
ALTER TABLE "MonetaryPositionEvent" DROP CONSTRAINT IF EXISTS "MonetaryPositionEvent_rateSnapshotId_fkey";
ALTER TABLE "MonetaryPositionEvent" DROP CONSTRAINT IF EXISTS "MonetaryPositionEvent_monetaryPositionId_fkey";
ALTER TABLE "MonetaryPositionEvent" DROP CONSTRAINT IF EXISTS "MonetaryPositionEvent_organizationId_fkey";
ALTER TABLE "MonetaryPosition" DROP CONSTRAINT IF EXISTS "MonetaryPosition_accountId_fkey";
ALTER TABLE "MonetaryPosition" DROP CONSTRAINT IF EXISTS "MonetaryPosition_organizationId_fkey";
ALTER TABLE "FxPolicy" DROP CONSTRAINT IF EXISTS "FxPolicy_organizationId_fkey";
ALTER TABLE "FxRevaluationRun" DROP CONSTRAINT IF EXISTS "FxRevaluationRun_reversalJournalId_fkey";
ALTER TABLE "FxRevaluationRun" DROP CONSTRAINT IF EXISTS "FxRevaluationRun_valuationJournalId_fkey";
ALTER TABLE "FxRevaluationRun" DROP CONSTRAINT IF EXISTS "FxRevaluationRun_organizationId_fkey";
ALTER TABLE "FxRateSnapshot" DROP CONSTRAINT IF EXISTS "FxRateSnapshot_organizationId_fkey";
ALTER TABLE "OrganizationCurrency" DROP CONSTRAINT IF EXISTS "OrganizationCurrency_organizationId_fkey";

DROP TABLE IF EXISTS "MonetaryPositionEvent";
DROP TABLE IF EXISTS "MonetaryPosition";
DROP TABLE IF EXISTS "FxPolicy";
DROP TABLE IF EXISTS "FxRevaluationRun";
DROP TABLE IF EXISTS "FxRateSnapshot";
DROP TABLE IF EXISTS "OrganizationCurrency";

ALTER TABLE "JournalLine"
  DROP COLUMN IF EXISTS "fxRateSnapshotId",
  DROP COLUMN IF EXISTS "conversionDenominator",
  DROP COLUMN IF EXISTS "conversionNumerator",
  DROP COLUMN IF EXISTS "baseExponentSnapshot",
  DROP COLUMN IF EXISTS "transactionExponentSnapshot",
  DROP COLUMN IF EXISTS "baseCurrency",
  DROP COLUMN IF EXISTS "transactionMinor",
  DROP COLUMN IF EXISTS "transactionCurrency";
ALTER TABLE "Journal"
  DROP COLUMN IF EXISTS "fxRateSnapshotId",
  DROP COLUMN IF EXISTS "baseCurrency";
ALTER TABLE "OrganizationSettings"
  DROP COLUMN IF EXISTS "fxRateMode",
  DROP COLUMN IF EXISTS "multiCurrencyEnabled";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "fxRateSnapshotId";
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "fxRateSnapshotId";
ALTER TABLE "Bill" DROP COLUMN IF EXISTS "fxRateSnapshotId";

DROP TYPE IF EXISTS "FxRevaluationStatus";
DROP TYPE IF EXISTS "MonetaryPositionEventKind";
DROP TYPE IF EXISTS "MonetaryPositionKind";
DROP TYPE IF EXISTS "FxRateMethod";

END;
$rollback$;
