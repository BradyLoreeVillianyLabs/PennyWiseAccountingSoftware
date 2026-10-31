CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'DELIVERED', 'FAILED', 'DEAD_LETTER');

ALTER TABLE "OutboxEvent"
  ADD CONSTRAINT "OutboxEvent_organizationId_id_key" UNIQUE ("organizationId", "id");

CREATE TABLE "WebhookEndpoint" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "url" VARCHAR(2048) NOT NULL,
  "keyPrefix" VARCHAR(32) NOT NULL,
  "secretCiphertext" TEXT NOT NULL,
  "creationKeyHash" CHAR(64) NOT NULL,
  "eventTypes" TEXT[] NOT NULL,
  "apiVersion" VARCHAR(32) NOT NULL DEFAULT '2026-07-01',
  "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
  "disabledAt" TIMESTAMPTZ(6),
  "disabledReason" TEXT,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastDeliveryAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookEndpoint_organizationId_creationKeyHash_key" UNIQUE ("organizationId", "creationKeyHash"),
  CONSTRAINT "WebhookEndpoint_organizationId_id_key" UNIQUE ("organizationId", "id"),
  CONSTRAINT "WebhookEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "WebhookEndpoint_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT
);

CREATE INDEX "WebhookEndpoint_organizationId_status_createdAt_idx"
  ON "WebhookEndpoint" ("organizationId", "status", "createdAt");

CREATE TABLE "WebhookDelivery" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "endpointId" UUID NOT NULL,
  "outboxEventId" UUID NOT NULL,
  "eventId" VARCHAR(128) NOT NULL,
  "eventType" VARCHAR(160) NOT NULL,
  "apiVersion" VARCHAR(32) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(6),
  "lastHttpStatus" INTEGER,
  "lastError" TEXT,
  "deliveredAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebhookDelivery_organizationId_endpointId_eventId_key" UNIQUE ("organizationId", "endpointId", "eventId"),
  CONSTRAINT "WebhookDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "WebhookDelivery_endpoint_fkey" FOREIGN KEY ("organizationId", "endpointId") REFERENCES "WebhookEndpoint"("organizationId", "id") ON DELETE CASCADE,
  CONSTRAINT "WebhookDelivery_outboxEvent_fkey" FOREIGN KEY ("organizationId", "outboxEventId") REFERENCES "OutboxEvent"("organizationId", "id") ON DELETE CASCADE
);

CREATE INDEX "WebhookDelivery_organizationId_endpointId_status_nextAttemptAt_createdAt_idx"
  ON "WebhookDelivery" ("organizationId", "endpointId", "status", "nextAttemptAt", "createdAt");
CREATE INDEX "WebhookDelivery_organizationId_outboxEventId_idx"
  ON "WebhookDelivery" ("organizationId", "outboxEventId");

GRANT SELECT, INSERT, UPDATE ON "WebhookEndpoint" TO clearledger_runtime;
GRANT SELECT, INSERT, UPDATE ON "WebhookDelivery" TO clearledger_runtime;

ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEndpoint" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookDelivery" FORCE ROW LEVEL SECURITY;

CREATE POLICY "WebhookEndpoint_tenant_policy" ON "WebhookEndpoint" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

CREATE POLICY "WebhookDelivery_tenant_policy" ON "WebhookDelivery" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
