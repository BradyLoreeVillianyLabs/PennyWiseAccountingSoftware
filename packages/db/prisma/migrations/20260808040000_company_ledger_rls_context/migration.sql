CREATE OR REPLACE FUNCTION app_current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.company_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION app_current_company_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_company_id() TO clearledger_runtime;

DROP POLICY IF EXISTS "Account_tenant_policy" ON "Account";
CREATE POLICY "Account_tenant_policy" ON "Account"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  );

DROP POLICY IF EXISTS "FiscalPeriod_tenant_policy" ON "FiscalPeriod";
CREATE POLICY "FiscalPeriod_tenant_policy" ON "FiscalPeriod"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  );

DROP POLICY IF EXISTS "Journal_tenant_policy" ON "Journal";
CREATE POLICY "Journal_tenant_policy" ON "Journal"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  );

DROP POLICY IF EXISTS "JournalLine_tenant_policy" ON "JournalLine";
CREATE POLICY "JournalLine_tenant_policy" ON "JournalLine"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  );
