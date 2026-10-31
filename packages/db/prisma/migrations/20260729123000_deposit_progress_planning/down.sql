DROP TABLE IF EXISTS "ProgressBillingAllocation";
DROP TABLE IF EXISTS "ProgressBillingMilestone";
DROP TABLE IF EXISTS "ProgressBillingPlan";
DROP TABLE IF EXISTS "CustomerDepositRequest";

DROP INDEX IF EXISTS "Project_organizationId_id_key";
DROP INDEX IF EXISTS "EstimateLine_organizationId_id_key";
DROP INDEX IF EXISTS "Estimate_organizationId_id_key";
DROP INDEX IF EXISTS "Customer_organizationId_id_key";

DROP TYPE IF EXISTS "ProgressBillingBasis";
DROP TYPE IF EXISTS "ProgressBillingPlanStatus";
DROP TYPE IF EXISTS "CustomerDepositRequestStatus";
DROP TYPE IF EXISTS "CustomerDepositClassification";
