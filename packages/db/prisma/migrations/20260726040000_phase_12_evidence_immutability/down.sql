DROP TRIGGER IF EXISTS "OrganizationClosureRequest_evidence_trigger"
  ON "OrganizationClosureRequest";
DROP FUNCTION IF EXISTS phase12_closure_guard();

DROP TRIGGER IF EXISTS "OrganizationExportJob_evidence_trigger"
  ON "OrganizationExportJob";
DROP FUNCTION IF EXISTS phase12_export_job_guard();

CREATE OR REPLACE FUNCTION phase12_import_batch_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId"
    OR NEW."importType" <> OLD."importType"
    OR NEW."sourceFilename" <> OLD."sourceFilename"
    OR NEW."storageKey" <> OLD."storageKey"
    OR NEW."mediaType" <> OLD."mediaType"
    OR NEW."byteSize" <> OLD."byteSize"
    OR NEW.checksum <> OLD.checksum
    OR NEW."createdByUserId" <> OLD."createdByUserId"
    OR NEW."createdAt" <> OLD."createdAt"
  THEN RAISE EXCEPTION 'Import source evidence is immutable'; END IF;
  IF OLD.status IN ('COMMITTED', 'RECONCILED', 'COMPENSATION_REQUIRED')
    AND NEW.status NOT IN ('RECONCILED', OLD.status)
  THEN RAISE EXCEPTION 'Final import status cannot move backward'; END IF;
  RETURN NEW;
END;
$$;
