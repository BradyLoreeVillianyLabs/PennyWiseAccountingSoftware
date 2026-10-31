CREATE TYPE "CommerceInboxStatus" AS ENUM ('RECEIVED', 'REVIEW_REQUIRED', 'NORMALIZED', 'DEAD_LETTER');

CREATE TABLE "CommerceInboxEvent" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "providerKey" VARCHAR(80) NOT NULL,
  "shopExternalId" VARCHAR(200) NOT NULL,
  "externalEventId" VARCHAR(200) NOT NULL,
  "resourceType" VARCHAR(80) NOT NULL,
  "resourceId" VARCHAR(200) NOT NULL,
  "eventType" VARCHAR(120) NOT NULL,
  "eventVersion" VARCHAR(80),
  "occurredAt" TIMESTAMPTZ(6),
  "sourceCurrency" CHAR(3),
  "paymentCurrency" CHAR(3),
  "settlementCurrency" CHAR(3),
  "rawPayload" JSONB NOT NULL,
  "normalizedPayload" JSONB,
  "mappingVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "CommerceInboxStatus" NOT NULL DEFAULT 'RECEIVED',
  "errorCode" VARCHAR(80),
  "reviewNote" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommerceInboxEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceInboxEvent_currency_format_check" CHECK (
    ("sourceCurrency" IS NULL OR "sourceCurrency" ~ '^[A-Z]{3}$') AND
    ("paymentCurrency" IS NULL OR "paymentCurrency" ~ '^[A-Z]{3}$') AND
    ("settlementCurrency" IS NULL OR "settlementCurrency" ~ '^[A-Z]{3}$')
  ),
  CONSTRAINT "CommerceInboxEvent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommerceInboxEvent_installation_fkey"
    FOREIGN KEY ("organizationId", "installationId")
    REFERENCES "ConnectorInstallation"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CommerceInboxEvent_org_installation_external_key"
  ON "CommerceInboxEvent" ("organizationId", "installationId", "externalEventId");
CREATE INDEX "CommerceInboxEvent_org_status_created_idx"
  ON "CommerceInboxEvent" ("organizationId", "status", "createdAt");
CREATE INDEX "CommerceInboxEvent_org_resource_idx"
  ON "CommerceInboxEvent" ("organizationId", "providerKey", "shopExternalId", "resourceType", "resourceId");

GRANT SELECT, INSERT, UPDATE ON "CommerceInboxEvent" TO clearledger_runtime;
ALTER TABLE "CommerceInboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CommerceInboxEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CommerceInboxEvent_tenant_policy" ON "CommerceInboxEvent"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
