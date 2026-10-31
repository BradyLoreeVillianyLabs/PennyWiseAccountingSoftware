DELETE FROM "_prisma_migrations"
WHERE "migration_name" = '20260722190000_phase_1_ledger';

DROP TRIGGER IF EXISTS "Journal_posting_invariants_delete" ON "Journal";
DROP TRIGGER IF EXISTS "Journal_posting_invariants_update" ON "Journal";
DROP TRIGGER IF EXISTS "JournalLine_tenant_delete" ON "JournalLine";
DROP TRIGGER IF EXISTS "JournalLine_tenant_update" ON "JournalLine";
DROP TRIGGER IF EXISTS "JournalLine_tenant_insert" ON "JournalLine";
DROP TRIGGER IF EXISTS "AuditEvent_append_only_delete" ON "AuditEvent";
DROP TRIGGER IF EXISTS "AuditEvent_append_only_update" ON "AuditEvent";

DROP FUNCTION IF EXISTS enforce_journal_posting_invariants();
DROP FUNCTION IF EXISTS ensure_journal_line_tenant_and_mutability();
DROP FUNCTION IF EXISTS prevent_audit_event_mutation();

DROP TABLE IF EXISTS "OutboxEvent";
DROP TABLE IF EXISTS "IdempotencyRecord";
DROP TABLE IF EXISTS "AuditEvent";
DROP TABLE IF EXISTS "JournalLine";
DROP TABLE IF EXISTS "Journal";
DROP TABLE IF EXISTS "FiscalPeriod";
DROP TABLE IF EXISTS "Account";
DROP TABLE IF EXISTS "Membership";

-- Later company/consolidation tables are intentionally retained by their
-- compatibility downs. Remove only their parent FKs so the phase 1 identity
-- tables can still be removed without deleting that retained evidence.
ALTER TABLE "Company"
  DROP CONSTRAINT IF EXISTS "Company_createdByUserId_fkey",
  DROP CONSTRAINT IF EXISTS "Company_organizationId_fkey";
ALTER TABLE "CompanyMembership"
  DROP CONSTRAINT IF EXISTS "CompanyMembership_organizationId_fkey",
  DROP CONSTRAINT IF EXISTS "CompanyMembership_userId_fkey";
ALTER TABLE "IntercompanyTransaction"
  DROP CONSTRAINT IF EXISTS "IntercompanyTransaction_organizationId_fkey";
ALTER TABLE "ConsolidationGroup"
  DROP CONSTRAINT IF EXISTS "ConsolidationGroup_organizationId_fkey";
ALTER TABLE "ConsolidationGroupMember"
  DROP CONSTRAINT IF EXISTS "ConsolidationGroupMember_organizationId_fkey";

ALTER TABLE "CompanyMembership"
  ALTER COLUMN "role" TYPE text
  USING "role"::text;

DROP TABLE IF EXISTS "Organization";
DROP TABLE IF EXISTS "User";

DROP TYPE IF EXISTS "OutboxStatus";
DROP TYPE IF EXISTS "PeriodStatus";
DROP TYPE IF EXISTS "JournalStatus";
DROP TYPE IF EXISTS "AccountType";
DROP TYPE IF EXISTS "MembershipRole";

-- Keep Prisma's migration ledger so the verifier can replay the two earliest
-- migrations after this rollback without treating the retained compatibility
-- tables as an unbaselined schema.
DROP EXTENSION IF EXISTS "pgcrypto";
