CREATE TYPE "CustomerDepositClassification" AS ENUM (
  'REFUNDABLE_DEPOSIT',
  'ADVANCE_PAYMENT'
);
CREATE TYPE "CustomerDepositRequestStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);
CREATE TYPE "ProgressBillingPlanStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);
CREATE TYPE "ProgressBillingBasis" AS ENUM (
  'PERCENT_OF_ESTIMATE',
  'FIXED_SUBTOTAL',
  'REMAINING_BALANCE'
);

CREATE UNIQUE INDEX "Customer_organizationId_id_key"
  ON "Customer"("organizationId", "id");
CREATE UNIQUE INDEX "Estimate_organizationId_id_key"
  ON "Estimate"("organizationId", "id");
CREATE UNIQUE INDEX "EstimateLine_organizationId_id_key"
  ON "EstimateLine"("organizationId", "id");
CREATE UNIQUE INDEX "Project_organizationId_id_key"
  ON "Project"("organizationId", "id");

CREATE TABLE "CustomerDepositRequest" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "requestNumber" TEXT NOT NULL,
  "customerId" UUID NOT NULL,
  "estimateId" UUID,
  "projectId" UUID,
  "classification" "CustomerDepositClassification" NOT NULL,
  "requestDate" DATE NOT NULL,
  "dueDate" DATE,
  "amountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "purpose" TEXT NOT NULL,
  "customerMessage" TEXT,
  "status" "CustomerDepositRequestStatus" NOT NULL DEFAULT 'DRAFT',
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
  CONSTRAINT "CustomerDepositRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerDepositRequest_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "CustomerDepositRequest_date_check"
    CHECK ("dueDate" IS NULL OR "dueDate" >= "requestDate"),
  CONSTRAINT "CustomerDepositRequest_currency_check" CHECK ("currency" = 'CAD'),
  CONSTRAINT "CustomerDepositRequest_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerDepositRequest_customer_fkey"
    FOREIGN KEY ("organizationId", "customerId")
    REFERENCES "Customer"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomerDepositRequest_estimate_fkey"
    FOREIGN KEY ("organizationId", "estimateId")
    REFERENCES "Estimate"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomerDepositRequest_project_fkey"
    FOREIGN KEY ("organizationId", "projectId")
    REFERENCES "Project"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomerDepositRequest_organizationId_requestNumber_key"
  ON "CustomerDepositRequest"("organizationId", "requestNumber");
CREATE UNIQUE INDEX "CustomerDepositRequest_organizationId_id_key"
  ON "CustomerDepositRequest"("organizationId", "id");
CREATE INDEX "CustomerDepositRequest_organizationId_status_requestDate_idx"
  ON "CustomerDepositRequest"("organizationId", "status", "requestDate");
CREATE INDEX "CustomerDepositRequest_organizationId_customerId_status_idx"
  ON "CustomerDepositRequest"("organizationId", "customerId", "status");
CREATE INDEX "CustomerDepositRequest_organizationId_estimateId_idx"
  ON "CustomerDepositRequest"("organizationId", "estimateId");
CREATE INDEX "CustomerDepositRequest_organizationId_projectId_idx"
  ON "CustomerDepositRequest"("organizationId", "projectId");

CREATE TABLE "ProgressBillingPlan" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "planNumber" TEXT NOT NULL,
  "estimateId" UUID NOT NULL,
  "projectId" UUID,
  "status" "ProgressBillingPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "estimateVersionSnapshot" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "estimateSubtotalSnapshotMinor" BIGINT NOT NULL,
  "estimateTaxSnapshotMinor" BIGINT NOT NULL,
  "estimateTotalSnapshotMinor" BIGINT NOT NULL,
  "notes" TEXT,
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
  CONSTRAINT "ProgressBillingPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgressBillingPlan_snapshot_check" CHECK (
    "estimateVersionSnapshot" > 0
    AND "estimateSubtotalSnapshotMinor" >= 0
    AND "estimateTaxSnapshotMinor" >= 0
    AND "estimateTotalSnapshotMinor"
      = "estimateSubtotalSnapshotMinor" + "estimateTaxSnapshotMinor"
  ),
  CONSTRAINT "ProgressBillingPlan_currency_check" CHECK ("currency" = 'CAD'),
  CONSTRAINT "ProgressBillingPlan_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProgressBillingPlan_estimate_fkey"
    FOREIGN KEY ("organizationId", "estimateId")
    REFERENCES "Estimate"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProgressBillingPlan_project_fkey"
    FOREIGN KEY ("organizationId", "projectId")
    REFERENCES "Project"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProgressBillingPlan_organizationId_planNumber_key"
  ON "ProgressBillingPlan"("organizationId", "planNumber");
