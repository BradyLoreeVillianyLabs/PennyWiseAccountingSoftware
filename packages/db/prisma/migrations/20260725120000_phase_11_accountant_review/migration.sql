CREATE TYPE "ManualJournalDraftStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

CREATE TABLE "ManualJournalDraft" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "status" "ManualJournalDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "description" TEXT NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "allowControlAccountPosting" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "journalId" UUID,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManualJournalDraft_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ManualJournalDraftLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "draftId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "description" TEXT,
  "debitMinor" BIGINT NOT NULL DEFAULT 0,
  "creditMinor" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManualJournalDraftLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualJournalDraftLine_side_check" CHECK (
    ("debitMinor" > 0 AND "creditMinor" = 0) OR
    ("creditMinor" > 0 AND "debitMinor" = 0)
  )
);
CREATE TABLE "PeriodCloseRecord" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "fiscalPeriodId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "checklist" JSONB NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PeriodCloseRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PeriodCloseRecord_action_check" CHECK ("action" IN ('CLOSE', 'REOPEN'))
);
CREATE TABLE "ReviewItemDismissal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "dismissedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewItemDismissal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ManualJournalDraft_organizationId_id_key" ON "ManualJournalDraft"("organizationId", "id");
CREATE UNIQUE INDEX "Account_organizationId_id_key" ON "Account"("organizationId", "id");
CREATE UNIQUE INDEX "ManualJournalDraft_journalId_key" ON "ManualJournalDraft"("journalId");
CREATE INDEX "ManualJournalDraft_organizationId_status_effectiveDate_idx" ON "ManualJournalDraft"("organizationId", "status", "effectiveDate");
CREATE UNIQUE INDEX "ManualJournalDraftLine_draftId_lineNumber_key" ON "ManualJournalDraftLine"("draftId", "lineNumber");
CREATE INDEX "ManualJournalDraftLine_organizationId_accountId_idx" ON "ManualJournalDraftLine"("organizationId", "accountId");
CREATE UNIQUE INDEX "PeriodCloseRecord_fiscalPeriodId_revision_key" ON "PeriodCloseRecord"("fiscalPeriodId", "revision");
CREATE INDEX "PeriodCloseRecord_organizationId_createdAt_idx" ON "PeriodCloseRecord"("organizationId", "createdAt");
CREATE UNIQUE INDEX "ReviewItemDismissal_organizationId_fingerprint_key" ON "ReviewItemDismissal"("organizationId", "fingerprint");
CREATE INDEX "ReviewItemDismissal_organizationId_category_createdAt_idx" ON "ReviewItemDismissal"("organizationId", "category", "createdAt");

ALTER TABLE "ManualJournalDraft" ADD CONSTRAINT "ManualJournalDraft_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "ManualJournalDraft" ADD CONSTRAINT "ManualJournalDraft_journalId_fkey"
  FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT;
ALTER TABLE "ManualJournalDraftLine" ADD CONSTRAINT "ManualJournalDraftLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "ManualJournalDraftLine" ADD CONSTRAINT "ManualJournalDraftLine_draft_tenant_fkey"
  FOREIGN KEY ("organizationId", "draftId") REFERENCES "ManualJournalDraft"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "ManualJournalDraftLine" ADD CONSTRAINT "ManualJournalDraftLine_account_tenant_fkey"
  FOREIGN KEY ("organizationId", "accountId") REFERENCES "Account"("organizationId", "id") ON DELETE RESTRICT;
ALTER TABLE "PeriodCloseRecord" ADD CONSTRAINT "PeriodCloseRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "PeriodCloseRecord" ADD CONSTRAINT "PeriodCloseRecord_fiscalPeriodId_fkey"
  FOREIGN KEY ("fiscalPeriodId") REFERENCES "FiscalPeriod"("id") ON DELETE RESTRICT;
ALTER TABLE "ReviewItemDismissal" ADD CONSTRAINT "ReviewItemDismissal_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION phase11_accountant_tenant_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  organization_id UUID := NEW."organizationId";
  linked_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'ManualJournalDraft' THEN linked_id := NEW."journalId"; END IF;
  IF TG_TABLE_NAME = 'PeriodCloseRecord' THEN linked_id := NEW."fiscalPeriodId"; END IF;
  IF TG_TABLE_NAME = 'ManualJournalDraft' AND linked_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Journal" WHERE id = linked_id AND "organizationId" = organization_id
    ) THEN RAISE EXCEPTION 'Manual-journal draft journal must belong to its organization'; END IF;
  IF TG_TABLE_NAME = 'PeriodCloseRecord'
    AND NOT EXISTS (
      SELECT 1 FROM "FiscalPeriod" WHERE id = linked_id AND "organizationId" = organization_id
    ) THEN RAISE EXCEPTION 'Period close record must belong to its organization'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ManualJournalDraft_tenant_trigger"
  BEFORE INSERT OR UPDATE ON "ManualJournalDraft"
  FOR EACH ROW EXECUTE FUNCTION phase11_accountant_tenant_guard();
CREATE TRIGGER "PeriodCloseRecord_tenant_trigger"
  BEFORE INSERT OR UPDATE ON "PeriodCloseRecord"
  FOR EACH ROW EXECUTE FUNCTION phase11_accountant_tenant_guard();

CREATE OR REPLACE FUNCTION phase11_accountant_history_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% records are append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER "PeriodCloseRecord_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "PeriodCloseRecord"
  FOR EACH ROW EXECUTE FUNCTION phase11_accountant_history_guard();
CREATE TRIGGER "ReviewItemDismissal_immutable_trigger"
  BEFORE UPDATE OR DELETE ON "ReviewItemDismissal"
  FOR EACH ROW EXECUTE FUNCTION phase11_accountant_history_guard();

CREATE OR REPLACE FUNCTION phase11_manual_draft_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE draft_status "ManualJournalDraftStatus";
  linked_draft_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'ManualJournalDraft' THEN
    IF TG_OP = 'DELETE' AND OLD.status = 'POSTED' THEN RAISE EXCEPTION 'Posted manual-journal drafts are immutable'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'POSTED' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Posted manual-journal drafts are immutable'; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN linked_draft_id := OLD."draftId";
  ELSE linked_draft_id := NEW."draftId"; END IF;
  SELECT status INTO draft_status FROM "ManualJournalDraft" WHERE id = linked_draft_id;
  IF draft_status = 'POSTED' THEN RAISE EXCEPTION 'Posted manual-journal draft lines are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ManualJournalDraft_history_trigger"
  BEFORE UPDATE OR DELETE ON "ManualJournalDraft"
  FOR EACH ROW EXECUTE FUNCTION phase11_manual_draft_guard();
CREATE TRIGGER "ManualJournalDraftLine_history_trigger"
  BEFORE UPDATE OR DELETE ON "ManualJournalDraftLine"
  FOR EACH ROW EXECUTE FUNCTION phase11_manual_draft_guard();

GRANT SELECT, INSERT, UPDATE, DELETE ON "ManualJournalDraft", "ManualJournalDraftLine" TO clearledger_runtime;
GRANT SELECT, INSERT ON "PeriodCloseRecord", "ReviewItemDismissal" TO clearledger_runtime;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['ManualJournalDraft', 'ManualJournalDraftLine', 'PeriodCloseRecord', 'ReviewItemDismissal']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING (
        "organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()
      ) WITH CHECK (
        "organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()
      )',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;
