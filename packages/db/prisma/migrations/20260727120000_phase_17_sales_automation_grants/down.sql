DO $rollback$
BEGIN
  IF to_regclass('public."Estimate"') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE
      "Estimate",
      "EstimateLine",
      "EstimatePublicLink",
      "EstimateDelivery",
      "RecurringSchedule",
      "Communication"
    FROM clearledger_runtime;
  END IF;
END;
$rollback$;
