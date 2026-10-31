DROP POLICY IF EXISTS "AuditEvent_public_invoice_policy" ON "AuditEvent";
DROP POLICY "AuditEvent_tenant_policy" ON "AuditEvent";

CREATE POLICY "AuditEvent_tenant_policy" ON "AuditEvent"
  FOR ALL TO clearledger_runtime
  USING (
    (
      "organizationId" = app_current_organization_id()
      AND (
        app_actor_has_tenant_access()
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
          current_setting('app.access_mode', true) = 'invitation_acceptance'
          AND app_invitation_matches_context()
        )
      )
      AND ("actorUserId" IS NULL OR "actorUserId" = app_current_actor_user_id())
    )
    OR (
      current_setting('app.access_mode', true) = 'public_invoice'
      AND "organizationId" = app_current_organization_id()
      AND "actorUserId" IS NULL
    )
  );
