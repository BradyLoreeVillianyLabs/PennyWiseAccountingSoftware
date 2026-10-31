DO $rollback$
BEGIN
  IF to_regclass('public."AuthenticationAuditEvent"') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "AuthenticationAuditEvent_insert_policy" ON "AuthenticationAuditEvent";
ALTER TABLE "AuthenticationAuditEvent" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "OutboxEvent_tenant_policy" ON "OutboxEvent";
ALTER TABLE "OutboxEvent" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "IdempotencyRecord_tenant_policy" ON "IdempotencyRecord";
ALTER TABLE "IdempotencyRecord" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "AuditEvent_tenant_policy" ON "AuditEvent";
ALTER TABLE "AuditEvent" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "JournalLine_tenant_policy" ON "JournalLine";
ALTER TABLE "JournalLine" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Journal_tenant_policy" ON "Journal";
ALTER TABLE "Journal" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "FiscalPeriod_tenant_policy" ON "FiscalPeriod";
ALTER TABLE "FiscalPeriod" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Account_tenant_policy" ON "Account";
ALTER TABLE "Account" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "OrganizationInvitation_tenant_policy" ON "OrganizationInvitation";
ALTER TABLE "OrganizationInvitation" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Membership_tenant_delete_policy" ON "Membership";
DROP POLICY IF EXISTS "Membership_tenant_update_policy" ON "Membership";
DROP POLICY IF EXISTS "Membership_tenant_insert_policy" ON "Membership";
DROP POLICY IF EXISTS "Membership_tenant_select_policy" ON "Membership";
ALTER TABLE "Membership" DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Organization_tenant_delete_policy" ON "Organization";
DROP POLICY IF EXISTS "Organization_tenant_update_policy" ON "Organization";
DROP POLICY IF EXISTS "Organization_bootstrap_insert_policy" ON "Organization";
DROP POLICY IF EXISTS "Organization_tenant_select_policy" ON "Organization";
ALTER TABLE "Organization" DISABLE ROW LEVEL SECURITY;

-- Later company/consolidation migrations reuse the phase 2 tenant helpers;
-- remove their policies before those helpers are dropped during a full-chain
-- rollback.
DROP POLICY IF EXISTS "Company_tenant_policy" ON "Company";
DROP POLICY IF EXISTS "CompanyMembership_tenant_policy" ON "CompanyMembership";
DROP POLICY IF EXISTS "IntercompanyTransaction_tenant_policy" ON "IntercompanyTransaction";
DROP POLICY IF EXISTS "ConsolidationGroup_tenant_policy" ON "ConsolidationGroup";
DROP POLICY IF EXISTS "ConsolidationGroupMember_tenant_policy" ON "ConsolidationGroupMember";

REVOKE ALL ON FUNCTION resolve_invitation_organization(TEXT) FROM clearledger_runtime;
REVOKE ALL ON FUNCTION list_actor_organizations() FROM clearledger_runtime;
REVOKE ALL ON FUNCTION app_current_actor_user_id() FROM clearledger_runtime;
REVOKE ALL ON FUNCTION app_actor_has_tenant_access() FROM clearledger_runtime;
REVOKE ALL ON FUNCTION app_invitation_matches_context() FROM clearledger_runtime;
REVOKE ALL ON FUNCTION app_bootstrap_allows_owner(UUID, UUID) FROM clearledger_runtime;
REVOKE ALL ON FUNCTION app_current_organization_id() FROM clearledger_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM clearledger_runtime;
REVOKE USAGE ON SCHEMA public FROM clearledger_runtime;

DROP FUNCTION IF EXISTS app_actor_has_tenant_access();
DROP FUNCTION IF EXISTS app_invitation_matches_context();
DROP FUNCTION IF EXISTS app_bootstrap_allows_owner(UUID, UUID);
DROP FUNCTION IF EXISTS app_current_actor_user_id();
DROP FUNCTION IF EXISTS app_current_organization_id();
DROP FUNCTION IF EXISTS resolve_invitation_organization(TEXT);
DROP FUNCTION IF EXISTS list_actor_organizations();

