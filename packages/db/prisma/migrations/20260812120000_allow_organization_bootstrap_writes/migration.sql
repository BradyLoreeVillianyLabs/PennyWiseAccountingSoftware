-- Organization bootstrap is a privileged, short-lived runtime context. The
-- initial owner membership is the access locator, so the normal tenant
-- policies cannot authorize the settings/company/audit rows written before
-- the transaction returns. Keep the exception constrained to that context.

DROP POLICY IF EXISTS "Organization_tenant_select_policy" ON "Organization";
CREATE POLICY "Organization_tenant_select_policy" ON "Organization"
  FOR SELECT TO clearledger_runtime
  USING (
    "id" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

DROP POLICY IF EXISTS "OrganizationSettings_tenant_policy" ON "OrganizationSettings";
CREATE POLICY "OrganizationSettings_tenant_policy" ON "OrganizationSettings"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

DROP POLICY IF EXISTS "OrganizationCurrency_tenant_policy" ON "OrganizationCurrency";
CREATE POLICY "OrganizationCurrency_tenant_policy" ON "OrganizationCurrency"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

DROP POLICY IF EXISTS "FxPolicy_tenant_policy" ON "FxPolicy";
CREATE POLICY "FxPolicy_tenant_policy" ON "FxPolicy"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

DROP POLICY IF EXISTS "Company_tenant_policy" ON "Company";
CREATE POLICY "Company_tenant_policy" ON "Company"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

DROP POLICY IF EXISTS "CompanyMembership_tenant_policy" ON "CompanyMembership";
CREATE POLICY "CompanyMembership_tenant_policy" ON "CompanyMembership"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

DROP POLICY IF EXISTS "WorkflowPreferences_tenant_policy" ON "WorkflowPreferences";
CREATE POLICY "WorkflowPreferences_tenant_policy" ON "WorkflowPreferences"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

DROP POLICY IF EXISTS "BusinessDefaults_tenant_policy" ON "BusinessDefaults";
CREATE POLICY "BusinessDefaults_tenant_policy" ON "BusinessDefaults"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

DROP POLICY IF EXISTS "SetupStepState_tenant_policy" ON "SetupStepState";
CREATE POLICY "SetupStepState_tenant_policy" ON "SetupStepState"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

DROP POLICY IF EXISTS "AuditEvent_tenant_policy" ON "AuditEvent";
CREATE POLICY "AuditEvent_tenant_policy" ON "AuditEvent"
  FOR ALL TO clearledger_runtime
  USING (
    (
      "organizationId" = app_current_organization_id()
      AND (
        app_actor_has_tenant_access()
        OR (
          current_setting('app.access_mode', true) = 'organization_bootstrap'
          AND ("actorUserId" IS NULL OR "actorUserId" = app_current_actor_user_id())
        )
        OR (
          current_setting('app.access_mode', true) = 'invitation_acceptance'
          AND app_invitation_matches_context()
        )
      )
    )
    OR (current_setting('app.access_mode', true) = 'public_invoice' AND "organizationId" = app_current_organization_id())
  )
  WITH CHECK (
    (
      "organizationId" = app_current_organization_id()
      AND (
        app_actor_has_tenant_access()
        OR (
          current_setting('app.access_mode', true) = 'organization_bootstrap'
          AND ("actorUserId" IS NULL OR "actorUserId" = app_current_actor_user_id())
        )
        OR (
          current_setting('app.access_mode', true) = 'invitation_acceptance'
          AND app_invitation_matches_context()
        )
      )
    )
    OR (current_setting('app.access_mode', true) = 'public_invoice' AND "organizationId" = app_current_organization_id() AND "actorUserId" IS NULL)
  );
