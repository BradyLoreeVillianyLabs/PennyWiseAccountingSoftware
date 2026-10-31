-- Reverse the organization-level consent transition only while its table is
-- present. The earlier consent migration intentionally removes the table on
-- the same rollback pass, so the verifier's replay pass must be a no-op here.
DO $$
BEGIN
  IF to_regclass('public."ProductEvent"') IS NOT NULL THEN
    ALTER TABLE "ProductEvent" NO FORCE ROW LEVEL SECURITY;
    REVOKE DELETE ON TABLE "ProductEvent" FROM clearledger_runtime;
  END IF;

  IF to_regclass('public."ProductAnalyticsConsent"') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE "ProductAnalyticsConsent" NO FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS "ProductAnalyticsConsent_tenant_policy" ON "ProductAnalyticsConsent";
  DROP INDEX IF EXISTS "ProductAnalyticsConsent_organizationId_key";
  ALTER TABLE "ProductAnalyticsConsent" ADD COLUMN "userId" UUID;
  UPDATE "ProductAnalyticsConsent" AS consent
     SET "userId" = (
       SELECT membership."userId"
       FROM "Membership" AS membership
       WHERE membership."organizationId" = consent."organizationId"
         AND membership."status" = 'ACTIVE'
         AND membership."role" = 'OWNER'
       ORDER BY membership."createdAt" ASC
       LIMIT 1
     );
  DELETE FROM "ProductAnalyticsConsent" WHERE "userId" IS NULL;
  ALTER TABLE "ProductAnalyticsConsent"
    ALTER COLUMN "userId" SET NOT NULL,
    ADD CONSTRAINT "ProductAnalyticsConsent_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  CREATE UNIQUE INDEX "ProductAnalyticsConsent_organizationId_userId_key"
    ON "ProductAnalyticsConsent"("organizationId", "userId");
  CREATE POLICY "ProductAnalyticsConsent_tenant_policy" ON "ProductAnalyticsConsent"
    FOR ALL TO clearledger_runtime
    USING (
      "organizationId" = app_current_organization_id()
      AND "userId" = app_current_actor_user_id()
      AND app_actor_has_tenant_access()
    )
    WITH CHECK (
      "organizationId" = app_current_organization_id()
      AND "userId" = app_current_actor_user_id()
      AND app_actor_has_tenant_access()
    );
END $$;
