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
  ADD COLUMN "sourceSystem" "DataImportSourceSystem" NOT NULL DEFAULT 'OTHER';

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
