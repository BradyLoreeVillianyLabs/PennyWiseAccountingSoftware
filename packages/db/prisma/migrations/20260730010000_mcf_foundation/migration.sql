CREATE TYPE "FxRateMethod" AS ENUM ('MANUAL', 'PROVIDER', 'IMPORTED');
CREATE TYPE "MonetaryPositionKind" AS ENUM (
  'ACCOUNTS_RECEIVABLE', 'ACCOUNTS_PAYABLE', 'BANK', 'CARD',
  'UNDEPOSITED_FUNDS', 'PROCESSOR_CLEARING', 'MARKETPLACE_CLEARING',
  'REFUNDABLE_DEPOSIT'
);
CREATE TYPE "MonetaryPositionEventKind" AS ENUM (
  'RECOGNIZED', 'SETTLED', 'REVALUED', 'WRITTEN_OFF', 'CLOSED'
);
CREATE TYPE "FxRevaluationStatus" AS ENUM ('DRAFT', 'POSTED', 'STALE', 'VOIDED');

ALTER TABLE "OrganizationSettings"
  ADD COLUMN "multiCurrencyEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "fxRateMode" "FxRateMethod" NOT NULL DEFAULT 'MANUAL';

ALTER TABLE "Journal"
  ADD COLUMN "baseCurrency" CHAR(3) NOT NULL DEFAULT 'CAD',
  ADD COLUMN "fxRateSnapshotId" UUID;

ALTER TABLE "JournalLine"
  ADD COLUMN "transactionCurrency" CHAR(3),
  ADD COLUMN "transactionMinor" BIGINT,
  ADD COLUMN "baseCurrency" CHAR(3) NOT NULL DEFAULT 'CAD',
  ADD COLUMN "transactionExponentSnapshot" INTEGER,
  ADD COLUMN "baseExponentSnapshot" INTEGER,
  ADD COLUMN "conversionNumerator" BIGINT,
  ADD COLUMN "conversionDenominator" BIGINT,
  ADD COLUMN "fxRateSnapshotId" UUID;
ALTER TABLE "Invoice" ADD COLUMN "fxRateSnapshotId" UUID;
ALTER TABLE "Payment" ADD COLUMN "fxRateSnapshotId" UUID;
ALTER TABLE "Bill" ADD COLUMN "fxRateSnapshotId" UUID;

CREATE TABLE "OrganizationCurrency" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "currencyCode" CHAR(3) NOT NULL,
  "exponent" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OrganizationCurrency_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationCurrency_exponent_check" CHECK ("exponent" BETWEEN 0 AND 9),
  CONSTRAINT "OrganizationCurrency_code_check" CHECK ("currencyCode" ~ '^[A-Z]{3}$')
);

CREATE TABLE "FxRateSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "transactionCurrency" CHAR(3) NOT NULL,
  "baseCurrency" CHAR(3) NOT NULL,
  "transactionExponent" INTEGER NOT NULL,
  "baseExponent" INTEGER NOT NULL,
  "numerator" BIGINT NOT NULL,
  "denominator" BIGINT NOT NULL,
  "method" "FxRateMethod" NOT NULL DEFAULT 'MANUAL',
  "providerKey" TEXT,
  "sourceReference" TEXT,
  "observedAt" TIMESTAMPTZ(6),
  "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
  "approvedByUserId" UUID,
  "approvalNote" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FxRateSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FxRateSnapshot_currency_check" CHECK (
    "transactionCurrency" ~ '^[A-Z]{3}$' AND "baseCurrency" ~ '^[A-Z]{3}$'
  ),
  CONSTRAINT "FxRateSnapshot_exponent_check" CHECK (
    "transactionExponent" BETWEEN 0 AND 9 AND "baseExponent" BETWEEN 0 AND 9
  ),
  CONSTRAINT "FxRateSnapshot_rate_check" CHECK ("numerator" > 0 AND "denominator" > 0)
);

CREATE TABLE "FxPolicy" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "revaluationEnabled" BOOLEAN NOT NULL DEFAULT true,
  "automaticNextPeriodReversal" BOOLEAN NOT NULL DEFAULT true,
  "materialityMinor" BIGINT NOT NULL DEFAULT 0,
  "valuationSource" TEXT NOT NULL DEFAULT 'MANUAL',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "FxPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FxPolicy_materiality_check" CHECK ("materialityMinor" >= 0)
);

