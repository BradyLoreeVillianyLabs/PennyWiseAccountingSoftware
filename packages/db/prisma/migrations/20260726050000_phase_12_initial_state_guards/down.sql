DROP TRIGGER IF EXISTS "OrganizationClosureRequest_insert_guard"
  ON "OrganizationClosureRequest";
DROP FUNCTION IF EXISTS phase12_closure_insert_guard();

DROP TRIGGER IF EXISTS "OrganizationExportJob_insert_guard"
  ON "OrganizationExportJob";
DROP FUNCTION IF EXISTS phase12_export_job_insert_guard();

DROP TRIGGER IF EXISTS "HistoricalImportRecord_insert_guard"
  ON "HistoricalImportRecord";
DROP FUNCTION IF EXISTS phase12_historical_import_insert_guard();

DROP TRIGGER IF EXISTS "DataImportRow_insert_guard" ON "DataImportRow";
DROP FUNCTION IF EXISTS phase12_import_row_insert_guard();

DROP TRIGGER IF EXISTS "DataImportBatch_transition_guard" ON "DataImportBatch";
DROP FUNCTION IF EXISTS phase12_import_batch_transition_guard();

DROP TRIGGER IF EXISTS "DataImportBatch_insert_guard" ON "DataImportBatch";
DROP FUNCTION IF EXISTS phase12_import_batch_insert_guard();
