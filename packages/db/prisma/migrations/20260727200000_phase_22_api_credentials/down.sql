DO $rollback$
BEGIN
  IF to_regclass('public."ApiCredential"') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "ApiCredential_lookup_policy" ON "ApiCredential";
DROP POLICY IF EXISTS "ApiCredential_tenant_policy" ON "ApiCredential";
ALTER TABLE "ApiCredential" DISABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ApiCredential" FROM clearledger_runtime;
DROP TABLE "ApiCredential";
  DROP TYPE "ApiCredentialStatus";
END;
$rollback$;
