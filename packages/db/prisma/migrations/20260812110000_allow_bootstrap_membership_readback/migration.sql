-- The bootstrap grant is intentionally consumed by the membership trigger as
-- soon as the owner membership is inserted. The transaction must still be
-- able to read that just-created owner membership before completing company
-- setup, so this SELECT branch relies on the active bootstrap context and
-- actor/owner invariants rather than the consumed grant.
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
