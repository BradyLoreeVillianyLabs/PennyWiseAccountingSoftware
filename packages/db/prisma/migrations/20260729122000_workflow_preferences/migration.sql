CREATE TABLE "WorkflowPreferences" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "profileKey" TEXT NOT NULL DEFAULT 'SOLO_SERVICE',
  "sourcePresetKey" TEXT,
  "cashPlanningEnabled" BOOLEAN NOT NULL DEFAULT true,
  "purchaseRequestsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "purchaseApprovalThresholdMinor" BIGINT NOT NULL DEFAULT 0,
  "requireSeparatePurchaseApprover" BOOLEAN NOT NULL DEFAULT false,
  "customerDepositsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "progressBillingEnabled" BOOLEAN NOT NULL DEFAULT false,
  "fixedAssetRegisterEnabled" BOOLEAN NOT NULL DEFAULT false,
  "payrollSummaryImportEnabled" BOOLEAN NOT NULL DEFAULT false,
  "customizedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowPreferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowPreferences_profileKey_check"
    CHECK ("profileKey" IN ('SOLO_SERVICE', 'PROJECT_TRADES', 'BOOKKEEPER_MANAGED', 'PRODUCT_OPERATIONS')),
  CONSTRAINT "WorkflowPreferences_purchaseApprovalThresholdMinor_check"
    CHECK ("purchaseApprovalThresholdMinor" >= 0),
  CONSTRAINT "WorkflowPreferences_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "WorkflowPreferences_organizationId_key"
  ON "WorkflowPreferences"("organizationId");
CREATE INDEX "WorkflowPreferences_organizationId_profileKey_idx"
  ON "WorkflowPreferences"("organizationId", "profileKey");

ALTER TABLE "WorkflowPreferences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "WorkflowPreferences_tenant_policy"
  ON "WorkflowPreferences"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "WorkflowPreferences"
TO clearledger_runtime;
