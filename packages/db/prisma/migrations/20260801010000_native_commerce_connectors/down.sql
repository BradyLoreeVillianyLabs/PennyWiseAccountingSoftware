DO $rollback$
BEGIN
  IF to_regclass('public."CommerceInboxEvent"') IS NULL
     OR to_regclass('public."ConnectorInstallation"') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "ConnectorInstallation_webhook_lookup" ON "ConnectorInstallation";
  DROP POLICY IF EXISTS "ConnectorInstallation_commerce_webhook_policy" ON "ConnectorInstallation";
  DROP POLICY IF EXISTS "ConnectorCheckpoint_commerce_webhook_policy" ON "ConnectorCheckpoint";
  DROP POLICY IF EXISTS "ConnectorConflict_commerce_webhook_policy" ON "ConnectorConflict";
  DROP POLICY IF EXISTS "ConnectorLog_commerce_webhook_policy" ON "ConnectorLog";
  DROP POLICY IF EXISTS "CommerceInboxEvent_commerce_webhook_policy" ON "CommerceInboxEvent";
  DROP POLICY IF EXISTS "AuditEvent_commerce_webhook_policy" ON "AuditEvent";

  DROP INDEX IF EXISTS "CommerceInboxEvent_org_installation_occurred_id_idx";
  ALTER TABLE "CommerceInboxEvent"
    DROP CONSTRAINT IF EXISTS "CommerceInboxEvent_normalization_issues_array_check",
    DROP CONSTRAINT IF EXISTS "CommerceInboxEvent_normalized_schema_version_check",
    DROP CONSTRAINT IF EXISTS "CommerceInboxEvent_raw_payload_hash_check",
    DROP COLUMN IF EXISTS "normalizationIssues",
    DROP COLUMN IF EXISTS "normalizedSchemaVersion",
    DROP COLUMN IF EXISTS "rawPayloadHash";

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
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
      RAISE EXCEPTION 'Commerce inbox raw evidence is immutable';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  DROP INDEX IF EXISTS "ConnectorInstallation_expired_sync_lease_idx";
  DROP INDEX IF EXISTS "ConnectorInstallation_org_provider_status_created_idx";
  DROP INDEX IF EXISTS "ConnectorInstallation_webhookLookupHash_key";
  DROP INDEX IF EXISTS "ConnectorInstallation_organizationId_providerKey_externalAccountId_key";

  IF EXISTS (
    SELECT 1
    FROM "ConnectorInstallation"
    GROUP BY "organizationId", "providerKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot restore one-provider-per-organization constraint while multiple stores exist';
  END IF;

  ALTER TABLE "ConnectorInstallation"
    DROP CONSTRAINT IF EXISTS "ConnectorInstallation_sync_lease_pair_check",
    DROP CONSTRAINT IF EXISTS "ConnectorInstallation_mapping_version_check",
    DROP CONSTRAINT IF EXISTS "ConnectorInstallation_webhook_status_check",
    DROP COLUMN IF EXISTS "syncLeaseExpiresAt",
    DROP COLUMN IF EXISTS "syncLeaseTokenHash",
    DROP COLUMN IF EXISTS "webhookStatus",
    DROP COLUMN IF EXISTS "lastWebhookAt",
    DROP COLUMN IF EXISTS "lastSyncAt",
    DROP COLUMN IF EXISTS "mappingVersion",
    DROP COLUMN IF EXISTS "webhookLookupHash",
    DROP COLUMN IF EXISTS "externalAccountId";
  ALTER TABLE "ConnectorInstallation"
    ADD CONSTRAINT "ConnectorInstallation_organizationId_providerKey_key"
    UNIQUE ("organizationId", "providerKey");
  CREATE INDEX "ConnectorInstallation_organizationId_status_createdAt_idx"
    ON "ConnectorInstallation" ("organizationId", "status", "createdAt");
END;
$rollback$;
