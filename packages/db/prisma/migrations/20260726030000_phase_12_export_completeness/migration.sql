GRANT SELECT ON "AuthenticationAuditEvent" TO clearledger_runtime;

CREATE POLICY "AuthenticationAuditEvent_tenant_select_policy"
  ON "AuthenticationAuditEvent"
  FOR SELECT
  TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );
