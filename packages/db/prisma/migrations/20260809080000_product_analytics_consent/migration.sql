-- Product analytics must be opt-in per organization member. Event rows themselves
-- intentionally contain no names, emails, document content, or financial values.
CREATE TABLE "ProductAnalyticsConsent" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "consentedAt" TIMESTAMPTZ(6),
  "withdrawnAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductAnalyticsConsent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductAnalyticsConsent_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProductAnalyticsConsent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ProductAnalyticsConsent_organizationId_userId_key"
  ON "ProductAnalyticsConsent"("organizationId", "userId");
CREATE INDEX "ProductAnalyticsConsent_organizationId_enabled_idx"
  ON "ProductAnalyticsConsent"("organizationId", "enabled");

ALTER TABLE "ProductAnalyticsConsent" ENABLE ROW LEVEL SECURITY;
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

GRANT SELECT, INSERT, UPDATE ON TABLE "ProductAnalyticsConsent" TO clearledger_runtime;
