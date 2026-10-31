DROP POLICY IF EXISTS "ProductEvent_tenant_policy" ON "ProductEvent";
DROP INDEX IF EXISTS "ProductEvent_organizationId_eventType_occurredAt_idx";
DROP INDEX IF EXISTS "ProductEvent_organizationId_clientEventId_key";
DROP TABLE IF EXISTS "ProductEvent";
