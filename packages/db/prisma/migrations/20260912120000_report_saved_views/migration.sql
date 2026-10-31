CREATE TABLE "ReportView" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "reportName" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "configuration" JSONB NOT NULL,
  "shared" BOOLEAN NOT NULL DEFAULT false,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ReportView_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportView_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ReportView_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ReportView_organizationId_userId_reportName_name_key"
  ON "ReportView" ("organizationId", "userId", "reportName", "name");
CREATE INDEX "ReportView_organizationId_reportName_shared_idx"
  ON "ReportView" ("organizationId", "reportName", "shared");
CREATE INDEX "ReportView_organizationId_userId_reportName_idx"
  ON "ReportView" ("organizationId", "userId", "reportName");

GRANT SELECT, INSERT, UPDATE, DELETE ON "ReportView" TO clearledger_runtime;

ALTER TABLE "ReportView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportView" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ReportView_tenant_policy" ON "ReportView"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
