CREATE TYPE "ApiCredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "ApiCredential" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "keyPrefix" VARCHAR(32) NOT NULL,
  "secretHash" CHAR(64) NOT NULL,
  "creationKeyHash" CHAR(64) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "status" "ApiCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(6),
  "lastUsedAt" TIMESTAMPTZ(6),
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApiCredential_secretHash_key" UNIQUE ("secretHash"),
  CONSTRAINT "ApiCredential_organizationId_creationKeyHash_key" UNIQUE ("organizationId", "creationKeyHash"),
  CONSTRAINT "ApiCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ApiCredential_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  CONSTRAINT "ApiCredential_organizationId_id_key" UNIQUE ("organizationId", "id")
);

CREATE INDEX "ApiCredential_organizationId_status_createdAt_idx"
  ON "ApiCredential" ("organizationId", "status", "createdAt");
CREATE INDEX "ApiCredential_organizationId_secretHash_idx"
  ON "ApiCredential" ("organizationId", "secretHash");

GRANT SELECT, INSERT, UPDATE ON "ApiCredential" TO clearledger_runtime;
ALTER TABLE "ApiCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiCredential" FORCE ROW LEVEL SECURITY;

CREATE POLICY "ApiCredential_tenant_policy" ON "ApiCredential" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

CREATE POLICY "ApiCredential_lookup_policy" ON "ApiCredential" FOR SELECT TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'api_credential'
    AND "secretHash" = current_setting('app.api_credential_secret_hash', true)
  );
