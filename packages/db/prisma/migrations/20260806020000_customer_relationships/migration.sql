ALTER TYPE "ProjectWorkItemKind" ADD VALUE IF NOT EXISTS 'MEETING';
ALTER TYPE "ProjectWorkItemKind" ADD VALUE IF NOT EXISTS 'APPOINTMENT';
ALTER TYPE "ProjectWorkItemKind" ADD VALUE IF NOT EXISTS 'FOLLOW_UP';

CREATE TABLE "CustomerContact" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT,
  "email" TEXT,
  "telephone" TEXT,
  "preferredChannel" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMPTZ(6),
  "archivedByUserId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerContact_name_check" CHECK (btrim("name") <> '' AND char_length("name") <= 200),
  CONSTRAINT "CustomerContact_role_check" CHECK ("role" IS NULL OR char_length("role") <= 120),
  CONSTRAINT "CustomerContact_email_check" CHECK ("email" IS NULL OR char_length("email") <= 320),
  CONSTRAINT "CustomerContact_telephone_check" CHECK ("telephone" IS NULL OR char_length("telephone") <= 40),
  CONSTRAINT "CustomerContact_preferredChannel_check" CHECK ("preferredChannel" IS NULL OR char_length("preferredChannel") <= 80),
  CONSTRAINT "CustomerContact_notes_check" CHECK ("notes" IS NULL OR char_length("notes") <= 4000),
  CONSTRAINT "CustomerContact_version_check" CHECK ("version" > 0),
  CONSTRAINT "CustomerContact_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerContact_organizationId_customerId_fkey"
    FOREIGN KEY ("organizationId", "customerId") REFERENCES "Customer"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomerContact_organizationId_id_key"
  ON "CustomerContact"("organizationId", "id");
CREATE INDEX "CustomerContact_organizationId_customerId_active_name_idx"
  ON "CustomerContact"("organizationId", "customerId", "active", "name");

CREATE TABLE "CustomerActivity" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "contactId" UUID,
  "activityType" TEXT NOT NULL,
  "category" TEXT,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "happenedAt" TIMESTAMPTZ(6) NOT NULL,
  "relatedResourceType" TEXT,
  "relatedResourceId" UUID,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerActivity_activityType_check" CHECK (btrim("activityType") <> '' AND char_length("activityType") <= 80),
  CONSTRAINT "CustomerActivity_category_check" CHECK ("category" IS NULL OR char_length("category") <= 80),
  CONSTRAINT "CustomerActivity_subject_check" CHECK ("subject" IS NULL OR char_length("subject") <= 240),
  CONSTRAINT "CustomerActivity_body_check" CHECK (btrim("body") <> '' AND char_length("body") <= 10000),
  CONSTRAINT "CustomerActivity_relatedResourceType_check" CHECK ("relatedResourceType" IS NULL OR char_length("relatedResourceType") <= 80),
  CONSTRAINT "CustomerActivity_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerActivity_organizationId_customerId_fkey"
    FOREIGN KEY ("organizationId", "customerId") REFERENCES "Customer"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CustomerActivity_organizationId_contactId_fkey"
    FOREIGN KEY ("organizationId", "contactId") REFERENCES "CustomerContact"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomerActivity_organizationId_id_key"
  ON "CustomerActivity"("organizationId", "id");
CREATE INDEX "CustomerActivity_organizationId_customerId_happenedAt_idx"
  ON "CustomerActivity"("organizationId", "customerId", "happenedAt");
CREATE INDEX "CustomerActivity_organizationId_contactId_happenedAt_idx"
  ON "CustomerActivity"("organizationId", "contactId", "happenedAt");

ALTER TABLE "ProjectWorkItem"
  ADD COLUMN "customerId" UUID,
  ADD COLUMN "contactId" UUID,
  ADD COLUMN "eventType" TEXT NOT NULL DEFAULT 'TASK',
  ADD COLUMN "customStatus" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "label" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "startAt" TIMESTAMPTZ(6),
  ADD COLUMN "endAt" TIMESTAMPTZ(6),
  ADD COLUMN "relatedResourceType" TEXT,
  ADD COLUMN "relatedResourceId" UUID;

