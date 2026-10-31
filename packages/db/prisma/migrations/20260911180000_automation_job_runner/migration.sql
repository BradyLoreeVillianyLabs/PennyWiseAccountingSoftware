CREATE TABLE "AutomationJobLease" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "jobName" VARCHAR(120) NOT NULL,
  "leaseToken" VARCHAR(80),
  "leaseExpiresAt" TIMESTAMPTZ(6),
  "nextRunAt" TIMESTAMPTZ(6),
  "lastRunAt" TIMESTAMPTZ(6),
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "lastErrorCode" VARCHAR(160),
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "deadLetteredAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "AutomationJobLease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationJobRun" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "jobName" VARCHAR(120) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(6),
  "claimedCount" INTEGER NOT NULL DEFAULT 0,
  "succeededCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCode" VARCHAR(160),
  "details" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationJobRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationJobLease_organizationId_jobName_key"
  ON "AutomationJobLease" ("organizationId", "jobName");
CREATE INDEX "AutomationJobLease_organizationId_nextRunAt_paused_idx"
  ON "AutomationJobLease" ("organizationId", "nextRunAt", "paused");
CREATE INDEX "AutomationJobRun_organizationId_jobName_startedAt_idx"
  ON "AutomationJobRun" ("organizationId", "jobName", "startedAt");
CREATE INDEX "AutomationJobRun_organizationId_status_startedAt_idx"
  ON "AutomationJobRun" ("organizationId", "status", "startedAt");

ALTER TABLE "AutomationJobLease"
  ADD CONSTRAINT "AutomationJobLease_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationJobRun"
  ADD CONSTRAINT "AutomationJobRun_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "AutomationJobLease", "AutomationJobRun"
  TO clearledger_runtime;

ALTER TABLE "AutomationJobLease" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationJobLease" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AutomationJobLease_tenant_policy" ON "AutomationJobLease"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "AutomationJobRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AutomationJobRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AutomationJobRun_tenant_policy" ON "AutomationJobRun"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

CREATE OR REPLACE FUNCTION list_automation_organizations()
RETURNS TABLE (
  "organizationId" UUID,
  "membershipId" UUID,
  "ownerUserId" UUID,
  "ownerEmail" TEXT,
  "ownerDisplayName" TEXT,
  "displayName" TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT organization."id",
         membership."id",
         owner_user."id",
         owner_user."email",
         owner_user."displayName",
         organization."displayName"
  FROM public."Organization" organization
  JOIN public."Membership" membership
    ON membership."organizationId" = organization."id"
   AND membership."role" = 'OWNER'
   AND membership."status" = 'ACTIVE'
  JOIN public."User" owner_user ON owner_user."id" = membership."userId"
  ORDER BY organization."displayName", organization."id";
$$;

REVOKE ALL ON FUNCTION list_automation_organizations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_automation_organizations() TO clearledger_runtime;
