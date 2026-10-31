-- Native commerce connectors remain read-only shadow integrations. This
-- migration adds multi-store identity, short-lived synchronization leases,
-- immutable payload fingerprints, and narrowly scoped webhook RLS access.

ALTER TABLE "ConnectorInstallation"
  ADD COLUMN "externalAccountId" VARCHAR(200),
  ADD COLUMN "webhookLookupHash" CHAR(64),
  ADD COLUMN "mappingVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "lastSyncAt" TIMESTAMPTZ(6),
  ADD COLUMN "lastWebhookAt" TIMESTAMPTZ(6),
  ADD COLUMN "webhookStatus" VARCHAR(32) NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "syncLeaseTokenHash" CHAR(64),
  ADD COLUMN "syncLeaseExpiresAt" TIMESTAMPTZ(6);

UPDATE "ConnectorInstallation"
SET "webhookLookupHash" = encode(
  digest("providerKey" || ':' || "id"::text, 'sha256'),
  'hex'
);

ALTER TABLE "ConnectorInstallation"
  ADD CONSTRAINT "ConnectorInstallation_webhook_status_check"
  CHECK ("webhookStatus" IN ('NOT_CONFIGURED', 'ACTIVE', 'DEGRADED', 'FAILED')),
  ADD CONSTRAINT "ConnectorInstallation_mapping_version_check"
  CHECK ("mappingVersion" > 0),
  ADD CONSTRAINT "ConnectorInstallation_sync_lease_pair_check"
  CHECK (
    ("syncLeaseTokenHash" IS NULL AND "syncLeaseExpiresAt" IS NULL)
    OR ("syncLeaseTokenHash" IS NOT NULL AND "syncLeaseExpiresAt" IS NOT NULL)
  );

ALTER TABLE "ConnectorInstallation"
  DROP CONSTRAINT "ConnectorInstallation_organizationId_providerKey_key";
DROP INDEX "ConnectorInstallation_organizationId_status_createdAt_idx";
CREATE UNIQUE INDEX "ConnectorInstallation_organizationId_providerKey_externalAccountId_key"
  ON "ConnectorInstallation" ("organizationId", "providerKey", "externalAccountId");
CREATE UNIQUE INDEX "ConnectorInstallation_webhookLookupHash_key"
  ON "ConnectorInstallation" ("webhookLookupHash");
CREATE INDEX "ConnectorInstallation_org_provider_status_created_idx"
  ON "ConnectorInstallation" ("organizationId", "providerKey", "status", "createdAt");
CREATE INDEX "ConnectorInstallation_expired_sync_lease_idx"
  ON "ConnectorInstallation" ("organizationId", "syncLeaseExpiresAt")
  WHERE "syncLeaseExpiresAt" IS NOT NULL;

ALTER TABLE "CommerceInboxEvent"
  ADD COLUMN "rawPayloadHash" CHAR(64),
  ADD COLUMN "normalizedSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "normalizationIssues" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "CommerceInboxEvent"
  ADD CONSTRAINT "CommerceInboxEvent_raw_payload_hash_check"
  CHECK ("rawPayloadHash" IS NULL OR "rawPayloadHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "CommerceInboxEvent_normalized_schema_version_check"
  CHECK ("normalizedSchemaVersion" > 0),
  ADD CONSTRAINT "CommerceInboxEvent_normalization_issues_array_check"
  CHECK (jsonb_typeof("normalizationIssues") = 'array');
CREATE INDEX "CommerceInboxEvent_org_installation_occurred_id_idx"
  ON "CommerceInboxEvent" ("organizationId", "installationId", "occurredAt", "id");

CREATE OR REPLACE FUNCTION prevent_commerce_inbox_raw_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."installationId" IS DISTINCT FROM OLD."installationId"
     OR NEW."providerKey" IS DISTINCT FROM OLD."providerKey"
     OR NEW."shopExternalId" IS DISTINCT FROM OLD."shopExternalId"
     OR NEW."externalEventId" IS DISTINCT FROM OLD."externalEventId"
     OR NEW."resourceType" IS DISTINCT FROM OLD."resourceType"
     OR NEW."resourceId" IS DISTINCT FROM OLD."resourceId"
     OR NEW."eventType" IS DISTINCT FROM OLD."eventType"
     OR NEW."eventVersion" IS DISTINCT FROM OLD."eventVersion"
     OR NEW."occurredAt" IS DISTINCT FROM OLD."occurredAt"
     OR NEW."sourceCurrency" IS DISTINCT FROM OLD."sourceCurrency"
     OR NEW."paymentCurrency" IS DISTINCT FROM OLD."paymentCurrency"
     OR NEW."settlementCurrency" IS DISTINCT FROM OLD."settlementCurrency"
     OR NEW."rawPayload" IS DISTINCT FROM OLD."rawPayload"
     OR NEW."rawPayloadHash" IS DISTINCT FROM OLD."rawPayloadHash"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Commerce inbox raw evidence is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE POLICY "ConnectorInstallation_webhook_lookup" ON "ConnectorInstallation"
  FOR SELECT TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'connector_webhook_lookup'
    AND "webhookLookupHash" = NULLIF(current_setting('app.connector_webhook_lookup_hash', true), '')
  );

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ConnectorInstallation', 'ConnectorCheckpoint', 'ConnectorConflict',
    'ConnectorLog', 'CommerceInboxEvent', 'AuditEvent'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING (current_setting(''app.access_mode'', true) = ''commerce_webhook'' AND "organizationId" = app_current_organization_id()) WITH CHECK (current_setting(''app.access_mode'', true) = ''commerce_webhook'' AND "organizationId" = app_current_organization_id())',
      table_name || '_commerce_webhook_policy',
      table_name
    );
  END LOOP;
END $$;
