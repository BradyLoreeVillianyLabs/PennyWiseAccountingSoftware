DO $rollback$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'BudgetPlan',
    'BudgetLine',
    'CashForecastAssumption',
    'PurchaseRequest',
    'PurchaseRequestLine',
    'WorkflowPreferences',
    'CustomerDepositRequest',
    'ProgressBillingPlan',
    'ProgressBillingMilestone',
    'ProgressBillingAllocation',
    'FixedAssetClass',
    'FixedAsset'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', table_name);
    END IF;
  END LOOP;
END;
$rollback$;
