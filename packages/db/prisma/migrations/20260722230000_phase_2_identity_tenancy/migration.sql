CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "AuthenticationFlowPurpose" AS ENUM ('SIGN_IN', 'REAUTHENTICATE', 'RECOVERY');

ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMPTZ(6),
  ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE "Organization"
  ADD COLUMN "activeOwnerCount" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Organization_activeOwnerCount_check" CHECK ("activeOwnerCount" >= 0);

ALTER TABLE "Membership"
  ADD COLUMN "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "activatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "revokedAt" TIMESTAMPTZ(6),
  ADD COLUMN "revokedByUserId" UUID,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD CONSTRAINT "Membership_revocation_state_check" CHECK (
    ("status" = 'ACTIVE' AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL)
  );

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "Membership_userId_idx";
CREATE INDEX "Membership_userId_status_idx" ON "Membership" ("userId", "status");
CREATE INDEX "Membership_organizationId_status_role_idx"
  ON "Membership" ("organizationId", "status", "role");

CREATE UNIQUE INDEX "User_normalized_email_key" ON "User" (LOWER("email"));
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized_check" CHECK ("email" = LOWER(BTRIM("email")));

CREATE TABLE "ExternalIdentity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "providerIssuer" TEXT NOT NULL,
  "providerSubject" TEXT NOT NULL,
  "emailAtLink" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAuthenticatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalIdentity_email_normalized_check"
    CHECK ("emailAtLink" = LOWER(BTRIM("emailAtLink")))
);

CREATE UNIQUE INDEX "ExternalIdentity_providerIssuer_providerSubject_key"
  ON "ExternalIdentity" ("providerIssuer", "providerSubject");