CREATE TABLE "FxRevaluationRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "valuationDate" DATE NOT NULL,
  "status" "FxRevaluationStatus" NOT NULL DEFAULT 'DRAFT',
  "baseCurrency" CHAR(3) NOT NULL,
  "rateSnapshotIds" JSONB NOT NULL,
  "sourceFingerprint" CHAR(64) NOT NULL,
  "valuationJournalId" UUID,
  "reversalJournalId" UUID,
  "staleAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "FxRevaluationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FxRevaluationRun_currency_check" CHECK ("baseCurrency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "MonetaryPosition" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "kind" "MonetaryPositionKind" NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "carryingMinor" BIGINT NOT NULL DEFAULT 0,
  "asOfDate" DATE NOT NULL,
  "lastValuationDate" DATE,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MonetaryPosition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MonetaryPosition_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "MonetaryPositionEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "monetaryPositionId" UUID NOT NULL,
  "kind" "MonetaryPositionEventKind" NOT NULL,
  "eventDate" DATE NOT NULL,
  "transactionMinor" BIGINT,
  "baseMinor" BIGINT NOT NULL,
  "rateSnapshotId" UUID,
  "journalId" UUID,
  "reason" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MonetaryPositionEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrganizationCurrency_organizationId_currencyCode_key"
  ON "OrganizationCurrency" ("organizationId", "currencyCode");
CREATE INDEX "OrganizationCurrency_organizationId_enabled_idx"
  ON "OrganizationCurrency" ("organizationId", "enabled");
CREATE INDEX "FxRateSnapshot_organizationId_currencies_effectiveAt_idx"
  ON "FxRateSnapshot" ("organizationId", "transactionCurrency", "baseCurrency", "effectiveAt");
CREATE INDEX "FxRateSnapshot_organizationId_providerKey_effectiveAt_idx"
  ON "FxRateSnapshot" ("organizationId", "providerKey", "effectiveAt");
CREATE UNIQUE INDEX "FxPolicy_organizationId_key" ON "FxPolicy" ("organizationId");
CREATE INDEX "FxPolicy_organizationId_revaluationEnabled_idx"
  ON "FxPolicy" ("organizationId", "revaluationEnabled");
CREATE UNIQUE INDEX "FxRevaluationRun_valuationJournalId_key" ON "FxRevaluationRun" ("valuationJournalId");
CREATE UNIQUE INDEX "FxRevaluationRun_reversalJournalId_key" ON "FxRevaluationRun" ("reversalJournalId");
CREATE UNIQUE INDEX "FxRevaluationRun_org_date_fingerprint_key"
  ON "FxRevaluationRun" ("organizationId", "valuationDate", "sourceFingerprint");
CREATE INDEX "FxRevaluationRun_org_date_status_idx"
  ON "FxRevaluationRun" ("organizationId", "valuationDate", "status");
CREATE UNIQUE INDEX "MonetaryPosition_organizationId_sourceType_sourceId_key"
  ON "MonetaryPosition" ("organizationId", "sourceType", "sourceId");
CREATE INDEX "MonetaryPosition_organizationId_currency_kind_active_idx"
  ON "MonetaryPosition" ("organizationId", "currency", "kind", "active");
CREATE INDEX "MonetaryPosition_organizationId_accountId_idx"
  ON "MonetaryPosition" ("organizationId", "accountId");
CREATE INDEX "MonetaryPositionEvent_organizationId_position_eventDate_idx"
  ON "MonetaryPositionEvent" ("organizationId", "monetaryPositionId", "eventDate");
CREATE INDEX "MonetaryPositionEvent_organizationId_kind_eventDate_idx"
  ON "MonetaryPositionEvent" ("organizationId", "kind", "eventDate");
CREATE INDEX "Journal_fxRateSnapshotId_idx" ON "Journal" ("fxRateSnapshotId");
CREATE INDEX "JournalLine_fxRateSnapshotId_idx" ON "JournalLine" ("fxRateSnapshotId");
CREATE INDEX "Invoice_fxRateSnapshotId_idx" ON "Invoice" ("fxRateSnapshotId");
CREATE INDEX "Payment_fxRateSnapshotId_idx" ON "Payment" ("fxRateSnapshotId");
CREATE INDEX "Bill_fxRateSnapshotId_idx" ON "Bill" ("fxRateSnapshotId");

