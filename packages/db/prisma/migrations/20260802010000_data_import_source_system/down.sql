DO $$
BEGIN
  IF to_regclass('public."DataImportBatch"') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS "DataImportBatch_source_system_guard" ON "DataImportBatch";
  DROP FUNCTION IF EXISTS phase12_import_source_system_guard();
  ALTER TABLE "DataImportBatch" DROP COLUMN IF EXISTS "sourceSystem";
  DROP TYPE IF EXISTS "DataImportSourceSystem";
END $$;
