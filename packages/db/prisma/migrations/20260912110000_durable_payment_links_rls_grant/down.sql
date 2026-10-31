DROP POLICY IF EXISTS "PaymentLink_tenant_policy" ON "PaymentLink";
ALTER TABLE "PaymentLink" DISABLE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE ON "PaymentLink" FROM clearledger_runtime;
