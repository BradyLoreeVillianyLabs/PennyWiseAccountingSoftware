-- Independent review found that the MCFX acceptance chain was incomplete.
-- Keep every foreign posting path disabled until a later reviewed migration
-- deliberately replaces this release gate.
UPDATE "OrganizationSettings"
SET "multiCurrencyEnabled" = false,
    "fxRateMode" = 'MANUAL',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "multiCurrencyEnabled" OR "fxRateMode" <> 'MANUAL';

ALTER TABLE "OrganizationSettings"
  ADD CONSTRAINT "OrganizationSettings_multi_currency_release_gate_check"
  CHECK (NOT "multiCurrencyEnabled" AND "fxRateMode" = 'MANUAL');

UPDATE "CommerceInboxEvent"
SET "eventVersion" = ''
WHERE "eventVersion" IS NULL;
DROP INDEX "CommerceInboxEvent_org_installation_external_key";
ALTER TABLE "CommerceInboxEvent"
  ALTER COLUMN "eventVersion" SET DEFAULT '',
  ALTER COLUMN "eventVersion" SET NOT NULL;
CREATE UNIQUE INDEX "CommerceInboxEvent_org_installation_external_version_key"
  ON "CommerceInboxEvent" (
    "organizationId", "installationId", "externalEventId", "eventVersion"
  );

CREATE UNIQUE INDEX "Journal_organizationId_id_key"
  ON "Journal" ("organizationId", "id");
CREATE UNIQUE INDEX "FxRateSnapshot_organizationId_id_key"
  ON "FxRateSnapshot" ("organizationId", "id");
CREATE UNIQUE INDEX "MonetaryPosition_organizationId_id_key"
  ON "MonetaryPosition" ("organizationId", "id");
CREATE UNIQUE INDEX "FxRevaluationRun_organizationId_valuationJournalId_key"
  ON "FxRevaluationRun" ("organizationId", "valuationJournalId");
CREATE UNIQUE INDEX "FxRevaluationRun_organizationId_reversalJournalId_key"
  ON "FxRevaluationRun" ("organizationId", "reversalJournalId");

ALTER TABLE "Journal" DROP CONSTRAINT "Journal_fxRateSnapshotId_fkey";
ALTER TABLE "JournalLine" DROP CONSTRAINT "JournalLine_fxRateSnapshotId_fkey";
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_fxRateSnapshotId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_fxRateSnapshotId_fkey";
ALTER TABLE "Bill" DROP CONSTRAINT "Bill_fxRateSnapshotId_fkey";
ALTER TABLE "FxRevaluationRun"
  DROP CONSTRAINT "FxRevaluationRun_valuationJournalId_fkey",
  DROP CONSTRAINT "FxRevaluationRun_reversalJournalId_fkey";
ALTER TABLE "MonetaryPosition" DROP CONSTRAINT "MonetaryPosition_accountId_fkey";
ALTER TABLE "MonetaryPositionEvent"
  DROP CONSTRAINT "MonetaryPositionEvent_monetaryPositionId_fkey",
  DROP CONSTRAINT "MonetaryPositionEvent_rateSnapshotId_fkey",
  DROP CONSTRAINT "MonetaryPositionEvent_journalId_fkey";