ALTER TABLE "ProjectWorkItem"
  ADD CONSTRAINT "ProjectWorkItem_eventType_check"
    CHECK (btrim("eventType") <> '' AND char_length("eventType") <= 80),
  ADD CONSTRAINT "ProjectWorkItem_customStatus_check"
    CHECK ("customStatus" IS NULL OR char_length("customStatus") <= 80),
  ADD CONSTRAINT "ProjectWorkItem_category_check"
    CHECK ("category" IS NULL OR char_length("category") <= 80),
  ADD CONSTRAINT "ProjectWorkItem_label_check"
    CHECK ("label" IS NULL OR char_length("label") <= 80),
  ADD CONSTRAINT "ProjectWorkItem_location_check"
    CHECK ("location" IS NULL OR char_length("location") <= 500),
  ADD CONSTRAINT "ProjectWorkItem_relatedResourceType_check"
    CHECK ("relatedResourceType" IS NULL OR char_length("relatedResourceType") <= 80),
  ADD CONSTRAINT "ProjectWorkItem_time_check"
    CHECK ("startAt" IS NULL OR "endAt" IS NULL OR "endAt" >= "startAt"),
  ADD CONSTRAINT "ProjectWorkItem_organizationId_customerId_fkey"
    FOREIGN KEY ("organizationId", "customerId") REFERENCES "Customer"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProjectWorkItem_organizationId_contactId_fkey"
    FOREIGN KEY ("organizationId", "contactId") REFERENCES "CustomerContact"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ProjectWorkItem_organizationId_customerId_status_idx"
  ON "ProjectWorkItem"("organizationId", "customerId", "status");
CREATE INDEX "ProjectWorkItem_organizationId_contactId_status_idx"
  ON "ProjectWorkItem"("organizationId", "contactId", "status");

CREATE OR REPLACE FUNCTION validate_project_work_item_tenant_references()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'ProjectWorkItem' THEN
    IF NEW."projectId" IS NOT NULL
      AND (TG_OP = 'INSERT' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."projectId" IS DISTINCT FROM OLD."projectId")
      AND NOT EXISTS (
        SELECT 1 FROM "Project"
        WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."projectId" AND "status" <> 'ARCHIVED'
      ) THEN
      RAISE EXCEPTION 'Project work item requires a non-archived tenant project';
    END IF;
    IF NEW."assigneeMembershipId" IS NOT NULL
      AND (TG_OP = 'INSERT' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."assigneeMembershipId" IS DISTINCT FROM OLD."assigneeMembershipId")
      AND NOT EXISTS (
        SELECT 1 FROM "Membership"
        WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."assigneeMembershipId" AND "status" = 'ACTIVE'
      ) THEN
      RAISE EXCEPTION 'Project work item requires an active tenant membership';
    END IF;
    IF NEW."customerId" IS NOT NULL
      AND (TG_OP = 'INSERT' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."customerId" IS DISTINCT FROM OLD."customerId")
      AND NOT EXISTS (
        SELECT 1 FROM "Customer"
        WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."customerId" AND "active" = true
      ) THEN
      RAISE EXCEPTION 'Project work item requires an active tenant customer';
    END IF;
    IF NEW."contactId" IS NOT NULL
      AND (TG_OP = 'INSERT' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."contactId" IS DISTINCT FROM OLD."contactId" OR NEW."customerId" IS DISTINCT FROM OLD."customerId")
      AND NOT EXISTS (
        SELECT 1 FROM "CustomerContact"
        WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."contactId" AND "customerId" = NEW."customerId" AND "active" = true
      ) THEN
      RAISE EXCEPTION 'Project work item contact must belong to its active customer';
    END IF;
    IF NEW."projectId" IS NOT NULL AND NEW."customerId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "Project"
        WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."projectId" AND "customerId" = NEW."customerId"
      ) THEN
      RAISE EXCEPTION 'Project work item project and customer must agree';
    END IF;
  ELSIF TG_TABLE_NAME = 'ProjectWorkItemDependency' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "ProjectWorkItem" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workItemId"
    ) OR NOT EXISTS (
      SELECT 1 FROM "ProjectWorkItem" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."dependsOnItemId"
    ) THEN
      RAISE EXCEPTION 'Project work item dependency tenant mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_customer_relationship_tenant_references()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'CustomerActivity' AND NEW."contactId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM "CustomerContact"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."contactId" AND "customerId" = NEW."customerId" AND "active" = true
    ) THEN
    RAISE EXCEPTION 'Customer activity contact must belong to its active customer';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CustomerActivity_tenant_reference_trigger"
BEFORE INSERT OR UPDATE ON "CustomerActivity"
FOR EACH ROW EXECUTE FUNCTION validate_customer_relationship_tenant_references();

CREATE OR REPLACE FUNCTION reject_customer_activity_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Customer activity history is append-only';
END;
$$;

CREATE TRIGGER "CustomerActivity_append_only"
BEFORE UPDATE OR DELETE ON "CustomerActivity"
FOR EACH ROW EXECUTE FUNCTION reject_customer_activity_mutation();

ALTER TABLE "CustomerContact" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CustomerContact_tenant_policy" ON "CustomerContact"
FOR ALL TO clearledger_runtime
USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "CustomerActivity" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CustomerActivity_tenant_policy" ON "CustomerActivity"
FOR ALL TO clearledger_runtime
USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CustomerContact" TO clearledger_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CustomerActivity" TO clearledger_runtime;
