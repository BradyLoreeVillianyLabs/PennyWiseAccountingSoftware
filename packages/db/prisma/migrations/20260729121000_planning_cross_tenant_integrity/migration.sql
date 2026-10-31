CREATE UNIQUE INDEX "BudgetPlan_organizationId_id_key" ON "BudgetPlan"("organizationId", "id");
CREATE UNIQUE INDEX "PurchaseRequest_organizationId_id_key" ON "PurchaseRequest"("organizationId", "id");

ALTER TABLE "BudgetLine" DROP CONSTRAINT "BudgetLine_budgetPlanId_fkey";
ALTER TABLE "BudgetLine" DROP CONSTRAINT "BudgetLine_accountId_fkey";
ALTER TABLE "BudgetLine"
  ADD CONSTRAINT "BudgetLine_organizationId_budgetPlanId_fkey"
  FOREIGN KEY ("organizationId", "budgetPlanId")
  REFERENCES "BudgetPlan"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BudgetLine"
  ADD CONSTRAINT "BudgetLine_organizationId_accountId_fkey"
  FOREIGN KEY ("organizationId", "accountId")
  REFERENCES "Account"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseRequest" DROP CONSTRAINT "PurchaseRequest_vendorId_fkey";
ALTER TABLE "PurchaseRequest"
  ADD CONSTRAINT "PurchaseRequest_organizationId_vendorId_fkey"
  FOREIGN KEY ("organizationId", "vendorId")
  REFERENCES "Vendor"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseRequestLine" DROP CONSTRAINT "PurchaseRequestLine_purchaseRequestId_fkey";
ALTER TABLE "PurchaseRequestLine" DROP CONSTRAINT "PurchaseRequestLine_accountId_fkey";
ALTER TABLE "PurchaseRequestLine"
  ADD CONSTRAINT "PurchaseRequestLine_organizationId_purchaseRequestId_fkey"
  FOREIGN KEY ("organizationId", "purchaseRequestId")
  REFERENCES "PurchaseRequest"("organizationId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseRequestLine"
  ADD CONSTRAINT "PurchaseRequestLine_organizationId_accountId_fkey"
  FOREIGN KEY ("organizationId", "accountId")
  REFERENCES "Account"("organizationId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
