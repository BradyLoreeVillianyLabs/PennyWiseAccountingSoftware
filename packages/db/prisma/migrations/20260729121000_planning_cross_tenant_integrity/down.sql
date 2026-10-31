DO $rollback$
BEGIN
  IF to_regclass('public."PurchaseRequestLine"') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "PurchaseRequestLine" DROP CONSTRAINT "PurchaseRequestLine_organizationId_accountId_fkey";
ALTER TABLE "PurchaseRequestLine" DROP CONSTRAINT "PurchaseRequestLine_organizationId_purchaseRequestId_fkey";
ALTER TABLE "PurchaseRequestLine"
  ADD CONSTRAINT "PurchaseRequestLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequestLine"
  ADD CONSTRAINT "PurchaseRequestLine_purchaseRequestId_fkey"
  FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseRequest" DROP CONSTRAINT "PurchaseRequest_organizationId_vendorId_fkey";
ALTER TABLE "PurchaseRequest"
  ADD CONSTRAINT "PurchaseRequest_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BudgetLine" DROP CONSTRAINT "BudgetLine_organizationId_accountId_fkey";
ALTER TABLE "BudgetLine" DROP CONSTRAINT "BudgetLine_organizationId_budgetPlanId_fkey";
ALTER TABLE "BudgetLine"
  ADD CONSTRAINT "BudgetLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BudgetLine"
  ADD CONSTRAINT "BudgetLine_budgetPlanId_fkey"
  FOREIGN KEY ("budgetPlanId") REFERENCES "BudgetPlan"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "PurchaseRequest_organizationId_id_key";
  DROP INDEX "BudgetPlan_organizationId_id_key";

END;
$rollback$;
