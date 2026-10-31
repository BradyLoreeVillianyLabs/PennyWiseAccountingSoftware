ALTER TABLE "CustomerDepositRequest"
  ADD CONSTRAINT "CustomerDepositRequest_status_metadata_check"
  CHECK (
    CASE "status"
      WHEN 'DRAFT' THEN
        "submittedAt" IS NULL
        AND "approvedAt" IS NULL
        AND "approvedByUserId" IS NULL
        AND "rejectedAt" IS NULL
        AND "rejectedByUserId" IS NULL
      WHEN 'SUBMITTED' THEN
        "submittedAt" IS NOT NULL
        AND "approvedAt" IS NULL
        AND "approvedByUserId" IS NULL
        AND "rejectedAt" IS NULL
        AND "rejectedByUserId" IS NULL
      WHEN 'APPROVED' THEN
        "submittedAt" IS NOT NULL
        AND "approvedAt" IS NOT NULL
        AND "approvedByUserId" IS NOT NULL
        AND "rejectedAt" IS NULL
        AND "rejectedByUserId" IS NULL
      WHEN 'REJECTED' THEN
        "submittedAt" IS NOT NULL
        AND "approvedAt" IS NULL
        AND "approvedByUserId" IS NULL
        AND "rejectedAt" IS NOT NULL
        AND "rejectedByUserId" IS NOT NULL
      WHEN 'CANCELLED' THEN btrim(COALESCE("decisionNote", '')) <> ''
      ELSE false
    END
  );

ALTER TABLE "ProgressBillingPlan"
  ADD CONSTRAINT "ProgressBillingPlan_status_metadata_check"
  CHECK (
    CASE "status"
      WHEN 'DRAFT' THEN
        "submittedAt" IS NULL
        AND "approvedAt" IS NULL
        AND "approvedByUserId" IS NULL
        AND "rejectedAt" IS NULL
        AND "rejectedByUserId" IS NULL
      WHEN 'SUBMITTED' THEN
        "submittedAt" IS NOT NULL
        AND "approvedAt" IS NULL
        AND "approvedByUserId" IS NULL
        AND "rejectedAt" IS NULL
        AND "rejectedByUserId" IS NULL
      WHEN 'APPROVED' THEN
        "submittedAt" IS NOT NULL
        AND "approvedAt" IS NOT NULL
        AND "approvedByUserId" IS NOT NULL
        AND "rejectedAt" IS NULL
        AND "rejectedByUserId" IS NULL
      WHEN 'REJECTED' THEN
        "submittedAt" IS NOT NULL
        AND "approvedAt" IS NULL
        AND "approvedByUserId" IS NULL
        AND "rejectedAt" IS NOT NULL
        AND "rejectedByUserId" IS NOT NULL
      WHEN 'CANCELLED' THEN btrim(COALESCE("decisionNote", '')) <> ''
      ELSE false
    END
  );

CREATE OR REPLACE FUNCTION validate_customer_deposit_ancestry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."estimateId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Estimate" estimate
    WHERE estimate."organizationId" = NEW."organizationId"
      AND estimate."id" = NEW."estimateId"
      AND estimate."customerId" = NEW."customerId"
  ) THEN
    RAISE EXCEPTION 'Customer deposit estimate must belong to the selected customer';
  END IF;

  IF NEW."projectId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Project" project
    WHERE project."organizationId" = NEW."organizationId"
      AND project."id" = NEW."projectId"
      AND project."customerId" = NEW."customerId"
  ) THEN
    RAISE EXCEPTION 'Customer deposit project must belong to the selected customer';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CustomerDepositRequest_validate_ancestry"
BEFORE INSERT OR UPDATE OF "organizationId", "customerId", "estimateId", "projectId"
ON "CustomerDepositRequest"
FOR EACH ROW EXECUTE FUNCTION validate_customer_deposit_ancestry();

CREATE OR REPLACE FUNCTION validate_progress_billing_project_ancestry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."projectId" IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM "Estimate" estimate
    JOIN "Project" project
      ON project."organizationId" = estimate."organizationId"
      AND project."customerId" = estimate."customerId"
    WHERE estimate."organizationId" = NEW."organizationId"
      AND estimate."id" = NEW."estimateId"
      AND project."id" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'Progress billing project and estimate must belong to the same customer';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProgressBillingPlan_validate_project_ancestry"
BEFORE INSERT OR UPDATE OF "organizationId", "estimateId", "projectId"
ON "ProgressBillingPlan"
FOR EACH ROW EXECUTE FUNCTION validate_progress_billing_project_ancestry();

CREATE OR REPLACE FUNCTION assert_progress_billing_reconciled(
  target_organization_id UUID,
  target_plan_id UUID
)
RETURNS VOID AS $$
DECLARE
  plan_record RECORD;
  milestone_count BIGINT;
  milestone_net BIGINT;
  milestone_tax BIGINT;
  milestone_total BIGINT;
