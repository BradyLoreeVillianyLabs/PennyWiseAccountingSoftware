DO $rollback$
BEGIN
  IF to_regclass('public."FxRateSnapshot"') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS "CommerceInboxEvent_raw_immutable" ON "CommerceInboxEvent";
DROP FUNCTION IF EXISTS prevent_commerce_inbox_raw_mutation();
DROP TRIGGER IF EXISTS "JournalLine_foreign_posting_release_gate" ON "JournalLine";
DROP FUNCTION IF EXISTS reject_unreleased_foreign_journal_line();
DROP TRIGGER IF EXISTS "OrganizationCurrency_exponent_immutable" ON "OrganizationCurrency";
DROP FUNCTION IF EXISTS prevent_organization_currency_exponent_change();

ALTER TABLE "FxRateSnapshot"
  DROP CONSTRAINT IF EXISTS "FxRateSnapshot_same_currency_rate_check",
  DROP CONSTRAINT IF EXISTS "FxRateSnapshot_base_currency_fkey",
  DROP CONSTRAINT IF EXISTS "FxRateSnapshot_transaction_currency_fkey";
ALTER TABLE "OrganizationSettings"
  DROP CONSTRAINT IF EXISTS "OrganizationSettings_multi_currency_release_gate_check";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "CommerceInboxEvent"
    GROUP BY "organizationId", "installationId", "externalEventId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot restore the pre-review commerce inbox key after distinct event versions were recorded';
  END IF;
END;
$$;
DROP INDEX IF EXISTS "CommerceInboxEvent_org_installation_external_version_key";
ALTER TABLE "CommerceInboxEvent"
  ALTER COLUMN "eventVersion" DROP NOT NULL,
  ALTER COLUMN "eventVersion" DROP DEFAULT;
UPDATE "CommerceInboxEvent"
SET "eventVersion" = NULL
WHERE "eventVersion" = '';
CREATE UNIQUE INDEX "CommerceInboxEvent_org_installation_external_key"
  ON "CommerceInboxEvent" ("organizationId", "installationId", "externalEventId");

ALTER TABLE "Journal" DROP CONSTRAINT IF EXISTS "Journal_fxRateSnapshotId_fkey";
ALTER TABLE "JournalLine" DROP CONSTRAINT IF EXISTS "JournalLine_fxRateSnapshotId_fkey";
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_fxRateSnapshotId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_fxRateSnapshotId_fkey";
ALTER TABLE "Bill" DROP CONSTRAINT IF EXISTS "Bill_fxRateSnapshotId_fkey";
ALTER TABLE "FxRevaluationRun"
  DROP CONSTRAINT IF EXISTS "FxRevaluationRun_valuationJournalId_fkey",
  DROP CONSTRAINT IF EXISTS "FxRevaluationRun_reversalJournalId_fkey";
ALTER TABLE "MonetaryPosition" DROP CONSTRAINT IF EXISTS "MonetaryPosition_accountId_fkey";
ALTER TABLE "MonetaryPositionEvent"
  DROP CONSTRAINT IF EXISTS "MonetaryPositionEvent_monetaryPositionId_fkey",
  DROP CONSTRAINT IF EXISTS "MonetaryPositionEvent_rateSnapshotId_fkey",
  DROP CONSTRAINT IF EXISTS "MonetaryPositionEvent_journalId_fkey";

ALTER TABLE "Journal"
  ADD CONSTRAINT "Journal_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bill"
  ADD CONSTRAINT "Bill_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FxRevaluationRun"
  ADD CONSTRAINT "FxRevaluationRun_valuationJournalId_fkey"
  FOREIGN KEY ("valuationJournalId") REFERENCES "Journal" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FxRevaluationRun_reversalJournalId_fkey"
  FOREIGN KEY ("reversalJournalId") REFERENCES "Journal" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonetaryPosition"
  ADD CONSTRAINT "MonetaryPosition_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonetaryPositionEvent"
  ADD CONSTRAINT "MonetaryPositionEvent_monetaryPositionId_fkey"
  FOREIGN KEY ("monetaryPositionId") REFERENCES "MonetaryPosition" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MonetaryPositionEvent_rateSnapshotId_fkey"
  FOREIGN KEY ("rateSnapshotId") REFERENCES "FxRateSnapshot" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MonetaryPositionEvent_journalId_fkey"
  FOREIGN KEY ("journalId") REFERENCES "Journal" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "MonetaryPosition_organizationId_id_key";
DROP INDEX IF EXISTS "FxRateSnapshot_organizationId_id_key";
DROP INDEX IF EXISTS "Journal_organizationId_id_key";
DROP INDEX IF EXISTS "FxRevaluationRun_organizationId_reversalJournalId_key";
DROP INDEX IF EXISTS "FxRevaluationRun_organizationId_valuationJournalId_key";

END;
$rollback$;