CREATE INDEX "ExternalIdentity_userId_idx" ON "ExternalIdentity" ("userId");
ALTER TABLE "ExternalIdentity"
  ADD CONSTRAINT "ExternalIdentity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Session" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tokenHash" CHAR(64) NOT NULL,
  "userId" UUID NOT NULL,
  "activeOrganizationId" UUID,
  "issuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "idleExpiresAt" TIMESTAMPTZ(6) NOT NULL,
  "absoluteExpiresAt" TIMESTAMPTZ(6) NOT NULL,
  "recentAuthAt" TIMESTAMPTZ(6) NOT NULL,
  "mfaAuthenticated" BOOLEAN NOT NULL DEFAULT false,
  "revokedAt" TIMESTAMPTZ(6),
  "revocationReason" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_expiry_order_check" CHECK (
    "issuedAt" <= "idleExpiresAt" AND "idleExpiresAt" <= "absoluteExpiresAt"
  ),
  CONSTRAINT "Session_revocation_state_check" CHECK (
    ("revokedAt" IS NULL AND "revocationReason" IS NULL)
    OR ("revokedAt" IS NOT NULL AND "revocationReason" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session" ("tokenHash");
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session" ("userId", "revokedAt");
CREATE INDEX "Session_activeOrganizationId_userId_idx"
  ON "Session" ("activeOrganizationId", "userId");
CREATE INDEX "Session_idleExpiresAt_idx" ON "Session" ("idleExpiresAt");
CREATE INDEX "Session_absoluteExpiresAt_idx" ON "Session" ("absoluteExpiresAt");
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session"
  ADD CONSTRAINT "Session_activeOrganizationId_fkey"
  FOREIGN KEY ("activeOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OidcAuthorizationRequest" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "stateHash" CHAR(64) NOT NULL,
  "issuer" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "codeVerifier" TEXT NOT NULL,
  "purpose" "AuthenticationFlowPurpose" NOT NULL,
  "expectedUserId" UUID,
  "expectedSessionId" UUID,
  "loginHint" TEXT,
  "returnTo" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OidcAuthorizationRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OidcAuthorizationRequest_stateHash_key"
  ON "OidcAuthorizationRequest" ("stateHash");
CREATE INDEX "OidcAuthorizationRequest_expiresAt_idx"
  ON "OidcAuthorizationRequest" ("expiresAt");

CREATE TABLE "OrganizationInvitation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "acceptedByUserId" UUID,
  "revokedByUserId" UUID,
  "acceptedAt" TIMESTAMPTZ(6),
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationInvitation_email_normalized_check"
    CHECK ("email" = LOWER(BTRIM("email"))),
  CONSTRAINT "OrganizationInvitation_lifecycle_check" CHECK (
    ("status" = 'PENDING' AND "acceptedAt" IS NULL AND "revokedAt" IS NULL)
    OR ("status" = 'ACCEPTED' AND "acceptedAt" IS NOT NULL AND "acceptedByUserId" IS NOT NULL AND "revokedAt" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedAt" IS NOT NULL AND "revokedByUserId" IS NOT NULL AND "acceptedAt" IS NULL)
    OR ("status" = 'EXPIRED' AND "acceptedAt" IS NULL AND "revokedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "OrganizationInvitation_tokenHash_key"
  ON "OrganizationInvitation" ("tokenHash");
CREATE INDEX "OrganizationInvitation_organizationId_status_expiresAt_idx"
  ON "OrganizationInvitation" ("organizationId", "status", "expiresAt");
CREATE INDEX "OrganizationInvitation_organizationId_email_status_idx"
  ON "OrganizationInvitation" ("organizationId", "email", "status");
CREATE UNIQUE INDEX "OrganizationInvitation_one_pending_email_key"
  ON "OrganizationInvitation" ("organizationId", "email") WHERE "status" = 'PENDING';

ALTER TABLE "OrganizationInvitation"
  ADD CONSTRAINT "OrganizationInvitation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvitation"
  ADD CONSTRAINT "OrganizationInvitation_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvitation"
  ADD CONSTRAINT "OrganizationInvitation_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationInvitation"
  ADD CONSTRAINT "OrganizationInvitation_revokedByUserId_fkey"
  FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AuthenticationAuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID,
  "actorUserId" UUID,
  "targetUserId" UUID,
  "sessionId" UUID,
  "action" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "requestId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthenticationAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuthenticationAuditEvent_organizationId_createdAt_idx"
  ON "AuthenticationAuditEvent" ("organizationId", "createdAt");
CREATE INDEX "AuthenticationAuditEvent_actorUserId_createdAt_idx"
  ON "AuthenticationAuditEvent" ("actorUserId", "createdAt");
CREATE INDEX "AuthenticationAuditEvent_sessionId_idx"
  ON "AuthenticationAuditEvent" ("sessionId");
ALTER TABLE "AuthenticationAuditEvent"
  ADD CONSTRAINT "AuthenticationAuditEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuthenticationAuditEvent"
  ADD CONSTRAINT "AuthenticationAuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuthenticationAuditEvent"
  ADD CONSTRAINT "AuthenticationAuditEvent_targetUserId_fkey"
  FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_authentication_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Authentication audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuthenticationAuditEvent_append_only_update"
BEFORE UPDATE ON "AuthenticationAuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_authentication_audit_event_mutation();

CREATE TRIGGER "AuthenticationAuditEvent_append_only_delete"
BEFORE DELETE ON "AuthenticationAuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_authentication_audit_event_mutation();

UPDATE "Organization" organization
SET "activeOwnerCount" = (
  SELECT COUNT(*)::INTEGER
  FROM "Membership" membership
  WHERE membership."organizationId" = organization."id"
    AND membership."role" = 'OWNER'
    AND membership."status" = 'ACTIVE'
);

CREATE OR REPLACE FUNCTION sync_active_owner_count()
RETURNS TRIGGER AS $$
DECLARE
  old_is_owner BOOLEAN := false;
  new_is_owner BOOLEAN := false;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    old_is_owner := OLD."role" = 'OWNER' AND OLD."status" = 'ACTIVE';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    new_is_owner := NEW."role" = 'OWNER' AND NEW."status" = 'ACTIVE';
  END IF;

  IF old_is_owner AND NOT new_is_owner THEN
    UPDATE "Organization"
    SET "activeOwnerCount" = "activeOwnerCount" - 1
    WHERE "id" = OLD."organizationId" AND "activeOwnerCount" > 1;

    IF NOT FOUND AND EXISTS (SELECT 1 FROM "Organization" WHERE "id" = OLD."organizationId") THEN
      RAISE EXCEPTION 'An organization must retain at least one active owner';
    END IF;
  ELSIF new_is_owner AND NOT old_is_owner THEN
    UPDATE "Organization"
    SET "activeOwnerCount" = "activeOwnerCount" + 1
    WHERE "id" = NEW."organizationId";
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Membership_sync_active_owner_count"
AFTER INSERT OR UPDATE OF "role", "status" OR DELETE ON "Membership"
FOR EACH ROW EXECUTE FUNCTION sync_active_owner_count();

CREATE OR REPLACE FUNCTION prevent_direct_owner_count_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF pg_trigger_depth() < 2 AND NEW."activeOwnerCount" <> OLD."activeOwnerCount" THEN
    RAISE EXCEPTION 'Organization active owner count is managed by membership lifecycle';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Organization_owner_count_managed"
BEFORE UPDATE OF "activeOwnerCount" ON "Organization"
FOR EACH ROW EXECUTE FUNCTION prevent_direct_owner_count_mutation();

CREATE OR REPLACE FUNCTION require_active_organization_owner()
RETURNS TRIGGER AS $$
DECLARE
  current_owner_count INTEGER;
BEGIN
  SELECT "activeOwnerCount" INTO current_owner_count
  FROM "Organization"
  WHERE "id" = NEW."id";

  IF current_owner_count IS NOT NULL AND current_owner_count < 1 THEN
    RAISE EXCEPTION 'An organization must have at least one active owner';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "Organization_requires_active_owner"
AFTER INSERT OR UPDATE OF "activeOwnerCount" ON "Organization"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION require_active_organization_owner();

CREATE TABLE "InvitationTokenLocator" (
  "tokenHash" CHAR(64) NOT NULL,
  "organizationId" UUID NOT NULL,
  "invitationId" UUID NOT NULL,
  CONSTRAINT "InvitationTokenLocator_pkey" PRIMARY KEY ("tokenHash"),
  CONSTRAINT "InvitationTokenLocator_invitationId_key" UNIQUE ("invitationId"),
  CONSTRAINT "InvitationTokenLocator_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "InvitationTokenLocator_invitationId_fkey"
    FOREIGN KEY ("invitationId") REFERENCES "OrganizationInvitation"("id") ON DELETE CASCADE
);

CREATE TABLE "MembershipAccessLocator" (
  "membershipId" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "organizationDisplayName" TEXT NOT NULL,
  CONSTRAINT "MembershipAccessLocator_pkey" PRIMARY KEY ("membershipId"),
  CONSTRAINT "MembershipAccessLocator_organizationId_userId_key"
    UNIQUE ("organizationId", "userId"),
  CONSTRAINT "MembershipAccessLocator_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE,
  CONSTRAINT "MembershipAccessLocator_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "MembershipAccessLocator_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE INDEX "MembershipAccessLocator_userId_idx" ON "MembershipAccessLocator" ("userId");

CREATE TABLE "OrganizationBootstrapGrant" (
  "organizationId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "transactionId" BIGINT NOT NULL,
  CONSTRAINT "OrganizationBootstrapGrant_pkey" PRIMARY KEY ("organizationId"),
  CONSTRAINT "OrganizationBootstrapGrant_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "OrganizationBootstrapGrant_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION create_organization_bootstrap_grant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  actor_user_id UUID;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'clearledger_runtime' THEN
    RETURN NEW;
  END IF;
  actor_user_id := CASE
    WHEN current_setting('app.actor_user_id', true) ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    THEN current_setting('app.actor_user_id', true)::UUID
    ELSE NULL
  END;
  IF current_setting('app.access_mode', true) <> 'organization_bootstrap'
     OR actor_user_id IS NULL THEN
    RAISE EXCEPTION 'Organization bootstrap context is invalid';
  END IF;
  INSERT INTO public."OrganizationBootstrapGrant" (
    "organizationId", "actorUserId", "transactionId"
  ) VALUES (NEW."id", actor_user_id, txid_current());
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Organization_create_bootstrap_grant"
AFTER INSERT ON "Organization"
FOR EACH ROW EXECUTE FUNCTION create_organization_bootstrap_grant();

CREATE OR REPLACE FUNCTION app_bootstrap_allows_owner(p_organization_id UUID, p_actor_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."OrganizationBootstrapGrant" grant_record
    WHERE grant_record."organizationId" = p_organization_id
      AND grant_record."actorUserId" = p_actor_user_id
      AND grant_record."transactionId" = txid_current()
  )
$$;

REVOKE ALL ON FUNCTION app_bootstrap_allows_owner(UUID, UUID) FROM PUBLIC;

INSERT INTO "MembershipAccessLocator" (
  "membershipId", "organizationId", "userId", "role", "organizationDisplayName"
)
SELECT membership."id", membership."organizationId", membership."userId", membership."role", organization."displayName"
FROM "Membership" membership
JOIN "Organization" organization ON organization."id" = membership."organizationId"
WHERE membership."status" = 'ACTIVE';

CREATE OR REPLACE FUNCTION sync_membership_access_locator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND NEW."status" <> 'ACTIVE') THEN
    DELETE FROM public."MembershipAccessLocator" WHERE "membershipId" = OLD."id";
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NEW."status" = 'ACTIVE' THEN
    INSERT INTO public."MembershipAccessLocator" (
      "membershipId", "organizationId", "userId", "role", "organizationDisplayName"
    )
    SELECT NEW."id", NEW."organizationId", NEW."userId", NEW."role", organization."displayName"
    FROM public."Organization" organization
    WHERE organization."id" = NEW."organizationId"
    ON CONFLICT ("membershipId") DO UPDATE SET
      "organizationId" = EXCLUDED."organizationId",
      "userId" = EXCLUDED."userId",
      "role" = EXCLUDED."role",
      "organizationDisplayName" = EXCLUDED."organizationDisplayName";

    IF NEW."role" = 'OWNER' THEN
      DELETE FROM public."OrganizationBootstrapGrant"
      WHERE "organizationId" = NEW."organizationId"
        AND "actorUserId" = NEW."userId"
        AND "transactionId" = txid_current();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Membership_sync_access_locator"
AFTER INSERT OR UPDATE OF "organizationId", "userId", "role", "status" OR DELETE ON "Membership"
FOR EACH ROW EXECUTE FUNCTION sync_membership_access_locator();

CREATE OR REPLACE FUNCTION sync_organization_access_locator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public."MembershipAccessLocator"
  SET "organizationDisplayName" = NEW."displayName"
  WHERE "organizationId" = NEW."id";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Organization_sync_access_locator"
AFTER UPDATE OF "displayName" ON "Organization"
FOR EACH ROW EXECUTE FUNCTION sync_organization_access_locator();

CREATE OR REPLACE FUNCTION list_actor_organizations()
RETURNS TABLE (
  "organizationId" UUID,
  "membershipId" UUID,
  "role" "MembershipRole",
  "displayName" TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT locator."organizationId", locator."membershipId", locator."role", locator."organizationDisplayName"
  FROM public."MembershipAccessLocator" locator
  WHERE locator."userId" = CASE
    WHEN current_setting('app.actor_user_id', true) ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    THEN current_setting('app.actor_user_id', true)::UUID
    ELSE NULL
  END
  ORDER BY locator."organizationDisplayName", locator."organizationId"
$$;

REVOKE ALL ON FUNCTION list_actor_organizations() FROM PUBLIC;

CREATE OR REPLACE FUNCTION sync_invitation_token_locator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "InvitationTokenLocator" WHERE "invitationId" = OLD."id";
    RETURN OLD;
  END IF;

  INSERT INTO "InvitationTokenLocator" ("tokenHash", "organizationId", "invitationId")
  VALUES (NEW."tokenHash", NEW."organizationId", NEW."id")
  ON CONFLICT ("invitationId") DO UPDATE SET
    "tokenHash" = EXCLUDED."tokenHash",
    "organizationId" = EXCLUDED."organizationId";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "OrganizationInvitation_sync_token_locator"
AFTER INSERT OR UPDATE OF "tokenHash", "organizationId" OR DELETE ON "OrganizationInvitation"
FOR EACH ROW EXECUTE FUNCTION sync_invitation_token_locator();

CREATE OR REPLACE FUNCTION resolve_invitation_organization(p_token_hash TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT locator."organizationId"
  FROM public."InvitationTokenLocator" locator
  WHERE locator."tokenHash" = p_token_hash
$$;

REVOKE ALL ON FUNCTION resolve_invitation_organization(TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN current_setting('app.organization_id', true) ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    THEN current_setting('app.organization_id', true)::UUID
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION app_current_actor_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN current_setting('app.actor_user_id', true) ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
    THEN current_setting('app.actor_user_id', true)::UUID
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION app_actor_has_tenant_access()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."MembershipAccessLocator" locator
    WHERE locator."organizationId" = public.app_current_organization_id()
      AND locator."userId" = public.app_current_actor_user_id()
  )
$$;

REVOKE ALL ON FUNCTION app_actor_has_tenant_access() FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_invitation_matches_context()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."InvitationTokenLocator" locator
    WHERE locator."organizationId" = public.app_current_organization_id()
      AND locator."tokenHash" = current_setting('app.invitation_token_hash', true)
  )
$$;

REVOKE ALL ON FUNCTION app_invitation_matches_context() FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clearledger_runtime') THEN
    CREATE ROLE clearledger_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'clearledger_runtime'
      AND (
        rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
        OR rolreplication OR rolbypassrls
      )
  ) THEN
    RAISE EXCEPTION 'clearledger_runtime exists with unsafe privileges';
  END IF;
  EXECUTE format('GRANT clearledger_runtime TO %I', current_user);
END;
$$;

GRANT USAGE ON SCHEMA public TO clearledger_runtime;
GRANT EXECUTE ON FUNCTION app_current_organization_id() TO clearledger_runtime;
GRANT EXECUTE ON FUNCTION app_current_actor_user_id() TO clearledger_runtime;
GRANT EXECUTE ON FUNCTION app_actor_has_tenant_access() TO clearledger_runtime;
GRANT EXECUTE ON FUNCTION app_invitation_matches_context() TO clearledger_runtime;
GRANT EXECUTE ON FUNCTION app_bootstrap_allows_owner(UUID, UUID) TO clearledger_runtime;
GRANT EXECUTE ON FUNCTION resolve_invitation_organization(TEXT) TO clearledger_runtime;
GRANT EXECUTE ON FUNCTION list_actor_organizations() TO clearledger_runtime;

GRANT SELECT, INSERT, UPDATE ON
  "User", "ExternalIdentity", "Session", "OidcAuthorizationRequest"
TO clearledger_runtime;
GRANT INSERT ON "AuthenticationAuditEvent" TO clearledger_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "Organization", "Membership", "OrganizationInvitation", "Account", "FiscalPeriod",
  "Journal", "JournalLine", "AuditEvent", "IdempotencyRecord", "OutboxEvent"
TO clearledger_runtime;

ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Organization_tenant_select_policy" ON "Organization"
  FOR SELECT TO clearledger_runtime
  USING ("id" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "Organization_bootstrap_insert_policy" ON "Organization"
  FOR INSERT TO clearledger_runtime
  WITH CHECK (
    "id" = app_current_organization_id()
    AND app_current_actor_user_id() IS NOT NULL
    AND current_setting('app.access_mode', true) = 'organization_bootstrap'
  );
CREATE POLICY "Organization_tenant_update_policy" ON "Organization"
  FOR UPDATE TO clearledger_runtime
  USING ("id" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("id" = app_current_organization_id() AND app_actor_has_tenant_access());
CREATE POLICY "Organization_tenant_delete_policy" ON "Organization"
  FOR DELETE TO clearledger_runtime
  USING ("id" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Membership_tenant_select_policy" ON "Membership"
  FOR SELECT TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
        AND "userId" = app_current_actor_user_id()
      )
    )
  );
CREATE POLICY "Membership_tenant_insert_policy" ON "Membership"
  FOR INSERT TO clearledger_runtime
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'organization_bootstrap'
        AND app_bootstrap_allows_owner("organizationId", "userId")
        AND "userId" = app_current_actor_user_id()
        AND "role" = 'OWNER'
        AND "status" = 'ACTIVE'
      )
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
        AND "userId" = app_current_actor_user_id()
        AND "status" = 'ACTIVE'
      )
    )
  );
CREATE POLICY "Membership_tenant_update_policy" ON "Membership"
  FOR UPDATE TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
        AND "userId" = app_current_actor_user_id()
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
        AND "userId" = app_current_actor_user_id()
        AND "status" = 'ACTIVE'
      )
    )
  );
