DO $rollback$
BEGIN
  IF to_regclass('public."DataImportBatch"') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "DataImportBatch"
    WHERE "sourceSystem" = 'QUICKBOOKS_DESKTOP'
  ) THEN
    RAISE EXCEPTION 'Cannot roll back QuickBooks Desktop import source while batches still use it';
  END IF;

  DROP TRIGGER IF EXISTS "DataImportBatch_source_system_guard" ON "DataImportBatch";
  DROP FUNCTION IF EXISTS phase12_import_source_system_guard();

  ALTER TABLE "DataImportBatch"
    ALTER COLUMN "sourceSystem" DROP DEFAULT,
    ALTER COLUMN "sourceSystem" TYPE text
    USING "sourceSystem"::text;
  DROP TYPE "DataImportSourceSystem";
  CREATE TYPE "DataImportSourceSystem" AS ENUM (
    'QUICKBOOKS_ONLINE',
    'XERO',
    'WAVE',
    'FRESHBOOKS',
    'SAGE',
    'ZOHO_BOOKS',
    'OTHER'
  );
  ALTER TABLE "DataImportBatch"
    ALTER COLUMN "sourceSystem" TYPE "DataImportSourceSystem"
    USING "sourceSystem"::"DataImportSourceSystem",
    ALTER COLUMN "sourceSystem" SET DEFAULT 'OTHER';

  CREATE OR REPLACE FUNCTION phase12_import_source_system_guard()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF NEW."sourceSystem" IS DISTINCT FROM OLD."sourceSystem" THEN
      RAISE EXCEPTION 'Import source evidence is immutable';
    END IF;
    RETURN NEW;
  END;
  $$;

  CREATE TRIGGER "DataImportBatch_source_system_guard"
    BEFORE UPDATE OF "sourceSystem" ON "DataImportBatch"
    FOR EACH ROW EXECUTE FUNCTION phase12_import_source_system_guard();
END;
$rollback$;