DROP TRIGGER IF EXISTS "Organization_sync_access_locator" ON "Organization";
DROP FUNCTION IF EXISTS sync_organization_access_locator();
DROP TRIGGER IF EXISTS "Membership_sync_access_locator" ON "Membership";
DROP FUNCTION IF EXISTS sync_membership_access_locator();
DROP TABLE IF EXISTS "MembershipAccessLocator";
DROP TRIGGER IF EXISTS "Organization_create_bootstrap_grant" ON "Organization";
DROP FUNCTION IF EXISTS create_organization_bootstrap_grant();
DROP TABLE IF EXISTS "OrganizationBootstrapGrant";

DROP TRIGGER IF EXISTS "OrganizationInvitation_sync_token_locator" ON "OrganizationInvitation";
DROP FUNCTION IF EXISTS sync_invitation_token_locator();
DROP TABLE IF EXISTS "InvitationTokenLocator";

DROP TRIGGER IF EXISTS "Organization_requires_active_owner" ON "Organization";
DROP FUNCTION IF EXISTS require_active_organization_owner();
DROP TRIGGER IF EXISTS "Organization_owner_count_managed" ON "Organization";
DROP FUNCTION IF EXISTS prevent_direct_owner_count_mutation();
DROP TRIGGER IF EXISTS "Membership_sync_active_owner_count" ON "Membership";
DROP FUNCTION IF EXISTS sync_active_owner_count();

DROP TRIGGER IF EXISTS "AuthenticationAuditEvent_append_only_delete" ON "AuthenticationAuditEvent";
DROP TRIGGER IF EXISTS "AuthenticationAuditEvent_append_only_update" ON "AuthenticationAuditEvent";
DROP FUNCTION IF EXISTS prevent_authentication_audit_event_mutation();

DROP TABLE IF EXISTS "AuthenticationAuditEvent";
DROP TABLE IF EXISTS "OrganizationInvitation";
DROP TABLE IF EXISTS "OidcAuthorizationRequest";
DROP TABLE IF EXISTS "Session";
DROP TABLE IF EXISTS "ExternalIdentity";

DROP INDEX IF EXISTS "User_normalized_email_key";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_normalized_check";

DROP INDEX IF EXISTS "Membership_organizationId_status_role_idx";
DROP INDEX IF EXISTS "Membership_userId_status_idx";
CREATE INDEX "Membership_userId_idx" ON "Membership" ("userId");

ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS "Membership_revokedByUserId_fkey";
ALTER TABLE "Membership" DROP CONSTRAINT IF EXISTS "Membership_revocation_state_check";
ALTER TABLE "Membership"
  DROP COLUMN IF EXISTS "updatedAt",
  DROP COLUMN IF EXISTS "revokedByUserId",
  DROP COLUMN IF EXISTS "revokedAt",
  DROP COLUMN IF EXISTS "activatedAt",
  DROP COLUMN IF EXISTS "status";

ALTER TABLE "Organization" DROP CONSTRAINT IF EXISTS "Organization_activeOwnerCount_check";
ALTER TABLE "Organization" DROP COLUMN IF EXISTS "activeOwnerCount";
ALTER TABLE "User" DROP COLUMN IF EXISTS "status";
ALTER TABLE "User" DROP COLUMN IF EXISTS "emailVerifiedAt";

-- The later multi-company foundation intentionally retains CompanyMembership
-- records, but it reuses this phase's enum. Convert the retained column before
-- dropping the phase-owned type so the history can be replayed cleanly.
ALTER TABLE "CompanyMembership"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE text
  USING "status"::text;

DROP TYPE IF EXISTS "AuthenticationFlowPurpose";
DROP TYPE IF EXISTS "InvitationStatus";
DROP TYPE IF EXISTS "MembershipStatus";
DROP TYPE IF EXISTS "UserStatus";

-- Roles are cluster-global and may still serve other databases in the same
-- PostgreSQL cluster. Disposable-database rollback therefore leaves the
-- unprivileged runtime role and migration-owner membership in place.

END;
$rollback$;
