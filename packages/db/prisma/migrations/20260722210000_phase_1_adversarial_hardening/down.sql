DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20260722210000_phase_1_adversarial_hardening';

DROP TRIGGER IF EXISTS "Journal_posting_invariants_insert" ON "Journal";
DROP INDEX IF EXISTS "Journal_organizationId_reversedJournalId_key";

ALTER TABLE "FiscalPeriod"
  DROP CONSTRAINT IF EXISTS "FiscalPeriod_no_overlap_excl";

CREATE OR REPLACE FUNCTION enforce_journal_posting_invariants()
RETURNS TRIGGER AS $$
DECLARE
  line_count INTEGER;
  debit_total BIGINT;
  credit_total BIGINT;
  fiscal_period_org UUID;
  fiscal_period_status "PeriodStatus";
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journals are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journals are immutable';
  END IF;

  IF NEW."status" = 'POSTED' THEN
    SELECT "organizationId", "status" INTO fiscal_period_org, fiscal_period_status
    FROM "FiscalPeriod"
    WHERE "id" = NEW."fiscalPeriodId";

    IF fiscal_period_org IS NULL OR fiscal_period_org <> NEW."organizationId" THEN
      RAISE EXCEPTION 'Journal fiscal period must belong to the journal organization';
    END IF;

    IF fiscal_period_status <> 'OPEN' THEN
      RAISE EXCEPTION 'Cannot post into a closed fiscal period';
    END IF;

    IF NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL THEN
      RAISE EXCEPTION 'Posted journals require postedAt and postedByUserId';
    END IF;

    SELECT
      COUNT(*),
      COALESCE(SUM("debitMinor"), 0)::BIGINT,
      COALESCE(SUM("creditMinor"), 0)::BIGINT
    INTO line_count, debit_total, credit_total
    FROM "JournalLine"
    WHERE "journalId" = NEW."id";

    IF line_count < 2 THEN
      RAISE EXCEPTION 'Posted journals require at least two lines';
    END IF;

    IF debit_total <> credit_total THEN
      RAISE EXCEPTION 'Posted journal debits and credits must balance';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP EXTENSION IF EXISTS "btree_gist";
