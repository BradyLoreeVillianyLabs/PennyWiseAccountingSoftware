ALTER TYPE "BankImportFormat" ADD VALUE IF NOT EXISTS 'FEED';

ALTER TABLE "BankImportBatch" DROP CONSTRAINT IF EXISTS "BankImportBatch_file_check";
ALTER TABLE "BankImportBatch"
  ADD CONSTRAINT "BankImportBatch_file_check"
  CHECK (
    "fileHash" ~ '^[0-9a-f]{64}$'
    AND "fileSize" <= 5242880
    AND (
      (("format")::text = 'FEED' AND "fileSize" >= 0)
      OR (("format")::text <> 'FEED' AND "fileSize" > 0)
    )
  );

CREATE TYPE "BankFeedItemStatus" AS ENUM ('READY', 'DEGRADED', 'CONSENT_EXPIRED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "BankFeedSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "BankFeedTransactionState" AS ENUM ('ACTIVE', 'REMOVED');

CREATE TABLE "BankFeedItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "providerKey" VARCHAR(40) NOT NULL,
  "providerItemReference" VARCHAR(240) NOT NULL,
  "credentialCiphertext" TEXT NOT NULL,
  "credentialVersion" INTEGER NOT NULL DEFAULT 1,
  "institutionReference" VARCHAR(240),
  "institutionName" VARCHAR(240),
  "consentedAt" TIMESTAMPTZ(6) NOT NULL,
  "consentExpiresAt" TIMESTAMPTZ(6),
  "status" "BankFeedItemStatus" NOT NULL DEFAULT 'READY',
  "lastCursor" TEXT,
  "lastSyncAt" TIMESTAMPTZ(6),
  "lastErrorRedacted" TEXT,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BankFeedItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankFeedItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BankFeedAccountMapping" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "bankFeedItemId" UUID NOT NULL,
  "bankAccountId" UUID NOT NULL,
  "providerAccountReference" VARCHAR(240) NOT NULL,
  "displayName" VARCHAR(240) NOT NULL,
  "maskedAccountReference" VARCHAR(64),
  "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "BankFeedAccountMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankFeedAccountMapping_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankFeedAccountMapping_bankFeedItemId_fkey" FOREIGN KEY ("bankFeedItemId") REFERENCES "BankFeedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankFeedAccountMapping_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "BankFeedSync" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "bankFeedItemId" UUID NOT NULL,
  "status" "BankFeedSyncStatus" NOT NULL DEFAULT 'RUNNING',
  "cursorBefore" TEXT,
  "cursorAfter" TEXT,
  "addedCount" INTEGER NOT NULL DEFAULT 0,
  "modifiedCount" INTEGER NOT NULL DEFAULT 0,
  "removedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedUnmappedCount" INTEGER NOT NULL DEFAULT 0,
  "providerRequestReference" VARCHAR(240),
  "errorRedacted" TEXT,
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  "triggeredByUserId" UUID NOT NULL,
  CONSTRAINT "BankFeedSync_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankFeedSync_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "BankFeedSync_bankFeedItemId_fkey" FOREIGN KEY ("bankFeedItemId") REFERENCES "BankFeedItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "BankImportBatch" ADD COLUMN "bankFeedSyncId" UUID;
ALTER TABLE "BankImportBatch" ADD CONSTRAINT "BankImportBatch_bankFeedSyncId_fkey" FOREIGN KEY ("bankFeedSyncId") REFERENCES "BankFeedSync"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankImportedTransaction"
  ADD COLUMN "bankFeedItemId" UUID,
  ADD COLUMN "providerPayloadHash" CHAR(64),
  ADD COLUMN "feedTransactionState" "BankFeedTransactionState",
  ADD COLUMN "feedLastObservedAt" TIMESTAMPTZ(6);
ALTER TABLE "BankImportedTransaction" ADD CONSTRAINT "BankImportedTransaction_bankFeedItemId_fkey" FOREIGN KEY ("bankFeedItemId") REFERENCES "BankFeedItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "BankFeedItem_organizationId_providerKey_providerItemReference_key" ON "BankFeedItem"("organizationId", "providerKey", "providerItemReference");
CREATE UNIQUE INDEX "BankFeedItem_organizationId_id_key" ON "BankFeedItem"("organizationId", "id");
CREATE INDEX "BankFeedItem_organizationId_status_idx" ON "BankFeedItem"("organizationId", "status");
CREATE UNIQUE INDEX "BankFeedAccountMapping_bankFeedItemId_providerAccountReference_key" ON "BankFeedAccountMapping"("bankFeedItemId", "providerAccountReference");
CREATE UNIQUE INDEX "BankFeedAccountMapping_organizationId_bankAccountId_key" ON "BankFeedAccountMapping"("organizationId", "bankAccountId");
CREATE UNIQUE INDEX "BankFeedAccountMapping_organizationId_id_key" ON "BankFeedAccountMapping"("organizationId", "id");
CREATE INDEX "BankFeedAccountMapping_organizationId_bankFeedItemId_active_idx" ON "BankFeedAccountMapping"("organizationId", "bankFeedItemId", "active");
CREATE UNIQUE INDEX "BankFeedSync_organizationId_id_key" ON "BankFeedSync"("organizationId", "id");
CREATE INDEX "BankFeedSync_organizationId_bankFeedItemId_startedAt_idx" ON "BankFeedSync"("organizationId", "bankFeedItemId", "startedAt");
CREATE UNIQUE INDEX "BankFeedSync_one_running_per_item" ON "BankFeedSync"("bankFeedItemId") WHERE "status" = 'RUNNING';
CREATE INDEX "BankImportBatch_organizationId_bankFeedSyncId_idx" ON "BankImportBatch"("organizationId", "bankFeedSyncId");
CREATE INDEX "BankImportedTransaction_organizationId_bankFeedItemId_feedTransactionState_idx" ON "BankImportedTransaction"("organizationId", "bankFeedItemId", "feedTransactionState");

GRANT SELECT, INSERT, UPDATE, DELETE ON "BankFeedItem", "BankFeedAccountMapping", "BankFeedSync" TO clearledger_runtime;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['BankFeedItem', 'BankFeedAccountMapping', 'BankFeedSync'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;

-- Feed provenance is mutable only as an observation. The original imported
-- transaction evidence and all accounting-review fields remain append-only.
CREATE OR REPLACE FUNCTION phase8_protect_bank_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% history is append-only', TG_TABLE_NAME;
  END IF;
  IF TG_TABLE_NAME = 'BankAccount' THEN
    IF NEW."organizationId" <> OLD."organizationId"
      OR NEW."accountKind" <> OLD."accountKind"
      OR NEW."currency" <> OLD."currency"
      OR NEW."linkedLedgerAccountId" <> OLD."linkedLedgerAccountId"
      OR NEW."openingDate" <> OLD."openingDate" THEN
      RAISE EXCEPTION 'Bank account accounting identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'BankImportedTransaction' THEN
    IF (to_jsonb(NEW) - ARRAY['duplicateStatus','duplicateOverrideReason','status','version','providerPayloadHash','feedTransactionState','feedLastObservedAt'])
      <> (to_jsonb(OLD) - ARRAY['duplicateStatus','duplicateOverrideReason','status','version','providerPayloadHash','feedTransactionState','feedLastObservedAt']) THEN
      RAISE EXCEPTION 'Imported bank transaction source fields are immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'BankImportBatch' THEN
    IF (to_jsonb(NEW) - ARRAY['status','committedAt','committedByUserId','version','updatedAt'])
      <> (to_jsonb(OLD) - ARRAY['status','committedAt','committedByUserId','version','updatedAt'])
      OR OLD."status" <> 'PREVIEWED'
      OR NEW."status" <> 'COMMITTED' THEN
      RAISE EXCEPTION 'Import batch source data and committed history are immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'BankTransactionMatch' THEN
    IF NOT OLD."active"
      OR NEW."active"
      OR NEW."reversedAt" IS NULL
      OR (to_jsonb(NEW) - ARRAY['active','reversedAt','reversedByUserId','reversalReason'])
        <> (to_jsonb(OLD) - ARRAY['active','reversedAt','reversedByUserId','reversalReason']) THEN
      RAISE EXCEPTION 'Bank match history is append-only and may only be reversed once';
    END IF;
  ELSE
    RAISE EXCEPTION '% history is immutable', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