ALTER TABLE "OrganizationCurrency"
  ADD CONSTRAINT "OrganizationCurrency_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FxRateSnapshot"
  ADD CONSTRAINT "FxRateSnapshot_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FxPolicy"
  ADD CONSTRAINT "FxPolicy_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FxRevaluationRun"
  ADD CONSTRAINT "FxRevaluationRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "FxRevaluationRun_valuationJournalId_fkey"
  FOREIGN KEY ("valuationJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FxRevaluationRun_reversalJournalId_fkey"
  FOREIGN KEY ("reversalJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonetaryPosition"
  ADD CONSTRAINT "MonetaryPosition_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MonetaryPosition_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MonetaryPositionEvent"
  ADD CONSTRAINT "MonetaryPositionEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "MonetaryPositionEvent_monetaryPositionId_fkey"
  FOREIGN KEY ("monetaryPositionId") REFERENCES "MonetaryPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MonetaryPositionEvent_rateSnapshotId_fkey"
  FOREIGN KEY ("rateSnapshotId") REFERENCES "FxRateSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MonetaryPositionEvent_journalId_fkey"
  FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Journal"
  ADD CONSTRAINT "Journal_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bill"
  ADD CONSTRAINT "Bill_fxRateSnapshotId_fkey"
  FOREIGN KEY ("fxRateSnapshotId") REFERENCES "FxRateSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "OrganizationCurrency" ("organizationId", "currencyCode", "exponent", "updatedAt")
SELECT "id", "currency", 2, CURRENT_TIMESTAMP FROM "Organization"
ON CONFLICT ("organizationId", "currencyCode") DO NOTHING;
INSERT INTO "FxPolicy" ("organizationId", "updatedAt")
SELECT "id", CURRENT_TIMESTAMP FROM "Organization"
ON CONFLICT ("organizationId") DO NOTHING;
INSERT INTO "FxRateSnapshot" (
  "organizationId", "transactionCurrency", "baseCurrency", "transactionExponent",
  "baseExponent", "numerator", "denominator", "method", "sourceReference", "effectiveAt"
)
SELECT "id", "currency", "currency", 2, 2, 1, 1, 'IMPORTED',
       'MCFX-03 same-currency backfill', CURRENT_TIMESTAMP
FROM "Organization";

-- Posted journals and their lines are immutable during normal application use. This
-- migration must populate the newly introduced FX evidence columns on historical
-- rows, so suspend only the two update triggers for the duration of the backfill.
-- PostgreSQL restores the trigger state if this transactional migration fails.
ALTER TABLE "Journal"
  DISABLE TRIGGER "Journal_posting_invariants_update";
ALTER TABLE "JournalLine"
  DISABLE TRIGGER "JournalLine_tenant_update";

UPDATE "Journal" journal
SET "baseCurrency" = organization."currency",
    "fxRateSnapshotId" = rate."id"
FROM "Organization" organization
JOIN LATERAL (
  SELECT "id" FROM "FxRateSnapshot"
  WHERE "organizationId" = organization."id"
    AND "transactionCurrency" = organization."currency"
    AND "baseCurrency" = organization."currency"
  ORDER BY "createdAt" DESC
  LIMIT 1
) rate ON true
WHERE journal."organizationId" = organization."id";
UPDATE "JournalLine" line
SET "transactionCurrency" = journal."baseCurrency",
    "transactionMinor" = line."debitMinor" - line."creditMinor",
    "baseCurrency" = journal."baseCurrency",
    "transactionExponentSnapshot" = 2,
    "baseExponentSnapshot" = 2,
    "conversionNumerator" = 1,
    "conversionDenominator" = 1,
    "fxRateSnapshotId" = journal."fxRateSnapshotId"
FROM "Journal" journal
WHERE line."journalId" = journal."id";

ALTER TABLE "JournalLine"
  ENABLE TRIGGER "JournalLine_tenant_update";
ALTER TABLE "Journal"
  ENABLE TRIGGER "Journal_posting_invariants_update";

GRANT SELECT, INSERT, UPDATE ON "OrganizationCurrency" TO clearledger_runtime;
GRANT SELECT, INSERT ON "FxRateSnapshot" TO clearledger_runtime;
GRANT SELECT, INSERT, UPDATE ON "FxPolicy" TO clearledger_runtime;
GRANT SELECT, INSERT, UPDATE ON "FxRevaluationRun" TO clearledger_runtime;
GRANT SELECT, INSERT, UPDATE ON "MonetaryPosition" TO clearledger_runtime;
GRANT SELECT, INSERT ON "MonetaryPositionEvent" TO clearledger_runtime;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['OrganizationCurrency', 'FxRateSnapshot', 'FxPolicy', 'FxRevaluationRun', 'MonetaryPosition', 'MonetaryPositionEvent']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_fx_rate_snapshot_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'FX rate snapshots are immutable evidence';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FxRateSnapshot_immutable"
BEFORE UPDATE OR DELETE ON "FxRateSnapshot"
FOR EACH ROW EXECUTE FUNCTION prevent_fx_rate_snapshot_mutation();

CREATE OR REPLACE FUNCTION validate_monetary_position_event_tenant()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "MonetaryPosition" position
    WHERE position."id" = NEW."monetaryPositionId"
      AND position."organizationId" = NEW."organizationId"
  ) THEN
    RAISE EXCEPTION 'Monetary position event must belong to the same organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "MonetaryPositionEvent_validate_tenant"
BEFORE INSERT OR UPDATE OF "organizationId", "monetaryPositionId"
ON "MonetaryPositionEvent"
FOR EACH ROW EXECUTE FUNCTION validate_monetary_position_event_tenant();

CREATE OR REPLACE FUNCTION mark_fx_revaluation_runs_stale()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "FxRevaluationRun"
  SET "status" = 'STALE', "staleAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
  WHERE "organizationId" = NEW."organizationId"
    AND "status" = 'POSTED'
    AND "valuationDate" >= NEW."effectiveDate"::date
    AND NEW."sourceType" <> 'fx_revaluation_reversal';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Journal_mark_fx_revaluation_stale"
AFTER INSERT OR UPDATE OF "status" ON "Journal"
FOR EACH ROW WHEN (NEW."status" = 'POSTED')
EXECUTE FUNCTION mark_fx_revaluation_runs_stale();