CREATE UNIQUE INDEX "ProgressBillingPlan_organizationId_id_key"
  ON "ProgressBillingPlan"("organizationId", "id");
CREATE UNIQUE INDEX "ProgressBillingPlan_active_estimate_key"
  ON "ProgressBillingPlan"("organizationId", "estimateId")
  WHERE "status" IN ('DRAFT', 'SUBMITTED', 'APPROVED');
CREATE INDEX "ProgressBillingPlan_organizationId_estimateId_status_idx"
  ON "ProgressBillingPlan"("organizationId", "estimateId", "status");
CREATE INDEX "ProgressBillingPlan_organizationId_projectId_status_idx"
  ON "ProgressBillingPlan"("organizationId", "projectId", "status");

CREATE TABLE "ProgressBillingMilestone" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "progressBillingPlanId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "customerDescription" TEXT,
  "dueDate" DATE,
  "basis" "ProgressBillingBasis" NOT NULL,
  "ratioMicros" BIGINT,
  "fixedSubtotalMinor" BIGINT,
  "plannedNetMinor" BIGINT NOT NULL,
  "estimatedTaxMinor" BIGINT NOT NULL,
  "estimatedTotalMinor" BIGINT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressBillingMilestone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgressBillingMilestone_amount_check" CHECK (
    "sequence" > 0
    AND "plannedNetMinor" > 0
    AND "estimatedTaxMinor" >= 0
    AND "estimatedTotalMinor" = "plannedNetMinor" + "estimatedTaxMinor"
  ),
  CONSTRAINT "ProgressBillingMilestone_basis_check" CHECK (
    (
      "basis" = 'PERCENT_OF_ESTIMATE'
      AND "ratioMicros" > 0
      AND "ratioMicros" <= 1000000
      AND "fixedSubtotalMinor" IS NULL
    )
    OR (
      "basis" = 'FIXED_SUBTOTAL'
      AND "fixedSubtotalMinor" > 0
      AND "ratioMicros" IS NULL
    )
    OR (
      "basis" = 'REMAINING_BALANCE'
      AND "ratioMicros" IS NULL
      AND "fixedSubtotalMinor" IS NULL
    )
  ),
  CONSTRAINT "ProgressBillingMilestone_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProgressBillingMilestone_plan_fkey"
    FOREIGN KEY ("organizationId", "progressBillingPlanId")
    REFERENCES "ProgressBillingPlan"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProgressBillingMilestone_plan_sequence_key"
  ON "ProgressBillingMilestone"("progressBillingPlanId", "sequence");
CREATE UNIQUE INDEX "ProgressBillingMilestone_organizationId_id_key"
  ON "ProgressBillingMilestone"("organizationId", "id");
CREATE INDEX "ProgressBillingMilestone_organizationId_plan_idx"
  ON "ProgressBillingMilestone"("organizationId", "progressBillingPlanId");

CREATE TABLE "ProgressBillingAllocation" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "progressBillingMilestoneId" UUID NOT NULL,
  "estimateLineId" UUID NOT NULL,
  "plannedNetMinor" BIGINT NOT NULL,
  "estimatedTaxMinor" BIGINT NOT NULL,
  "estimatedTotalMinor" BIGINT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressBillingAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgressBillingAllocation_amount_check" CHECK (
    "plannedNetMinor" >= 0
    AND "estimatedTaxMinor" >= 0
    AND "estimatedTotalMinor" = "plannedNetMinor" + "estimatedTaxMinor"
  ),
  CONSTRAINT "ProgressBillingAllocation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProgressBillingAllocation_milestone_fkey"
    FOREIGN KEY ("organizationId", "progressBillingMilestoneId")
    REFERENCES "ProgressBillingMilestone"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProgressBillingAllocation_estimateLine_fkey"
    FOREIGN KEY ("organizationId", "estimateLineId")
    REFERENCES "EstimateLine"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProgressBillingAllocation_milestone_line_key"
  ON "ProgressBillingAllocation"("progressBillingMilestoneId", "estimateLineId");
CREATE INDEX "ProgressBillingAllocation_organizationId_estimateLineId_idx"
  ON "ProgressBillingAllocation"("organizationId", "estimateLineId");

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'CustomerDepositRequest',
    'ProgressBillingPlan',
    'ProgressBillingMilestone',
    'ProgressBillingAllocation'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy',
      table_name
    );
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "CustomerDepositRequest",
  "ProgressBillingPlan",
  "ProgressBillingMilestone",
  "ProgressBillingAllocation"
TO clearledger_runtime;
