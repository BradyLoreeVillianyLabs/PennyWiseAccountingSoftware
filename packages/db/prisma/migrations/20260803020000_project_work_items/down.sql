DROP TABLE IF EXISTS "ProjectWorkItemDependency";
DROP TABLE IF EXISTS "ProjectWorkItem";
DROP FUNCTION IF EXISTS validate_project_work_item_tenant_references();
DROP INDEX IF EXISTS "Membership_organizationId_id_key";
DROP TYPE IF EXISTS "ProjectWorkItemPriority";
DROP TYPE IF EXISTS "ProjectWorkItemStatus";
DROP TYPE IF EXISTS "ProjectWorkItemKind";
