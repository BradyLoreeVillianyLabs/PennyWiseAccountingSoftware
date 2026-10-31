CREATE EXTENSION IF NOT EXISTS "btree_gist";

ALTER TABLE "FiscalPeriod"
  ADD CONSTRAINT "FiscalPeriod_no_overlap_excl"
  EXCLUDE USING gist (
    "organizationId" WITH =,
    tsrange("startDate", "endDate", '[]') WITH &&
  );

CREATE UNIQUE INDEX "Journal_organizationId_reversedJournalId_key" ON "Journal" (
  "organizationId",
  "reversedJournalId"
);

CREATE OR REPLACE FUNCTION enforce_journal_posting_invariants()
RETURNS TRIGGER AS $$
DECLARE
  line_count INTEGER;
  debit_total BIGINT;
  credit_total BIGINT;
  fiscal_period_org UUID;
  fiscal_period_status "PeriodStatus";
  reversed_journal_org UUID;
  reversed_journal_status "JournalStatus";
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

  SELECT "organizationId", "status" INTO fiscal_period_org, fiscal_period_status
  FROM "FiscalPeriod"
  WHERE "id" = NEW."fiscalPeriodId";

  IF fiscal_period_org IS NULL OR fiscal_period_org <> NEW."organizationId" THEN
    RAISE EXCEPTION 'Journal fiscal period must belong to the journal organization';
  END IF;

  IF NEW."reversedJournalId" IS NOT NULL THEN
    IF NEW."reversedJournalId" = NEW."id" THEN
      RAISE EXCEPTION 'A journal cannot reverse itself';
    END IF;

    SELECT "organizationId", "status" INTO reversed_journal_org, reversed_journal_status
    FROM "Journal"
    WHERE "id" = NEW."reversedJournalId";

    IF reversed_journal_org IS NULL OR reversed_journal_org <> NEW."organizationId" THEN
      RAISE EXCEPTION 'Reversed journal must belong to the journal organization';
    END IF;

    IF reversed_journal_status <> 'POSTED' THEN
      RAISE EXCEPTION 'Only posted journals can be reversed';
    END IF;
  END IF;

  IF NEW."status" = 'POSTED' THEN
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
    WHERE "journalId" = NEW."id"
      AND "organizationId" = NEW."organizationId";

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

CREATE TRIGGER "Journal_posting_invariants_insert"
BEFORE INSERT ON "Journal"
FOR EACH ROW EXECUTE FUNCTION enforce_journal_posting_invariants();
