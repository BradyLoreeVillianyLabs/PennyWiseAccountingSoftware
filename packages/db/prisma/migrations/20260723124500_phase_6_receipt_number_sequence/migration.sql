CREATE TABLE "PaymentReceiptSequence" (
  "organizationId" UUID PRIMARY KEY REFERENCES "Organization"("id") ON DELETE CASCADE,
  "nextValue" BIGINT NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReceiptSequence_positive_next_value" CHECK ("nextValue" > 0)
);

GRANT SELECT, INSERT, UPDATE ON "PaymentReceiptSequence" TO clearledger_runtime;
ALTER TABLE "PaymentReceiptSequence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentReceiptSequence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PaymentReceiptSequence_tenant_policy" ON "PaymentReceiptSequence"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
