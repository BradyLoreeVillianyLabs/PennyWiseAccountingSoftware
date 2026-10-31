DROP POLICY IF EXISTS "WebhookDelivery_tenant_policy" ON "WebhookDelivery";
DROP POLICY IF EXISTS "WebhookEndpoint_tenant_policy" ON "WebhookEndpoint";
DROP TABLE IF EXISTS "WebhookDelivery";
DROP TABLE IF EXISTS "WebhookEndpoint";
ALTER TABLE "OutboxEvent" DROP CONSTRAINT IF EXISTS "OutboxEvent_organizationId_id_key";
DROP TYPE IF EXISTS "WebhookDeliveryStatus";
DROP TYPE IF EXISTS "WebhookEndpointStatus";
