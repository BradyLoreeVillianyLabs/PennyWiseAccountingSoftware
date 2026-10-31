-- The bootstrap transaction inserts the owner membership and immediately
-- reads it back to finish company setup. The original tenant SELECT policy
-- allowed invitation acceptance but omitted the organization bootstrap mode,
-- causing every fresh company creation to roll back with a misleading
-- ORGANIZATION_BOOTSTRAP_CONFLICT.
DROP POLICY IF EXISTS "Membership_tenant_select_policy" ON "Membership";

CREATE POLICY "Membership_tenant_select_policy" ON "Membership"
  FOR SELECT TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND "userId" = app_current_actor_user_id()
        AND "role" = 'OWNER'
        AND "status" = 'ACTIVE'
      )
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
        AND "userId" = app_current_actor_user_id()
      )
    )
  );
