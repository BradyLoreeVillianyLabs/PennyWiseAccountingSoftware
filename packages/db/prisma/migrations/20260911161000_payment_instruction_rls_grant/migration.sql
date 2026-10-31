ALTER TABLE "PaymentInstructionSettings" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "PaymentInstructionSettings_tenant_policy"
  ON "PaymentInstructionSettings"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "PaymentInstructionSettings"
TO clearledger_runtime;
