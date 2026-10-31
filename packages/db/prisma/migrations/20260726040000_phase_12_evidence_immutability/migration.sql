CREATE OR REPLACE FUNCTION phase12_import_batch_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
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
  THEN
    RAISE EXCEPTION 'Import source evidence is immutable';
  END IF;

  IF OLD.status IN ('COMMITTED', 'RECONCILED', 'COMPENSATION_REQUIRED')
    AND (
      NEW.mapping IS DISTINCT FROM OLD.mapping
      OR NEW."errorReport" IS DISTINCT FROM OLD."errorReport"
      OR NEW.reconciliation IS DISTINCT FROM OLD.reconciliation
      OR NEW."committedAt" IS DISTINCT FROM OLD."committedAt"
    )
  THEN
    RAISE EXCEPTION 'Final import evidence is immutable';
  END IF;

  IF OLD.status = 'COMMITTED' THEN
    IF NEW.status NOT IN ('COMMITTED', 'RECONCILED') THEN
      RAISE EXCEPTION 'Committed import status cannot move backward';
    END IF;
    IF NEW.status = 'COMMITTED'
      AND NEW."acknowledgedAt" IS DISTINCT FROM OLD."acknowledgedAt"
    THEN
      RAISE EXCEPTION 'Import acknowledgement requires reconciled status';
    END IF;
    IF NEW.status = 'RECONCILED'
      AND (OLD."acknowledgedAt" IS NOT NULL OR NEW."acknowledgedAt" IS NULL)
    THEN
      RAISE EXCEPTION 'Import acknowledgement transition is invalid';
    END IF;
  ELSIF OLD.status IN ('RECONCILED', 'COMPENSATION_REQUIRED') THEN
    IF NEW.status <> OLD.status
      OR NEW."acknowledgedAt" IS DISTINCT FROM OLD."acknowledgedAt"
    THEN
      RAISE EXCEPTION 'Final import status is immutable';
    END IF;
  END IF;

  IF NEW.status = 'COMMITTED'
    AND (NEW."committedAt" IS NULL OR NEW.reconciliation IS NULL)
  THEN
    RAISE EXCEPTION 'Committed import requires reconciliation evidence';
  END IF;
  IF NEW.status = 'RECONCILED' AND NEW."acknowledgedAt" IS NULL THEN
    RAISE EXCEPTION 'Reconciled import requires acknowledgement evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION phase12_export_job_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId"
    OR NEW."includeAttachments" <> OLD."includeAttachments"
    OR NEW."schemaVersion" <> OLD."schemaVersion"
    OR NEW."downloadTokenHash" <> OLD."downloadTokenHash"
    OR NEW."expiresAt" <> OLD."expiresAt"
    OR NEW."requestedByUserId" <> OLD."requestedByUserId"
    OR NEW."createdAt" <> OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Export request evidence is immutable';
  END IF;

  IF OLD.status = 'PENDING' AND NEW.status NOT IN ('PENDING', 'PROCESSING', 'FAILED') THEN
    RAISE EXCEPTION 'Invalid pending export transition';
  ELSIF OLD.status = 'PROCESSING'
    AND NEW.status NOT IN ('PROCESSING', 'READY', 'FAILED')
  THEN
    RAISE EXCEPTION 'Invalid processing export transition';
  ELSIF OLD.status = 'READY' THEN
    IF NEW.status NOT IN ('READY', 'EXPIRED')
      OR NEW."storageKey" IS DISTINCT FROM OLD."storageKey"
      OR NEW.checksum IS DISTINCT FROM OLD.checksum
      OR NEW."byteSize" IS DISTINCT FROM OLD."byteSize"
      OR NEW."completedAt" IS DISTINCT FROM OLD."completedAt"
    THEN
      RAISE EXCEPTION 'Ready export evidence is immutable';
    END IF;
  ELSIF OLD.status IN ('FAILED', 'EXPIRED') AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Terminal export job is immutable';
  END IF;

  IF NEW.status = 'READY'
    AND (
      NEW."storageKey" IS NULL
      OR NEW.checksum IS NULL
      OR NEW."byteSize" IS NULL
      OR NEW."completedAt" IS NULL
    )
  THEN
    RAISE EXCEPTION 'Ready export requires complete integrity evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrganizationExportJob_evidence_trigger"
  BEFORE UPDATE ON "OrganizationExportJob"
  FOR EACH ROW EXECUTE FUNCTION phase12_export_job_guard();

CREATE OR REPLACE FUNCTION phase12_closure_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId"
    OR NEW.reason <> OLD.reason
    OR NEW."exportJobId" IS DISTINCT FROM OLD."exportJobId"
    OR NEW."legalHold" <> OLD."legalHold"
    OR NEW."requestedByUserId" <> OLD."requestedByUserId"
    OR NEW."createdAt" <> OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Organization closure request evidence is immutable';
  END IF;

  IF OLD.status = 'RETENTION_SCHEDULED'
    AND (
      NEW.status <> OLD.status
      OR NEW."retentionUntil" IS DISTINCT FROM OLD."retentionUntil"
      OR NEW."scheduledDeletionAt" IS DISTINCT FROM OLD."scheduledDeletionAt"
    )
  THEN
    RAISE EXCEPTION 'Scheduled retention evidence is immutable';
  END IF;

  IF NEW.status = 'RETENTION_SCHEDULED'
    AND (
      NEW."legalHold"
      OR NEW."retentionUntil" IS NULL
      OR NEW."scheduledDeletionAt" IS NULL
      OR NEW."retentionUntil" <> NEW."scheduledDeletionAt"
    )
  THEN
    RAISE EXCEPTION 'Retention scheduling evidence is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrganizationClosureRequest_evidence_trigger"
  BEFORE UPDATE ON "OrganizationClosureRequest"
  FOR EACH ROW EXECUTE FUNCTION phase12_closure_guard();
