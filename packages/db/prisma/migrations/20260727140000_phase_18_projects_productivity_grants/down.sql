DO $rollback$
BEGIN
  IF to_regclass('public."Project"') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE
      "Project",
      "ProjectTimeEntry",
      "MileageLog",
      "CaptureReview"
    FROM clearledger_runtime;
  END IF;
END;
$rollback$;
