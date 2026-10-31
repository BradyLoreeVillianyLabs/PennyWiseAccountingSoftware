DO $rollback$
BEGIN
  IF to_regprocedure('public.app_current_organization_id()') IS NULL THEN
    RETURN;
  END IF;

  ALTER POLICY "Account_tenant_policy" ON "Account"
    USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
    WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

  ALTER POLICY "Journal_tenant_policy" ON "Journal"
    USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
    WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

  ALTER POLICY "JournalLine_tenant_policy" ON "JournalLine"
    USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
    WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
END;
$rollback$;
