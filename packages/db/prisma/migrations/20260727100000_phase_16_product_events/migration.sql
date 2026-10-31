CREATE TABLE "ProductEvent" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "clientEventId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventVersion" INTEGER NOT NULL DEFAULT 1,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductEvent_organizationId_clientEventId_key"
  ON "ProductEvent"("organizationId", "clientEventId");
CREATE INDEX "ProductEvent_organizationId_eventType_occurredAt_idx"
  ON "ProductEvent"("organizationId", "eventType", "occurredAt");

ALTER TABLE "ProductEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ProductEvent_tenant_policy" ON "ProductEvent"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