CREATE POLICY "Membership_tenant_delete_policy" ON "Membership"
  FOR DELETE TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "OrganizationInvitation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrganizationInvitation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OrganizationInvitation_tenant_policy" ON "OrganizationInvitation"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
        AND "tokenHash" = current_setting('app.invitation_token_hash', true)
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
        AND "tokenHash" = current_setting('app.invitation_token_hash', true)
      )
    )
  );

ALTER TABLE "Account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Account" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Account_tenant_policy" ON "Account"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "FiscalPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FiscalPeriod" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FiscalPeriod_tenant_policy" ON "FiscalPeriod"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "Journal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Journal" FORCE ROW LEVEL SECURITY;
CREATE POLICY "Journal_tenant_policy" ON "Journal"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "JournalLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JournalLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "JournalLine_tenant_policy" ON "JournalLine"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AuditEvent_tenant_policy" ON "AuditEvent"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
      )
    )
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND (
      app_actor_has_tenant_access()
      OR (
        current_setting('app.access_mode', true) = 'invitation_acceptance'
        AND app_invitation_matches_context()
      )
    )
    AND ("actorUserId" IS NULL OR "actorUserId" = app_current_actor_user_id())
  );

ALTER TABLE "IdempotencyRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY "IdempotencyRecord_tenant_policy" ON "IdempotencyRecord"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OutboxEvent_tenant_policy" ON "OutboxEvent"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

ALTER TABLE "AuthenticationAuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthenticationAuditEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AuthenticationAuditEvent_insert_policy" ON "AuthenticationAuditEvent"
  FOR INSERT TO clearledger_runtime
  WITH CHECK (
    ("organizationId" IS NULL OR "organizationId" = app_current_organization_id())
    AND ("actorUserId" IS NULL OR "actorUserId" = app_current_actor_user_id())
  );
