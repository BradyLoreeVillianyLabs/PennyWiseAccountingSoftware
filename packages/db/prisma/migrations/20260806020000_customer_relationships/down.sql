DROP TRIGGER IF EXISTS "CustomerActivity_append_only" ON "CustomerActivity";
DROP TRIGGER IF EXISTS "CustomerActivity_tenant_reference_trigger" ON "CustomerActivity";
DROP FUNCTION IF EXISTS reject_customer_activity_mutation();
DROP FUNCTION IF EXISTS validate_customer_relationship_tenant_references();

DROP INDEX IF EXISTS "ProjectWorkItem_organizationId_customerId_status_idx";
DROP INDEX IF EXISTS "ProjectWorkItem_organizationId_contactId_status_idx";
DO $$
BEGIN
  IF to_regclass('public."ProjectWorkItem"') IS NOT NULL THEN
    ALTER TABLE "ProjectWorkItem"
      DROP CONSTRAINT IF EXISTS "ProjectWorkItem_organizationId_customerId_fkey",
      DROP CONSTRAINT IF EXISTS "ProjectWorkItem_organizationId_contactId_fkey",
      DROP CONSTRAINT IF EXISTS "ProjectWorkItem_time_check",
      DROP CONSTRAINT IF EXISTS "ProjectWorkItem_customStatus_check",
      DROP CONSTRAINT IF EXISTS "ProjectWorkItem_relatedResourceType_check",
      DROP CONSTRAINT IF EXISTS "ProjectWorkItem_location_check",
      DROP CONSTRAINT IF EXISTS "ProjectWorkItem_label_check",
      DROP CONSTRAINT IF EXISTS "ProjectWorkItem_category_check",
      DROP CONSTRAINT IF EXISTS "ProjectWorkItem_eventType_check",
      DROP COLUMN IF EXISTS "relatedResourceId",
      DROP COLUMN IF EXISTS "relatedResourceType",
      DROP COLUMN IF EXISTS "endAt",
      DROP COLUMN IF EXISTS "startAt",
      DROP COLUMN IF EXISTS "location",
      DROP COLUMN IF EXISTS "label",
      DROP COLUMN IF EXISTS "category",
      DROP COLUMN IF EXISTS "eventType",
      DROP COLUMN IF EXISTS "customStatus",
      DROP COLUMN IF EXISTS "contactId",
      DROP COLUMN IF EXISTS "customerId";
  END IF;
END $$;

DROP TABLE IF EXISTS "CustomerActivity";
DROP TABLE IF EXISTS "CustomerContact";

-- PostgreSQL does not support removing individual enum values safely. The added
-- work-item values remain harmless until a future enum rebuild migration.
