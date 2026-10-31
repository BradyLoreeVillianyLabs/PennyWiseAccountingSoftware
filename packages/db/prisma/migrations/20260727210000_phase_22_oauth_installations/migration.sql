CREATE TYPE "OAuthClientStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "OAuthClient" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "clientId" VARCHAR(64) NOT NULL,
  "clientSecretHash" CHAR(64) NOT NULL,
  "creationKeyHash" CHAR(64) NOT NULL,
  "redirectUris" TEXT[] NOT NULL,
  "allowedScopes" TEXT[] NOT NULL,
  "status" "OAuthClientStatus" NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthClient_clientId_key" UNIQUE ("clientId"),
  CONSTRAINT "OAuthClient_clientSecretHash_key" UNIQUE ("clientSecretHash"),
  CONSTRAINT "OAuthClient_organizationId_id_key" UNIQUE ("organizationId", "id"),
  CONSTRAINT "OAuthClient_organizationId_creationKeyHash_key" UNIQUE ("organizationId", "creationKeyHash"),
  CONSTRAINT "OAuthClient_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "OAuthClient_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT
);
CREATE INDEX "OAuthClient_organizationId_status_createdAt_idx" ON "OAuthClient" ("organizationId", "status", "createdAt");

CREATE TABLE "OAuthAuthorizationCode" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "redirectUri" VARCHAR(2048) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "codeChallenge" VARCHAR(128) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthAuthorizationCode_codeHash_key" UNIQUE ("codeHash"),
  CONSTRAINT "OAuthAuthorizationCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "OAuthAuthorizationCode_client_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "OAuthClient"("organizationId", "id") ON DELETE CASCADE,
  CONSTRAINT "OAuthAuthorizationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "OAuthAuthorizationCode_organizationId_clientId_expiresAt_idx" ON "OAuthAuthorizationCode" ("organizationId", "clientId", "expiresAt");
CREATE INDEX "OAuthAuthorizationCode_expiresAt_idx" ON "OAuthAuthorizationCode" ("expiresAt");

CREATE TABLE "OAuthAccessToken" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMPTZ(6),
  CONSTRAINT "OAuthAccessToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthAccessToken_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "OAuthAccessToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "OAuthAccessToken_client_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "OAuthClient"("organizationId", "id") ON DELETE CASCADE,
  CONSTRAINT "OAuthAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "OAuthAccessToken_organizationId_clientId_expiresAt_idx" ON "OAuthAccessToken" ("organizationId", "clientId", "expiresAt");
CREATE INDEX "OAuthAccessToken_organizationId_tokenHash_idx" ON "OAuthAccessToken" ("organizationId", "tokenHash");

CREATE TABLE "OAuthRefreshToken" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "familyId" UUID NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  "replacedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OAuthRefreshToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OAuthRefreshToken_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "OAuthRefreshToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "OAuthRefreshToken_client_fkey" FOREIGN KEY ("organizationId", "clientId") REFERENCES "OAuthClient"("organizationId", "id") ON DELETE CASCADE,
  CONSTRAINT "OAuthRefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "OAuthRefreshToken_organizationId_clientId_expiresAt_idx" ON "OAuthRefreshToken" ("organizationId", "clientId", "expiresAt");
CREATE INDEX "OAuthRefreshToken_familyId_idx" ON "OAuthRefreshToken" ("familyId");

GRANT SELECT, INSERT, UPDATE ON "OAuthClient", "OAuthAuthorizationCode", "OAuthAccessToken", "OAuthRefreshToken" TO clearledger_runtime;
ALTER TABLE "OAuthClient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OAuthClient" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OAuthAuthorizationCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OAuthAuthorizationCode" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OAuthAccessToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OAuthAccessToken" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OAuthRefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OAuthRefreshToken" FORCE ROW LEVEL SECURITY;

CREATE POLICY "OAuthClient_tenant_policy" ON "OAuthClient" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "OAuthAuthorizationCode_tenant_policy" ON "OAuthAuthorizationCode" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "OAuthAccessToken_tenant_policy" ON "OAuthAccessToken" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "OAuthRefreshToken_tenant_policy" ON "OAuthRefreshToken" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

CREATE POLICY "OAuthClient_lookup_policy" ON "OAuthClient" FOR SELECT TO clearledger_runtime
  USING (current_setting('app.access_mode', true) = 'oauth_client'
    AND "clientId" = current_setting('app.oauth_client_id', true)
    AND "clientSecretHash" = current_setting('app.oauth_client_secret_hash', true));
CREATE POLICY "OAuthAuthorizationCode_lookup_policy" ON "OAuthAuthorizationCode" FOR SELECT TO clearledger_runtime
  USING (current_setting('app.access_mode', true) = 'oauth_code'
    AND "codeHash" = current_setting('app.oauth_authorization_code_hash', true));
CREATE POLICY "OAuthAccessToken_lookup_policy" ON "OAuthAccessToken" FOR SELECT TO clearledger_runtime
  USING (current_setting('app.access_mode', true) = 'oauth_access_token'
    AND "tokenHash" = current_setting('app.oauth_access_token_hash', true));
CREATE POLICY "OAuthRefreshToken_lookup_policy" ON "OAuthRefreshToken" FOR SELECT TO clearledger_runtime
  USING (current_setting('app.access_mode', true) = 'oauth_refresh_token'
    AND "tokenHash" = current_setting('app.oauth_refresh_token_hash', true));
