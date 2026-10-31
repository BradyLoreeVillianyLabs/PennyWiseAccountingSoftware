DO $rollback$
BEGIN
  IF to_regclass('public."Invoice"') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS "Estimate_transition_guard" ON "Estimate";
DROP FUNCTION IF EXISTS phase17_estimate_transition_guard();
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_sourceEstimateId_fkey";
DROP INDEX IF EXISTS "Invoice_sourceEstimateId_key";
DROP INDEX IF EXISTS "Invoice_organizationId_sourceEstimateId_idx";
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "sourceEstimateId";
DROP TABLE IF EXISTS "Communication";
DROP TABLE IF EXISTS "RecurringSchedule";
DROP TABLE IF EXISTS "EstimateDelivery";
DROP TABLE IF EXISTS "EstimatePublicLink";
DROP TABLE IF EXISTS "EstimateLine";
DROP TABLE IF EXISTS "Estimate";
DROP TYPE IF EXISTS "CommunicationKind";
DROP TYPE IF EXISTS "CommunicationStatus";
DROP TYPE IF EXISTS "RecurringFrequency";
DROP TYPE IF EXISTS "RecurringScheduleStatus";
  DROP TYPE IF EXISTS "EstimateStatus";
END;
$rollback$;
