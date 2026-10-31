CREATE TYPE "MigrationRunStatus" AS ENUM ('DRAFT', 'VALIDATED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "CommercialStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELLED', 'ENDED');
CREATE TYPE "CommercialEventStatus" AS ENUM ('RECEIVED', 'APPLIED', 'IGNORED', 'FAILED');

CREATE TABLE "MigrationRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "status" "MigrationRunStatus" NOT NULL DEFAULT 'DRAFT',
  "manifest" JSONB NOT NULL,
  "errorMessage" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "startedAt" TIMESTAMPTZ(6),
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MigrationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MigrationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "MigrationRun_organizationId_id_key" UNIQUE ("organizationId", "id")
);
CREATE INDEX "MigrationRun_organizationId_status_createdAt_idx" ON "MigrationRun" ("organizationId", "status", "createdAt");

CREATE TABLE "MigrationRunEntry" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "migrationRunId" UUID NOT NULL,
  "entity" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "supported" BOOLEAN NOT NULL,
  "unsupportedReason" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MigrationRunEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MigrationRunEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "MigrationRunEntry_migrationRunId_organizationId_fkey" FOREIGN KEY ("migrationRunId", "organizationId") REFERENCES "MigrationRun"("id", "organizationId") ON DELETE CASCADE,
  CONSTRAINT "MigrationRunEntry_migrationRunId_entity_key" UNIQUE ("migrationRunId", "entity"),
  CONSTRAINT "MigrationRunEntry_rowCount_check" CHECK ("rowCount" >= 0)
);
CREATE INDEX "MigrationRunEntry_organizationId_migrationRunId_idx" ON "MigrationRunEntry" ("organizationId", "migrationRunId");

CREATE TABLE "CommercialSubscription" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "planCode" TEXT NOT NULL,
  "entitlements" JSONB NOT NULL,
  "status" "CommercialStatus" NOT NULL DEFAULT 'TRIALING',
  "provider" TEXT,
  "providerCustomerId" TEXT,
  "providerSubscriptionId" TEXT,
  "currentPeriodEnd" TIMESTAMPTZ(6),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CommercialSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialSubscription_organizationId_key" UNIQUE ("organizationId"),
  CONSTRAINT "CommercialSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);
CREATE INDEX "CommercialSubscription_status_currentPeriodEnd_idx" ON "CommercialSubscription" ("status", "currentPeriodEnd");

CREATE TABLE "CommercialEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" "CommercialEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "payload" JSONB NOT NULL,
  "errorMessage" TEXT,
  "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(6),
  CONSTRAINT "CommercialEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommercialEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "CommercialEvent_organizationId_provider_providerEventId_key" UNIQUE ("organizationId", "provider", "providerEventId")
);
CREATE INDEX "CommercialEvent_organizationId_status_receivedAt_idx" ON "CommercialEvent" ("organizationId", "status", "receivedAt");

GRANT SELECT, INSERT, UPDATE ON "MigrationRun", "MigrationRunEntry", "CommercialSubscription", "CommercialEvent" TO clearledger_runtime;
ALTER TABLE "MigrationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MigrationRun" FORCE ROW LEVEL SECURITY;
ALTER TABLE "MigrationRunEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MigrationRunEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommercialSubscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommercialSubscription" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CommercialEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommercialEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY "MigrationRun_tenant_policy" ON "MigrationRun" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "MigrationRunEntry_tenant_policy" ON "MigrationRunEntry" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "CommercialSubscription_tenant_policy" ON "CommercialSubscription" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "CommercialEvent_tenant_policy" ON "CommercialEvent" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
