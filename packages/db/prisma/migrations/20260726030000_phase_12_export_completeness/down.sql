DO $rollback$
BEGIN
  IF to_regclass('public."AuthenticationAuditEvent"') IS NOT NULL THEN
    DROP POLICY IF EXISTS "AuthenticationAuditEvent_tenant_select_policy"
      ON "AuthenticationAuditEvent";
    REVOKE SELECT ON "AuthenticationAuditEvent" FROM clearledger_runtime;
  END IF;
END;
$rollback$;
