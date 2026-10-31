DO $$
BEGIN
  IF to_regclass('public."ProductAnalyticsConsent"') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE ON TABLE "ProductAnalyticsConsent" FROM clearledger_runtime;
  END IF;
END $$;
DROP POLICY IF EXISTS "ProductAnalyticsConsent_tenant_policy" ON "ProductAnalyticsConsent";
DROP INDEX IF EXISTS "ProductAnalyticsConsent_organizationId_enabled_idx";
DROP INDEX IF EXISTS "ProductAnalyticsConsent_organizationId_userId_key";
DROP TABLE IF EXISTS "ProductAnalyticsConsent";
