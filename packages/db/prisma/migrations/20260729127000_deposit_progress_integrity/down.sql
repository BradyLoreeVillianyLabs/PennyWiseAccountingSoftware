DO $rollback$
BEGIN
  IF to_regclass('public."ProgressBillingPlan"') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS "ProgressBillingAllocation_reconciled" ON "ProgressBillingAllocation";
DROP TRIGGER IF EXISTS "ProgressBillingMilestone_reconciled" ON "ProgressBillingMilestone";
DROP TRIGGER IF EXISTS "ProgressBillingPlan_reconciled" ON "ProgressBillingPlan";
DROP FUNCTION IF EXISTS validate_progress_billing_reconciliation();
DROP FUNCTION IF EXISTS assert_progress_billing_reconciled(UUID, UUID);

DROP TRIGGER IF EXISTS "ProgressBillingPlan_validate_project_ancestry" ON "ProgressBillingPlan";
DROP FUNCTION IF EXISTS validate_progress_billing_project_ancestry();

DROP TRIGGER IF EXISTS "CustomerDepositRequest_validate_ancestry"
ON "CustomerDepositRequest";
DROP FUNCTION IF EXISTS validate_customer_deposit_ancestry();

ALTER TABLE "ProgressBillingPlan"
  DROP CONSTRAINT IF EXISTS "ProgressBillingPlan_status_metadata_check";
ALTER TABLE "CustomerDepositRequest"
  DROP CONSTRAINT IF EXISTS "CustomerDepositRequest_status_metadata_check";

END;
$rollback$;