ALTER TABLE "Journal"
  ADD CONSTRAINT "Journal_fxRateSnapshotId_fkey"
  FOREIGN KEY ("organizationId", "fxRateSnapshotId")
  REFERENCES "FxRateSnapshot" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_fxRateSnapshotId_fkey"
  FOREIGN KEY ("organizationId", "fxRateSnapshotId")
  REFERENCES "FxRateSnapshot" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_fxRateSnapshotId_fkey"
  FOREIGN KEY ("organizationId", "fxRateSnapshotId")
  REFERENCES "FxRateSnapshot" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_fxRateSnapshotId_fkey"
  FOREIGN KEY ("organizationId", "fxRateSnapshotId")
  REFERENCES "FxRateSnapshot" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bill"
  ADD CONSTRAINT "Bill_fxRateSnapshotId_fkey"
  FOREIGN KEY ("organizationId", "fxRateSnapshotId")
  REFERENCES "FxRateSnapshot" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FxRevaluationRun"
  ADD CONSTRAINT "FxRevaluationRun_valuationJournalId_fkey"
  FOREIGN KEY ("organizationId", "valuationJournalId")
  REFERENCES "Journal" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FxRevaluationRun_reversalJournalId_fkey"
  FOREIGN KEY ("organizationId", "reversalJournalId")
  REFERENCES "Journal" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonetaryPosition"
  ADD CONSTRAINT "MonetaryPosition_accountId_fkey"
  FOREIGN KEY ("organizationId", "accountId")
  REFERENCES "Account" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonetaryPositionEvent"
  ADD CONSTRAINT "MonetaryPositionEvent_monetaryPositionId_fkey"
  FOREIGN KEY ("organizationId", "monetaryPositionId")
  REFERENCES "MonetaryPosition" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MonetaryPositionEvent_rateSnapshotId_fkey"
  FOREIGN KEY ("organizationId", "rateSnapshotId")
  REFERENCES "FxRateSnapshot" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MonetaryPositionEvent_journalId_fkey"
  FOREIGN KEY ("organizationId", "journalId")
  REFERENCES "Journal" ("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FxRateSnapshot"
  ADD CONSTRAINT "FxRateSnapshot_transaction_currency_fkey"
  FOREIGN KEY ("organizationId", "transactionCurrency")
  REFERENCES "OrganizationCurrency" ("organizationId", "currencyCode")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FxRateSnapshot_base_currency_fkey"
  FOREIGN KEY ("organizationId", "baseCurrency")
  REFERENCES "OrganizationCurrency" ("organizationId", "currencyCode")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FxRateSnapshot_same_currency_rate_check"
  CHECK (
    trim("transactionCurrency") <> trim("baseCurrency")
    OR "numerator" = "denominator"
  );

COMMENT ON COLUMN "FxRateSnapshot"."numerator" IS
  'Exact rate numerator: base major units per transaction major unit.';
COMMENT ON COLUMN "FxRateSnapshot"."denominator" IS
  'Exact rate denominator: base major units per transaction major unit.';

CREATE OR REPLACE FUNCTION prevent_organization_currency_exponent_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."exponent" IS DISTINCT FROM OLD."exponent" THEN
    RAISE EXCEPTION 'Currency exponent history is immutable; create a new versioned definition';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "OrganizationCurrency_exponent_immutable"
BEFORE UPDATE OF "exponent" ON "OrganizationCurrency"
FOR EACH ROW EXECUTE FUNCTION prevent_organization_currency_exponent_change();

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

CREATE OR REPLACE FUNCTION prevent_commerce_inbox_raw_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."installationId" IS DISTINCT FROM OLD."installationId"
     OR NEW."providerKey" IS DISTINCT FROM OLD."providerKey"
     OR NEW."shopExternalId" IS DISTINCT FROM OLD."shopExternalId"
     OR NEW."externalEventId" IS DISTINCT FROM OLD."externalEventId"
     OR NEW."resourceType" IS DISTINCT FROM OLD."resourceType"
     OR NEW."resourceId" IS DISTINCT FROM OLD."resourceId"
     OR NEW."eventType" IS DISTINCT FROM OLD."eventType"
     OR NEW."eventVersion" IS DISTINCT FROM OLD."eventVersion"
     OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt"
     OR NEW."sourceCurrency" IS DISTINCT FROM OLD."sourceCurrency"
     OR NEW."paymentCurrency" IS DISTINCT FROM OLD."paymentCurrency"
     OR NEW."settlementCurrency" IS DISTINCT FROM OLD."settlementCurrency"
     OR NEW."rawPayload" IS DISTINCT FROM OLD."rawPayload"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Commerce inbox raw evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CommerceInboxEvent_raw_immutable"
BEFORE UPDATE ON "CommerceInboxEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_commerce_inbox_raw_mutation();
