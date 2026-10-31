CREATE OR REPLACE FUNCTION phase12_import_batch_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'UPLOADED'
    OR NEW.mapping IS NOT NULL
    OR NEW."errorReport" IS NOT NULL
    OR NEW.reconciliation IS NOT NULL
    OR NEW."committedAt" IS NOT NULL
    OR NEW."acknowledgedAt" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Import batch initial state is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DataImportBatch_insert_guard"
  BEFORE INSERT ON "DataImportBatch"
  FOR EACH ROW EXECUTE FUNCTION phase12_import_batch_insert_guard();

CREATE OR REPLACE FUNCTION phase12_import_batch_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD.status = 'UPLOADED' AND NEW.status NOT IN ('UPLOADED', 'VALIDATED', 'PREVIEWED'))
    OR (OLD.status = 'VALIDATED' AND NEW.status NOT IN ('VALIDATED', 'PREVIEWED'))
    OR (
      OLD.status = 'PREVIEWED'
      AND NEW.status NOT IN ('PREVIEWED', 'VALIDATED', 'DRY_RUN')
    )
    OR (
      OLD.status = 'DRY_RUN'
      AND NEW.status NOT IN ('DRY_RUN', 'PREVIEWED', 'VALIDATED', 'COMMITTING')
    )
    OR (
      OLD.status = 'COMMITTING'
      AND NEW.status NOT IN ('COMMITTING', 'COMMITTED', 'FAILED', 'COMPENSATION_REQUIRED')
    )
    OR (
      OLD.status = 'FAILED'
      AND NEW.status NOT IN ('FAILED', 'VALIDATED', 'PREVIEWED')
    )
    OR (
      OLD.status = 'COMMITTED'
      AND NEW.status NOT IN ('COMMITTED', 'RECONCILED')
    )
    OR (OLD.status = 'RECONCILED' AND NEW.status <> 'RECONCILED')
    OR (OLD.status = 'COMPENSATION_REQUIRED' AND NEW.status <> 'COMPENSATION_REQUIRED')
  THEN
    RAISE EXCEPTION 'Invalid import batch status transition';
  END IF;

  IF NEW.status IN ('FAILED', 'COMPENSATION_REQUIRED') AND NEW."errorReport" IS NULL THEN
    RAISE EXCEPTION 'Failed import state requires error evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DataImportBatch_transition_guard"
  BEFORE UPDATE ON "DataImportBatch"
  FOR EACH ROW EXECUTE FUNCTION phase12_import_batch_transition_guard();

CREATE OR REPLACE FUNCTION phase12_import_row_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  batch_status "DataImportStatus";
BEGIN
  SELECT status INTO batch_status
    FROM "DataImportBatch"
   WHERE id = NEW."batchId"
     AND "organizationId" = NEW."organizationId";
  IF batch_status <> 'UPLOADED'
    OR NEW.status <> 'PENDING'
    OR NEW."mappedData" IS NOT NULL
    OR NEW.errors IS NOT NULL
    OR NEW."externalId" IS NOT NULL
    OR NEW."createdResourceType" IS NOT NULL
    OR NEW."createdResourceId" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Import row initial state is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "DataImportRow_insert_guard"
  BEFORE INSERT ON "DataImportRow"
  FOR EACH ROW EXECUTE FUNCTION phase12_import_row_insert_guard();

CREATE OR REPLACE FUNCTION phase12_historical_import_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  batch_status "DataImportStatus";
BEGIN
  SELECT status INTO batch_status
    FROM "DataImportBatch"
   WHERE id = NEW."batchId"
     AND "organizationId" = NEW."organizationId";
  IF batch_status <> 'COMMITTING' THEN
    RAISE EXCEPTION 'Historical import records require a committing batch';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "HistoricalImportRecord_insert_guard"
  BEFORE INSERT ON "HistoricalImportRecord"
  FOR EACH ROW EXECUTE FUNCTION phase12_historical_import_insert_guard();

CREATE OR REPLACE FUNCTION phase12_export_job_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'PENDING'
    OR NEW."storageKey" IS NOT NULL
    OR NEW.checksum IS NOT NULL
    OR NEW."byteSize" IS NOT NULL
    OR NEW."errorMessage" IS NOT NULL
    OR NEW."startedAt" IS NOT NULL
    OR NEW."completedAt" IS NOT NULL
  THEN
    RAISE EXCEPTION 'Export job initial state is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrganizationExportJob_insert_guard"
  BEFORE INSERT ON "OrganizationExportJob"
  FOR EACH ROW EXECUTE FUNCTION phase12_export_job_insert_guard();

CREATE OR REPLACE FUNCTION phase12_closure_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."retentionUntil" IS NOT NULL
    OR NEW."scheduledDeletionAt" IS NOT NULL
    OR (NEW."legalHold" AND NEW.status <> 'LEGAL_HOLD')
    OR (NOT NEW."legalHold" AND NEW."exportJobId" IS NULL AND NEW.status <> 'EXPORT_PENDING')
    OR (NOT NEW."legalHold" AND NEW."exportJobId" IS NOT NULL AND NEW.status <> 'REQUESTED')
  THEN
    RAISE EXCEPTION 'Organization closure initial state is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrganizationClosureRequest_insert_guard"
  BEFORE INSERT ON "OrganizationClosureRequest"
  FOR EACH ROW EXECUTE FUNCTION phase12_closure_insert_guard();