BEGIN
  SELECT
    plan."estimateId",
    plan."estimateSubtotalSnapshotMinor",
    plan."estimateTaxSnapshotMinor",
    plan."estimateTotalSnapshotMinor"
  INTO plan_record
  FROM "ProgressBillingPlan" plan
  WHERE plan."organizationId" = target_organization_id
    AND plan."id" = target_plan_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*),
    COALESCE(SUM(milestone."plannedNetMinor"), 0),
    COALESCE(SUM(milestone."estimatedTaxMinor"), 0),
    COALESCE(SUM(milestone."estimatedTotalMinor"), 0)
  INTO milestone_count, milestone_net, milestone_tax, milestone_total
  FROM "ProgressBillingMilestone" milestone
  WHERE milestone."organizationId" = target_organization_id
    AND milestone."progressBillingPlanId" = target_plan_id;

  IF milestone_count = 0
    OR milestone_net <> plan_record."estimateSubtotalSnapshotMinor"
    OR milestone_tax <> plan_record."estimateTaxSnapshotMinor"
    OR milestone_total <> plan_record."estimateTotalSnapshotMinor"
  THEN
    RAISE EXCEPTION 'Progress billing milestones must reconcile exactly to the estimate snapshot';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProgressBillingMilestone" milestone
    LEFT JOIN LATERAL (
      SELECT
        COALESCE(SUM(allocation."plannedNetMinor"), 0) AS net,
        COALESCE(SUM(allocation."estimatedTaxMinor"), 0) AS tax,
        COALESCE(SUM(allocation."estimatedTotalMinor"), 0) AS total
      FROM "ProgressBillingAllocation" allocation
      WHERE allocation."organizationId" = milestone."organizationId"
        AND allocation."progressBillingMilestoneId" = milestone."id"
    ) allocation_totals ON true
    WHERE milestone."organizationId" = target_organization_id
      AND milestone."progressBillingPlanId" = target_plan_id
      AND (
        allocation_totals.net <> milestone."plannedNetMinor"
        OR allocation_totals.tax <> milestone."estimatedTaxMinor"
        OR allocation_totals.total <> milestone."estimatedTotalMinor"
      )
  ) THEN
    RAISE EXCEPTION 'Progress billing allocations must reconcile exactly to each milestone';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "ProgressBillingAllocation" allocation
    JOIN "ProgressBillingMilestone" milestone
      ON milestone."organizationId" = allocation."organizationId"
      AND milestone."id" = allocation."progressBillingMilestoneId"
    JOIN "EstimateLine" estimate_line
      ON estimate_line."organizationId" = allocation."organizationId"
      AND estimate_line."id" = allocation."estimateLineId"
    WHERE milestone."organizationId" = target_organization_id
      AND milestone."progressBillingPlanId" = target_plan_id
      AND estimate_line."estimateId" <> plan_record."estimateId"
  ) THEN
    RAISE EXCEPTION 'Progress billing allocations must reference lines from the plan estimate';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION validate_progress_billing_reconciliation()
RETURNS TRIGGER AS $$
DECLARE
  target_organization_id UUID;
  target_plan_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'ProgressBillingPlan' THEN
    target_organization_id := COALESCE(NEW."organizationId", OLD."organizationId");
    target_plan_id := COALESCE(NEW."id", OLD."id");
  ELSIF TG_TABLE_NAME = 'ProgressBillingMilestone' THEN
    target_organization_id := COALESCE(NEW."organizationId", OLD."organizationId");
    target_plan_id := COALESCE(NEW."progressBillingPlanId", OLD."progressBillingPlanId");
  ELSE
    target_organization_id := COALESCE(NEW."organizationId", OLD."organizationId");
    SELECT milestone."progressBillingPlanId"
    INTO target_plan_id
    FROM "ProgressBillingMilestone" milestone
    WHERE milestone."organizationId" = target_organization_id
      AND milestone."id" = COALESCE(
        NEW."progressBillingMilestoneId",
        OLD."progressBillingMilestoneId"
      );
  END IF;

  IF target_plan_id IS NOT NULL THEN
    PERFORM assert_progress_billing_reconciled(target_organization_id, target_plan_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "ProgressBillingPlan_reconciled"
AFTER INSERT OR UPDATE ON "ProgressBillingPlan"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_progress_billing_reconciliation();

CREATE CONSTRAINT TRIGGER "ProgressBillingMilestone_reconciled"
AFTER INSERT OR UPDATE OR DELETE ON "ProgressBillingMilestone"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_progress_billing_reconciliation();

CREATE CONSTRAINT TRIGGER "ProgressBillingAllocation_reconciled"
AFTER INSERT OR UPDATE OR DELETE ON "ProgressBillingAllocation"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION validate_progress_billing_reconciliation();
