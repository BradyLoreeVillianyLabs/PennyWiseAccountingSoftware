-- Telemetry is an organization-level beta choice. Existing member-level rows
-- are deliberately removed when scope changes so the migration never expands
-- consent without an OWNER or ADMIN affirmatively choosing it again.
DROP POLICY IF EXISTS "ProductAnalyticsConsent_tenant_policy" ON "ProductAnalyticsConsent";
DELETE FROM "ProductAnalyticsConsent";
DROP INDEX IF EXISTS "ProductAnalyticsConsent_organizationId_userId_key";
ALTER TABLE "ProductAnalyticsConsent"
  DROP CONSTRAINT IF EXISTS "ProductAnalyticsConsent_userId_fkey";
ALTER TABLE "ProductAnalyticsConsent" DROP COLUMN IF EXISTS "userId";
CREATE UNIQUE INDEX "ProductAnalyticsConsent_organizationId_key"
  ON "ProductAnalyticsConsent"("organizationId");

ALTER TABLE "ProductAnalyticsConsent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ProductAnalyticsConsent_tenant_policy" ON "ProductAnalyticsConsent"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );

-- ProductEvent rows created before the server-enforced organization-consent
-- boundary cannot be proven consented. Product telemetry is not authoritative
-- accounting history, so delete it rather than retain unverifiable records.
-- This precedes FORCE RLS so the privileged migration transaction can perform
-- one explicit privacy purge without creating a cross-tenant runtime path.
DELETE FROM "ProductEvent";

-- Enforce the same database boundary for consented event records. Application
-- permissions determine who may change consent; RLS prevents cross-tenant data
-- access even if a service query is accidentally under-scoped.
ALTER TABLE "ProductEvent" FORCE ROW LEVEL SECURITY;
GRANT DELETE ON TABLE "ProductEvent" TO clearledger_runtime;
