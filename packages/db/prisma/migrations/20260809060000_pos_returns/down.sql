DO $$
BEGIN
  IF to_regclass('public."PosReturn"') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE ON TABLE "PosReturn" FROM clearledger_runtime;
  END IF;
END $$;
DROP TRIGGER IF EXISTS "PosReturn_company_guard" ON "PosReturn";
DROP FUNCTION IF EXISTS pos_return_company_guard();
DROP POLICY IF EXISTS "PosReturn_tenant_policy" ON "PosReturn";
DROP TABLE IF EXISTS "PosReturn";
DROP TYPE IF EXISTS "PosReturnStatus";
