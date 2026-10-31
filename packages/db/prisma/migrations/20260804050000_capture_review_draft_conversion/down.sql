DROP TRIGGER IF EXISTS "CaptureReviewConversion_append_only" ON "CaptureReviewConversion";
DROP FUNCTION IF EXISTS prevent_capture_review_conversion_mutation();

DO $$
BEGIN
  IF to_regclass('public."CaptureReview"') IS NOT NULL THEN
    ALTER TABLE "CaptureReview" NO FORCE ROW LEVEL SECURITY;
  END IF;
END $$;

DROP TABLE IF EXISTS "CaptureReviewConversion";
DROP TABLE IF EXISTS "ImmediateExpenseDraftLine";
DROP TABLE IF EXISTS "ImmediateExpenseDraft";

DROP INDEX IF EXISTS "TaxCodeVersion_organizationId_id_key";
DROP INDEX IF EXISTS "TaxCode_organizationId_id_key";
DROP INDEX IF EXISTS "CaptureReview_organizationId_id_key";
DROP TYPE IF EXISTS "CaptureConversionTarget";
