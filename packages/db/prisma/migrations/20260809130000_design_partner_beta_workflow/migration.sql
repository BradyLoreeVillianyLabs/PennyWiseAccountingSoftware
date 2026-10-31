-- A manual, tenant-scoped beta workflow. It is intentionally not a payment,
-- subscription provider integration, contact system, or proof of third-party
-- consent. The organization owner/admin records local operational choices.
CREATE TYPE "DesignPartnerPilotStatus" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'EXITED'
);

CREATE TYPE "DesignPartnerDecision" AS ENUM (
  'PENDING',
  'CONTINUE',
  'PAUSE',
  'EXIT'
);

CREATE TABLE "DesignPartnerPilot" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "partnerLabel" TEXT NOT NULL,
  "partnerProfileNotes" TEXT,
  "pilotStartDate" DATE NOT NULL,
  "pilotEndDate" DATE NOT NULL,
  "decisionDueDate" DATE NOT NULL,
  "workflowSummary" TEXT NOT NULL,
  "workflowStatus" "DesignPartnerPilotStatus" NOT NULL DEFAULT 'DRAFT',
  "pilotSupportOptIn" BOOLEAN NOT NULL DEFAULT false,
  "aggregateOutcomeOptIn" BOOLEAN NOT NULL DEFAULT false,
  "caseStudyOptIn" BOOLEAN NOT NULL DEFAULT false,
  "outcomeMetrics" JSONB NOT NULL,
  "outcomeNotes" TEXT,
  "decision" "DesignPartnerDecision" NOT NULL DEFAULT 'PENDING',
  "decisionAt" TIMESTAMPTZ(6),
  "decisionNotes" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DesignPartnerPilot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DesignPartnerPilot_organizationId_key" UNIQUE ("organizationId"),
  CONSTRAINT "DesignPartnerPilot_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DesignPartnerPilot_dates_check"
    CHECK ("pilotEndDate" >= "pilotStartDate"),
  CONSTRAINT "DesignPartnerPilot_decision_due_check"
    CHECK ("decisionDueDate" = ("pilotStartDate" + 30)),
  CONSTRAINT "DesignPartnerPilot_decision_timestamp_check"
    CHECK (
      ("decision" = 'PENDING' AND "decisionAt" IS NULL)
      OR ("decision" <> 'PENDING' AND "decisionAt" IS NOT NULL)
    )
);

CREATE INDEX "DesignPartnerPilot_organizationId_workflowStatus_idx"
  ON "DesignPartnerPilot"("organizationId", "workflowStatus");
CREATE INDEX "DesignPartnerPilot_organizationId_decisionDueDate_idx"
  ON "DesignPartnerPilot"("organizationId", "decisionDueDate");

ALTER TABLE "DesignPartnerPilot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DesignPartnerPilot" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DesignPartnerPilot_tenant_policy" ON "DesignPartnerPilot"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "DesignPartnerPilot" TO clearledger_runtime;

COMMENT ON TABLE "DesignPartnerPilot" IS
  'Tenant-scoped manual design-partner beta record. It does not contact a partner, verify external consent, invoke payments, or alter accounting records.';
