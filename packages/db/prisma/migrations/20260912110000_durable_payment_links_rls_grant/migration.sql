GRANT SELECT, INSERT, UPDATE ON "PaymentLink" TO clearledger_runtime;

ALTER TABLE "PaymentLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentLink" FORCE ROW LEVEL SECURITY;

CREATE POLICY "PaymentLink_tenant_policy"
  ON "PaymentLink"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );
