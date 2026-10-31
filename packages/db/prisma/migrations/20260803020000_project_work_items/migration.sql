CREATE TYPE "ProjectWorkItemKind" AS ENUM ('TASK', 'MILESTONE', 'REMINDER');
CREATE TYPE "ProjectWorkItemStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ProjectWorkItemPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

CREATE UNIQUE INDEX "Membership_organizationId_id_key"
  ON "Membership"("organizationId", "id");

CREATE TABLE "ProjectWorkItem" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "kind" "ProjectWorkItemKind" NOT NULL,
  "status" "ProjectWorkItemStatus" NOT NULL DEFAULT 'TODO',
  "priority" "ProjectWorkItemPriority" NOT NULL DEFAULT 'NORMAL',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "projectId" UUID,
  "assigneeMembershipId" UUID,
  "startDate" DATE,
  "dueDate" DATE,
  "version" INTEGER NOT NULL DEFAULT 1,
  "completedAt" TIMESTAMPTZ(6),
  "archivedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectWorkItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProjectWorkItem_title_check"
    CHECK (btrim("title") <> '' AND char_length("title") <= 200),
  CONSTRAINT "ProjectWorkItem_description_check"
    CHECK ("description" IS NULL OR char_length("description") <= 10000),
  CONSTRAINT "ProjectWorkItem_version_check" CHECK ("version" > 0),
  CONSTRAINT "ProjectWorkItem_dates_check"
    CHECK ("startDate" IS NULL OR "dueDate" IS NULL OR "dueDate" >= "startDate"),
  CONSTRAINT "ProjectWorkItem_milestone_date_check"
    CHECK (
      "kind" <> 'MILESTONE'
      OR ("dueDate" IS NOT NULL AND ("startDate" IS NULL OR "startDate" = "dueDate"))
    ),
  CONSTRAINT "ProjectWorkItem_completed_check"
    CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL)),
  CONSTRAINT "ProjectWorkItem_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectWorkItem_organizationId_projectId_fkey"
    FOREIGN KEY ("organizationId", "projectId") REFERENCES "Project"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectWorkItem_organizationId_assigneeMembershipId_fkey"
    FOREIGN KEY ("organizationId", "assigneeMembershipId") REFERENCES "Membership"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProjectWorkItem_organizationId_id_key"
  ON "ProjectWorkItem"("organizationId", "id");
CREATE INDEX "ProjectWorkItem_organizationId_status_dueDate_idx"
  ON "ProjectWorkItem"("organizationId", "status", "dueDate");
CREATE INDEX "ProjectWorkItem_organizationId_projectId_status_idx"
  ON "ProjectWorkItem"("organizationId", "projectId", "status");
CREATE INDEX "ProjectWorkItem_organizationId_assigneeMembershipId_status_idx"
  ON "ProjectWorkItem"("organizationId", "assigneeMembershipId", "status");
CREATE INDEX "ProjectWorkItem_organizationId_startDate_idx"
  ON "ProjectWorkItem"("organizationId", "startDate");

CREATE TABLE "ProjectWorkItemDependency" (
  "organizationId" UUID NOT NULL,
  "workItemId" UUID NOT NULL,
  "dependsOnItemId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectWorkItemDependency_pkey"
    PRIMARY KEY ("organizationId", "workItemId", "dependsOnItemId"),
  CONSTRAINT "ProjectWorkItemDependency_no_self_check"
    CHECK ("workItemId" <> "dependsOnItemId"),
  CONSTRAINT "ProjectWorkItemDependency_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectWorkItemDependency_organizationId_workItemId_fkey"
    FOREIGN KEY ("organizationId", "workItemId") REFERENCES "ProjectWorkItem"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectWorkItemDependency_organizationId_dependsOnItemId_fkey"
    FOREIGN KEY ("organizationId", "dependsOnItemId") REFERENCES "ProjectWorkItem"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ProjectWorkItemDependency_organizationId_dependsOnItemId_workItemId_idx"
  ON "ProjectWorkItemDependency"("organizationId", "dependsOnItemId", "workItemId");

CREATE OR REPLACE FUNCTION validate_project_work_item_tenant_references()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'ProjectWorkItem' THEN
    IF NEW."projectId" IS NOT NULL
      AND (
        TG_OP = 'INSERT'
        OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
        OR NEW."projectId" IS DISTINCT FROM OLD."projectId"
      )
      AND NOT EXISTS (
      SELECT 1 FROM "Project"
      WHERE "organizationId" = NEW."organizationId"
        AND "id" = NEW."projectId"
        AND "status" <> 'ARCHIVED'
    ) THEN
      RAISE EXCEPTION 'Project work item requires a non-archived tenant project';
    END IF;
    IF NEW."assigneeMembershipId" IS NOT NULL
      AND (
        TG_OP = 'INSERT'
        OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
        OR NEW."assigneeMembershipId" IS DISTINCT FROM OLD."assigneeMembershipId"
      )
      AND NOT EXISTS (
      SELECT 1 FROM "Membership"
      WHERE "organizationId" = NEW."organizationId"
        AND "id" = NEW."assigneeMembershipId"
        AND "status" = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Project work item requires an active tenant membership';
    END IF;
  ELSIF TG_TABLE_NAME = 'ProjectWorkItemDependency' THEN
    IF NOT EXISTS (
      SELECT 1 FROM "ProjectWorkItem"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."workItemId"
    ) OR NOT EXISTS (
      SELECT 1 FROM "ProjectWorkItem"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."dependsOnItemId"
    ) THEN
      RAISE EXCEPTION 'Project work item dependency tenant mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProjectWorkItem_tenant_reference_trigger"
BEFORE INSERT OR UPDATE ON "ProjectWorkItem"
FOR EACH ROW EXECUTE FUNCTION validate_project_work_item_tenant_references();

CREATE TRIGGER "ProjectWorkItemDependency_tenant_reference_trigger"
BEFORE INSERT OR UPDATE ON "ProjectWorkItemDependency"
FOR EACH ROW EXECUTE FUNCTION validate_project_work_item_tenant_references();

ALTER TABLE "ProjectWorkItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ProjectWorkItem_tenant_policy" ON "ProjectWorkItem"
FOR ALL TO clearledger_runtime
USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "ProjectWorkItemDependency" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ProjectWorkItemDependency_tenant_policy" ON "ProjectWorkItemDependency"
FOR ALL TO clearledger_runtime
USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "ProjectWorkItem",
  "ProjectWorkItemDependency"
TO clearledger_runtime;
