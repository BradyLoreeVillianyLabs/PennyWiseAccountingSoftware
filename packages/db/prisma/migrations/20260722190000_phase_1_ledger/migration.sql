CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "MembershipRole" AS ENUM (
  'OWNER',
  'ADMIN',
  'ACCOUNTANT',
  'BOOKKEEPER',
  'SALES',
  'PURCHASES',
  'INVENTORY',
  'READ_ONLY'
);

CREATE TYPE "AccountType" AS ENUM (
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
  'CONTRA_ASSET',
  'CONTRA_REVENUE'
);

CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED');

CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');

CREATE TABLE "User" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "displayName" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Organization" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "legalName" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "timezone" TEXT NOT NULL DEFAULT 'America/Edmonton',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Organization_currency_check" CHECK ("currency" = 'CAD')
);

CREATE TABLE "Membership" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "AccountType" NOT NULL,
  "subtype" TEXT,
  "isControl" BOOLEAN NOT NULL DEFAULT false,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FiscalPeriod" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedAt" TIMESTAMPTZ(6),
  "closedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FiscalPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FiscalPeriod_date_order_check" CHECK ("endDate" >= "startDate")
);

CREATE TABLE "Journal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "fiscalPeriodId" UUID NOT NULL,
  "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "postingKey" TEXT NOT NULL,
  "reversedJournalId" UUID,
  "postedAt" TIMESTAMPTZ(6),
  "postedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "JournalLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "journalId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "description" TEXT,
  "debitMinor" BIGINT NOT NULL DEFAULT 0,
  "creditMinor" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalLine_amounts_check" CHECK (
    "debitMinor" >= 0
    AND "creditMinor" >= 0
    AND ("debitMinor" = 0 OR "creditMinor" = 0)
    AND ("debitMinor" > 0 OR "creditMinor" > 0)
  )
);

CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "actorUserId" UUID,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "requestId" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "operation" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "responseStatus" INTEGER,
  "responseBody" JSONB,
  "resourceId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6),

  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMPTZ(6),

  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User" ("email");
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership" ("organizationId", "userId");
CREATE INDEX "Membership_userId_idx" ON "Membership" ("userId");
CREATE UNIQUE INDEX "Account_organizationId_code_key" ON "Account" ("organizationId", "code");
CREATE INDEX "Account_organizationId_type_idx" ON "Account" ("organizationId", "type");
CREATE UNIQUE INDEX "FiscalPeriod_organizationId_startDate_endDate_key" ON "FiscalPeriod" (
  "organizationId",
  "startDate",
  "endDate"
);
CREATE INDEX "FiscalPeriod_organizationId_status_idx" ON "FiscalPeriod" ("organizationId", "status");
CREATE UNIQUE INDEX "Journal_organizationId_postingKey_key" ON "Journal" (
  "organizationId",
  "postingKey"
);
CREATE UNIQUE INDEX "Journal_organizationId_sourceType_sourceId_key" ON "Journal" (
  "organizationId",
  "sourceType",
  "sourceId"
);
CREATE INDEX "Journal_organizationId_effectiveDate_idx" ON "Journal" (
  "organizationId",
  "effectiveDate"
);
CREATE INDEX "Journal_organizationId_fiscalPeriodId_idx" ON "Journal" (
  "organizationId",
  "fiscalPeriodId"
);
CREATE UNIQUE INDEX "JournalLine_journalId_lineNumber_key" ON "JournalLine" (
  "journalId",
  "lineNumber"
);
CREATE INDEX "JournalLine_organizationId_journalId_idx" ON "JournalLine" (
  "organizationId",
  "journalId"
);
CREATE INDEX "JournalLine_organizationId_accountId_idx" ON "JournalLine" (
  "organizationId",
  "accountId"
);
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent" (
  "organizationId",
  "createdAt"
);
CREATE INDEX "AuditEvent_organizationId_targetType_targetId_idx" ON "AuditEvent" (
  "organizationId",
  "targetType",
  "targetId"
);
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_operation_key_key" ON "IdempotencyRecord" (
  "organizationId",
  "operation",
  "key"
);
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord" ("expiresAt");
CREATE INDEX "OutboxEvent_status_occurredAt_idx" ON "OutboxEvent" ("status", "occurredAt");
CREATE INDEX "OutboxEvent_organizationId_aggregateType_aggregateId_idx" ON "OutboxEvent" (
  "organizationId",
  "aggregateType",
  "aggregateId"
);

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Account"
  ADD CONSTRAINT "Account_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FiscalPeriod"
  ADD CONSTRAINT "FiscalPeriod_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Journal"
  ADD CONSTRAINT "Journal_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Journal"
  ADD CONSTRAINT "Journal_fiscalPeriodId_fkey"
  FOREIGN KEY ("fiscalPeriodId") REFERENCES "FiscalPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Journal"
  ADD CONSTRAINT "Journal_reversedJournalId_fkey"
  FOREIGN KEY ("reversedJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_journalId_fkey"
  FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutboxEvent"
  ADD CONSTRAINT "OutboxEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditEvent_append_only_update"
BEFORE UPDATE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE TRIGGER "AuditEvent_append_only_delete"
BEFORE DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

CREATE OR REPLACE FUNCTION ensure_journal_line_tenant_and_mutability()
RETURNS TRIGGER AS $$
DECLARE
  target_journal_status "JournalStatus";
  target_journal_org UUID;
  target_account_org UUID;
  old_journal_status "JournalStatus";
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT "status" INTO old_journal_status
    FROM "Journal"
    WHERE "id" = OLD."journalId";

    IF old_journal_status = 'POSTED' THEN
      RAISE EXCEPTION 'Posted journal lines are immutable';
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT "status", "organizationId" INTO target_journal_status, target_journal_org
    FROM "Journal"
    WHERE "id" = NEW."journalId";

    IF target_journal_status = 'POSTED' THEN
      RAISE EXCEPTION 'Cannot add lines to a posted journal';
    END IF;

    SELECT "organizationId" INTO target_account_org
    FROM "Account"
    WHERE "id" = NEW."accountId";

    IF target_journal_org IS NULL OR target_account_org IS NULL THEN
      RAISE EXCEPTION 'Journal line references must exist';
    END IF;

    IF NEW."organizationId" <> target_journal_org OR NEW."organizationId" <> target_account_org THEN
      RAISE EXCEPTION 'Journal line organization must match journal and account organizations';
    END IF;

    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "JournalLine_tenant_insert"
BEFORE INSERT ON "JournalLine"
FOR EACH ROW EXECUTE FUNCTION ensure_journal_line_tenant_and_mutability();

CREATE TRIGGER "JournalLine_tenant_update"
BEFORE UPDATE ON "JournalLine"
FOR EACH ROW EXECUTE FUNCTION ensure_journal_line_tenant_and_mutability();

CREATE TRIGGER "JournalLine_tenant_delete"
BEFORE DELETE ON "JournalLine"
FOR EACH ROW EXECUTE FUNCTION ensure_journal_line_tenant_and_mutability();

CREATE OR REPLACE FUNCTION enforce_journal_posting_invariants()
RETURNS TRIGGER AS $$
DECLARE
  line_count INTEGER;
  debit_total BIGINT;
  credit_total BIGINT;
  fiscal_period_org UUID;
  fiscal_period_status "PeriodStatus";
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journals are immutable';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Posted journals are immutable';
  END IF;

  IF NEW."status" = 'POSTED' THEN
    SELECT "organizationId", "status" INTO fiscal_period_org, fiscal_period_status
    FROM "FiscalPeriod"
    WHERE "id" = NEW."fiscalPeriodId";

    IF fiscal_period_org IS NULL OR fiscal_period_org <> NEW."organizationId" THEN
      RAISE EXCEPTION 'Journal fiscal period must belong to the journal organization';
    END IF;

    IF fiscal_period_status <> 'OPEN' THEN
      RAISE EXCEPTION 'Cannot post into a closed fiscal period';
    END IF;

    IF NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL THEN
      RAISE EXCEPTION 'Posted journals require postedAt and postedByUserId';
    END IF;

    SELECT
      COUNT(*),
      COALESCE(SUM("debitMinor"), 0)::BIGINT,
      COALESCE(SUM("creditMinor"), 0)::BIGINT
    INTO line_count, debit_total, credit_total
    FROM "JournalLine"
    WHERE "journalId" = NEW."id";

    IF line_count < 2 THEN
      RAISE EXCEPTION 'Posted journals require at least two lines';
    END IF;

    IF debit_total <> credit_total THEN
      RAISE EXCEPTION 'Posted journal debits and credits must balance';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Journal_posting_invariants_update"
BEFORE UPDATE ON "Journal"
FOR EACH ROW EXECUTE FUNCTION enforce_journal_posting_invariants();

CREATE TRIGGER "Journal_posting_invariants_delete"
BEFORE DELETE ON "Journal"
FOR EACH ROW EXECUTE FUNCTION enforce_journal_posting_invariants();
