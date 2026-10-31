-- A bootstrap context alone must never authorize access to an existing
-- tenant. The grant is created by the Organization INSERT trigger and is
-- bound to its actor and database transaction. Once the owner membership
-- exists, the ordinary membership locator authorizes the remaining setup.

ALTER POLICY "Organization_tenant_select_policy" ON "Organization"
  USING (
    "id" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("id", app_current_actor_user_id())
      )
    )
  );

ALTER POLICY "OrganizationSettings_tenant_policy" ON "OrganizationSettings"
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  );

ALTER POLICY "OrganizationCurrency_tenant_policy" ON "OrganizationCurrency"
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  );

ALTER POLICY "FxPolicy_tenant_policy" ON "FxPolicy"
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  );

ALTER POLICY "Company_tenant_policy" ON "Company"
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  );

ALTER POLICY "CompanyMembership_tenant_policy" ON "CompanyMembership"
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  );

ALTER POLICY "WorkflowPreferences_tenant_policy" ON "WorkflowPreferences"
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  );

ALTER POLICY "BusinessDefaults_tenant_policy" ON "BusinessDefaults"
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  );

ALTER POLICY "SetupStepState_tenant_policy" ON "SetupStepState"
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
      )
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
          AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
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
          AND app_bootstrap_allows_owner("organizationId", app_current_actor_user_id())
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
