-- Evaluate the stable membership check once per statement rather than once per scanned row.
-- The policy still requires both the transaction-local organization context and active membership.
ALTER POLICY "Account_tenant_policy" ON "Account"
  USING (
    "organizationId" = app_current_organization_id()
    AND (SELECT app_actor_has_tenant_access())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (SELECT app_actor_has_tenant_access())
  );

ALTER POLICY "Journal_tenant_policy" ON "Journal"
  USING (
    "organizationId" = app_current_organization_id()
    AND (SELECT app_actor_has_tenant_access())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (SELECT app_actor_has_tenant_access())
  );

ALTER POLICY "JournalLine_tenant_policy" ON "JournalLine"
  USING (
    "organizationId" = app_current_organization_id()
    AND (SELECT app_actor_has_tenant_access())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (SELECT app_actor_has_tenant_access())
  );
