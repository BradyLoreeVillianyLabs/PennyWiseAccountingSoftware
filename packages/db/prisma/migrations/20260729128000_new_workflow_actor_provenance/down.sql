DROP TRIGGER IF EXISTS "FixedAsset_runtime_actor_provenance" ON "FixedAsset";
DROP TRIGGER IF EXISTS "FixedAssetClass_runtime_actor_provenance" ON "FixedAssetClass";
DROP TRIGGER IF EXISTS "ProgressBillingPlan_runtime_actor_provenance"
ON "ProgressBillingPlan";
DROP TRIGGER IF EXISTS "CustomerDepositRequest_runtime_actor_provenance"
ON "CustomerDepositRequest";
DROP TRIGGER IF EXISTS "PurchaseRequest_runtime_actor_provenance" ON "PurchaseRequest";
DROP TRIGGER IF EXISTS "CashForecastAssumption_runtime_actor_provenance"
ON "CashForecastAssumption";
DROP TRIGGER IF EXISTS "BudgetPlan_runtime_actor_provenance" ON "BudgetPlan";
DROP FUNCTION IF EXISTS validate_runtime_actor_fields();
