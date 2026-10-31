CREATE TYPE "ConnectorInstallationStatus" AS ENUM ('DRAFT', 'READY', 'PAUSED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "ConnectorHealthStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'FAILED');
CREATE TYPE "ConnectorConflictStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "ConnectorInstallation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "providerKey" VARCHAR(80) NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" "ConnectorInstallationStatus" NOT NULL DEFAULT 'DRAFT',
  "healthStatus" "ConnectorHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  "credentialCiphertext" TEXT,
  "credentialVersion" INTEGER NOT NULL DEFAULT 0,
  "mapping" JSONB NOT NULL,
  "backfillStartAt" TIMESTAMPTZ(6),
  "backfillEndAt" TIMESTAMPTZ(6),
  "consentedAt" TIMESTAMPTZ(6),
  "consentedByUserId" UUID,
  "lastHealthAt" TIMESTAMPTZ(6),
  "lastErrorRedacted" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ConnectorInstallation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorInstallation_organizationId_providerKey_key" UNIQUE ("organizationId", "providerKey"),
  CONSTRAINT "ConnectorInstallation_organizationId_id_key" UNIQUE ("organizationId", "id"),
  CONSTRAINT "ConnectorInstallation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ConnectorInstallation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE INDEX "ConnectorInstallation_organizationId_status_createdAt_idx" ON "ConnectorInstallation" ("organizationId", "status", "createdAt");

CREATE TABLE "ConnectorCheckpoint" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "scope" VARCHAR(80) NOT NULL,
  "checkpoint" JSONB NOT NULL,
  "lastSuccessAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ConnectorCheckpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorCheckpoint_installationId_scope_key" UNIQUE ("installationId", "scope"),
  CONSTRAINT "ConnectorCheckpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ConnectorCheckpoint_installation_fkey" FOREIGN KEY ("organizationId", "installationId") REFERENCES "ConnectorInstallation"("organizationId", "id") ON DELETE CASCADE
);
CREATE INDEX "ConnectorCheckpoint_organizationId_installationId_idx" ON "ConnectorCheckpoint" ("organizationId", "installationId");

CREATE TABLE "ConnectorConflict" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "externalRef" VARCHAR(200) NOT NULL,
  "kind" VARCHAR(80) NOT NULL,
  "status" "ConnectorConflictStatus" NOT NULL DEFAULT 'OPEN',
  "detailRedacted" JSONB NOT NULL,
  "resolvedAt" TIMESTAMPTZ(6),
  "resolvedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorConflict_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorConflict_installationId_externalRef_kind_key" UNIQUE ("installationId", "externalRef", "kind"),
  CONSTRAINT "ConnectorConflict_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ConnectorConflict_installation_fkey" FOREIGN KEY ("organizationId", "installationId") REFERENCES "ConnectorInstallation"("organizationId", "id") ON DELETE CASCADE,
  CONSTRAINT "ConnectorConflict_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX "ConnectorConflict_organizationId_installationId_status_createdAt_idx" ON "ConnectorConflict" ("organizationId", "installationId", "status", "createdAt");

CREATE TABLE "ConnectorLog" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "level" VARCHAR(16) NOT NULL,
  "eventType" VARCHAR(100) NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "redactedMetadata" JSONB,
  "requestId" VARCHAR(128),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ConnectorLog_installation_fkey" FOREIGN KEY ("organizationId", "installationId") REFERENCES "ConnectorInstallation"("organizationId", "id") ON DELETE CASCADE
);
CREATE INDEX "ConnectorLog_organizationId_installationId_createdAt_idx" ON "ConnectorLog" ("organizationId", "installationId", "createdAt");

GRANT SELECT, INSERT, UPDATE ON "ConnectorInstallation", "ConnectorCheckpoint", "ConnectorConflict", "ConnectorLog" TO clearledger_runtime;
ALTER TABLE "ConnectorInstallation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConnectorInstallation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ConnectorCheckpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConnectorCheckpoint" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ConnectorConflict" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConnectorConflict" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ConnectorLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConnectorLog" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ConnectorInstallation_tenant_policy" ON "ConnectorInstallation" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "ConnectorCheckpoint_tenant_policy" ON "ConnectorCheckpoint" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "ConnectorConflict_tenant_policy" ON "ConnectorConflict" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "ConnectorLog_tenant_policy" ON "ConnectorLog" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
