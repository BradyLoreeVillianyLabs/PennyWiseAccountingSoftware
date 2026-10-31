-- Restore the preceding bootstrap policy shape when rolling this migration back.
ALTER POLICY "Organization_tenant_select_policy" ON "Organization"
  USING (
    "id" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR current_setting('app.access_mode', true) = 'organization_bootstrap'
    )
  );

ALTER POLICY "OrganizationSettings_tenant_policy" ON "OrganizationSettings"
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

ALTER POLICY "OrganizationCurrency_tenant_policy" ON "OrganizationCurrency"
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

ALTER POLICY "FxPolicy_tenant_policy" ON "FxPolicy"
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

ALTER POLICY "Company_tenant_policy" ON "Company"
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

ALTER POLICY "CompanyMembership_tenant_policy" ON "CompanyMembership"
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

ALTER POLICY "WorkflowPreferences_tenant_policy" ON "WorkflowPreferences"
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

ALTER POLICY "BusinessDefaults_tenant_policy" ON "BusinessDefaults"
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

ALTER POLICY "SetupStepState_tenant_policy" ON "SetupStepState"
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

ALTER POLICY "AuditEvent_tenant_policy" ON "AuditEvent"
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
    OR (
      current_setting('app.access_mode', true) = 'public_invoice'
      AND "organizationId" = app_current_organization_id()
    )
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
    OR (
      current_setting('app.access_mode', true) = 'public_invoice'
      AND "organizationId" = app_current_organization_id()
      AND "actorUserId" IS NULL
    )
  );
