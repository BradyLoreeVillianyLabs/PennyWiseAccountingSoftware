DO $rollback$
BEGIN
  IF to_regclass('public."ReviewItemDismissal"') IS NULL THEN
    RETURN;
  END IF;

  DROP TABLE "ReviewItemDismissal";
DROP TABLE "PeriodCloseRecord";
DROP TABLE "ManualJournalDraftLine";
DROP TABLE "ManualJournalDraft";
DROP INDEX "Account_organizationId_id_key";
DROP FUNCTION phase11_accountant_tenant_guard();
DROP FUNCTION phase11_manual_draft_guard();
DROP FUNCTION phase11_accountant_history_guard();
  DROP TYPE "ManualJournalDraftStatus";
END;
$rollback$;
