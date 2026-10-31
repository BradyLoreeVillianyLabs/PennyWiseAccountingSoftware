DO $rollback$
BEGIN
  IF to_regclass('public."OrganizationClosureRequest"') IS NULL THEN
    RETURN;
  END IF;

  DROP TABLE "OrganizationClosureRequest";
DROP TABLE "OrganizationExportJob";
DROP TABLE "HistoricalImportRecord";
DROP TABLE "DataImportRow";
DROP TABLE "DataImportBatch";
DROP FUNCTION phase12_import_evidence_guard();
DROP FUNCTION phase12_import_batch_guard();
DROP TYPE "OrganizationClosureStatus";
DROP TYPE "OrganizationExportStatus";
DROP TYPE "DataImportRowStatus";
DROP TYPE "DataImportStatus";
  DROP TYPE "DataImportType";
END;
$rollback$;
