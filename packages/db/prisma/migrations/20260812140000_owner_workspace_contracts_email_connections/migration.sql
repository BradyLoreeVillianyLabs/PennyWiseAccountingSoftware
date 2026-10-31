ALTER TABLE "WorkflowPreferences"
  ADD COLUMN "ownerWorkspaceEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "ContractDocumentStatus" AS ENUM (
  'DRAFT', 'READY_FOR_REVIEW', 'SENT', 'ACCEPTED', 'VOIDED'
);

CREATE TYPE "EmailConnectionProvider" AS ENUM ('GMAIL', 'MICROSOFT');
CREATE TYPE "EmailConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

CREATE TABLE "ContractTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "jurisdiction" TEXT,
  "sourceLabel" TEXT,
  "sourceUrl" TEXT,
  "content" TEXT NOT NULL,
  "variableSchema" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractTemplate_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

CREATE TABLE "ContractDocument" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "templateId" UUID,
  "templateKey" TEXT,
  "title" TEXT NOT NULL,
  "jurisdiction" TEXT,
  "sourceLabel" TEXT,
  "sourceUrl" TEXT,
  "content" TEXT NOT NULL,
  "variableSchema" JSONB NOT NULL,
  "variableValues" JSONB NOT NULL,
  "customerId" UUID,
  "projectId" UUID,
  "estimateId" UUID,
  "status" "ContractDocumentStatus" NOT NULL DEFAULT 'DRAFT',
  "legalReviewAcknowledgedAt" TIMESTAMPTZ(6),
  "legalReviewAcknowledgedById" UUID,
  "readyAt" TIMESTAMPTZ(6),
  "readyByUserId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ContractDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractDocument_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

CREATE TABLE "EmailConnection" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "provider" "EmailConnectionProvider" NOT NULL,
  "status" "EmailConnectionStatus" NOT NULL DEFAULT 'PENDING',
  "senderEmail" TEXT,
  "displayName" TEXT,
  "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "credentialCiphertext" TEXT,
  "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  "tokenExpiresAt" TIMESTAMPTZ(6),
  "lastErrorCode" TEXT,
  "connectedAt" TIMESTAMPTZ(6),
  "disconnectedAt" TIMESTAMPTZ(6),
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "EmailConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailConnection_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

CREATE TABLE "EmailOAuthAttempt" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "provider" "EmailConnectionProvider" NOT NULL,
  "userId" UUID NOT NULL,
  "stateHash" CHAR(64) NOT NULL,
  "codeVerifierCiphertext" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmailOAuthAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmailOAuthAttempt_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

CREATE INDEX "ContractTemplate_organizationId_active_name_idx"
  ON "ContractTemplate"("organizationId", "active", "name");
CREATE INDEX "ContractDocument_organizationId_status_updatedAt_idx"
  ON "ContractDocument"("organizationId", "status", "updatedAt");
CREATE INDEX "ContractDocument_organizationId_customerId_updatedAt_idx"
  ON "ContractDocument"("organizationId", "customerId", "updatedAt");
CREATE INDEX "ContractDocument_organizationId_projectId_updatedAt_idx"
  ON "ContractDocument"("organizationId", "projectId", "updatedAt");
CREATE UNIQUE INDEX "EmailConnection_organizationId_provider_key"
  ON "EmailConnection"("organizationId", "provider");
CREATE INDEX "EmailConnection_organizationId_status_updatedAt_idx"
  ON "EmailConnection"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "EmailOAuthAttempt_organizationId_provider_stateHash_key"
  ON "EmailOAuthAttempt"("organizationId", "provider", "stateHash");
CREATE INDEX "EmailOAuthAttempt_organizationId_provider_expiresAt_idx"
  ON "EmailOAuthAttempt"("organizationId", "provider", "expiresAt");

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "ContractTemplate", "ContractDocument", "EmailConnection", "EmailOAuthAttempt"
TO clearledger_runtime;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ContractTemplate', 'ContractDocument', 'EmailConnection', 'EmailOAuthAttempt'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END
$$;
