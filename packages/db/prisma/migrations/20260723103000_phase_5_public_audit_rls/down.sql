DO $rollback$
BEGIN
  IF to_regclass('public."AuditEvent"') IS NULL
    OR to_regprocedure('public.app_current_organization_id()') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "AuditEvent_tenant_policy" ON "AuditEvent";

CREATE POLICY "AuditEvent_tenant_policy" ON "AuditEvent"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
      )
    )
    AND ("actorUserId" IS NULL OR "actorUserId" = app_current_actor_user_id())
  );

END;
$rollback$;
