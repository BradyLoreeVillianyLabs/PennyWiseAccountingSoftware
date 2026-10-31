DO $rollback$
BEGIN
  IF to_regclass('public."CaptureReview"') IS NOT NULL THEN
    ALTER TABLE "CaptureReview" DROP COLUMN IF EXISTS "version";
  END IF;
END;
$rollback$;
