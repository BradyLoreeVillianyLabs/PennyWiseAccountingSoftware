CREATE TYPE "BudgetPeriodType" AS ENUM ('WEEK', 'MONTH');
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "ForecastDirection" AS ENUM ('INFLOW', 'OUTFLOW');
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "BudgetPlan" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "periodType" "BudgetPeriodType" NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BudgetPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BudgetPlan_dates_check" CHECK ("endDate" >= "startDate"),
  CONSTRAINT "BudgetPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BudgetPlan_organizationId_name_startDate_key" ON "BudgetPlan"("organizationId", "name", "startDate");
CREATE INDEX "BudgetPlan_organizationId_status_startDate_idx" ON "BudgetPlan"("organizationId", "status", "startDate");

CREATE TABLE "BudgetLine" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "budgetPlanId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "periodStart" DATE NOT NULL,
  "plannedMinor" BIGINT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BudgetLine_plannedMinor_check" CHECK ("plannedMinor" >= 0),
  CONSTRAINT "BudgetLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BudgetLine_budgetPlanId_fkey" FOREIGN KEY ("budgetPlanId") REFERENCES "BudgetPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BudgetLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BudgetLine_budgetPlanId_accountId_periodStart_key" ON "BudgetLine"("budgetPlanId", "accountId", "periodStart");
CREATE INDEX "BudgetLine_organizationId_periodStart_idx" ON "BudgetLine"("organizationId", "periodStart");
CREATE INDEX "BudgetLine_organizationId_accountId_periodStart_idx" ON "BudgetLine"("organizationId", "accountId", "periodStart");

CREATE TABLE "CashForecastAssumption" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "weekStart" DATE NOT NULL,
  "label" TEXT NOT NULL,
  "direction" "ForecastDirection" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "note" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashForecastAssumption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashForecastAssumption_amountMinor_check" CHECK ("amountMinor" >= 0),
  CONSTRAINT "CashForecastAssumption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CashForecastAssumption_organizationId_weekStart_idx" ON "CashForecastAssumption"("organizationId", "weekStart");

CREATE TABLE "PurchaseRequest" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "requestNumber" TEXT NOT NULL,
  "vendorId" UUID,
  "requestedDate" DATE NOT NULL,
  "neededByDate" DATE,
  "purpose" TEXT NOT NULL,
  "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'DRAFT',
  "totalMinor" BIGINT NOT NULL,
  "submittedAt" TIMESTAMPTZ(6),
  "approvedAt" TIMESTAMPTZ(6),
  "approvedByUserId" UUID,
  "rejectedAt" TIMESTAMPTZ(6),
  "rejectedByUserId" UUID,
  "decisionNote" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseRequest_totalMinor_check" CHECK ("totalMinor" >= 0),
  CONSTRAINT "PurchaseRequest_dates_check" CHECK ("neededByDate" IS NULL OR "neededByDate" >= "requestedDate"),
  CONSTRAINT "PurchaseRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PurchaseRequest_organizationId_requestNumber_key" ON "PurchaseRequest"("organizationId", "requestNumber");
CREATE INDEX "PurchaseRequest_organizationId_status_requestedDate_idx" ON "PurchaseRequest"("organizationId", "status", "requestedDate");
CREATE INDEX "PurchaseRequest_organizationId_vendorId_status_idx" ON "PurchaseRequest"("organizationId", "vendorId", "status");

CREATE TABLE "PurchaseRequestLine" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "purchaseRequestId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantityMicros" BIGINT NOT NULL,
  "unitCostMinor" BIGINT NOT NULL,
  "totalMinor" BIGINT NOT NULL,
  "accountId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseRequestLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseRequestLine_values_check" CHECK ("quantityMicros" > 0 AND "unitCostMinor" >= 0 AND "totalMinor" >= 0),
  CONSTRAINT "PurchaseRequestLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseRequestLine_purchaseRequestId_fkey" FOREIGN KEY ("purchaseRequestId") REFERENCES "PurchaseRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PurchaseRequestLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PurchaseRequestLine_purchaseRequestId_lineNumber_key" ON "PurchaseRequestLine"("purchaseRequestId", "lineNumber");
CREATE INDEX "PurchaseRequestLine_organizationId_purchaseRequestId_idx" ON "PurchaseRequestLine"("organizationId", "purchaseRequestId");

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'BudgetPlan',
    'BudgetLine',
    'CashForecastAssumption',
    'PurchaseRequest',
    'PurchaseRequestLine'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "BudgetPlan",
  "BudgetLine",
  "CashForecastAssumption",
  "PurchaseRequest",
  "PurchaseRequestLine"
TO clearledger_runtime;
