DO $$
BEGIN
  IF to_regclass('public."DesignPartnerPilot"') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE ON TABLE "DesignPartnerPilot" FROM clearledger_runtime;
  END IF;
END $$;
DROP POLICY IF EXISTS "DesignPartnerPilot_tenant_policy" ON "DesignPartnerPilot";
DROP INDEX IF EXISTS "DesignPartnerPilot_organizationId_workflowStatus_idx";
DROP INDEX IF EXISTS "DesignPartnerPilot_organizationId_decisionDueDate_idx";
DROP TABLE IF EXISTS "DesignPartnerPilot";
DROP TYPE IF EXISTS "DesignPartnerDecision";
DROP TYPE IF EXISTS "DesignPartnerPilotStatus";
