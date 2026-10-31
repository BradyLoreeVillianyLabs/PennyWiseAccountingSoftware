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
    IF (to_jsonb(NEW) - ARRAY['duplicateStatus','duplicateOverrideReason','status','version'])
      <> (to_jsonb(OLD) - ARRAY['duplicateStatus','duplicateOverrideReason','status','version']) THEN
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

ALTER TABLE "BankImportBatch" DROP CONSTRAINT IF EXISTS "BankImportBatch_file_check";
ALTER TABLE "BankImportBatch"
  ADD CONSTRAINT "BankImportBatch_file_check"
  CHECK ("fileSize" > 0 AND "fileSize" <= 5242880 AND "fileHash" ~ '^[0-9a-f]{64}$');

DROP INDEX IF EXISTS "BankFeedSync_one_running_per_item";
DROP INDEX IF EXISTS "BankImportedTransaction_organizationId_bankFeedItemId_feedTransactionState_idx";
DROP INDEX IF EXISTS "BankImportBatch_organizationId_bankFeedSyncId_idx";
DROP INDEX IF EXISTS "BankFeedSync_organizationId_bankFeedItemId_startedAt_idx";
DROP INDEX IF EXISTS "BankFeedSync_organizationId_id_key";
DROP INDEX IF EXISTS "BankFeedAccountMapping_organizationId_bankFeedItemId_active_idx";
DROP INDEX IF EXISTS "BankFeedAccountMapping_organizationId_id_key";
DROP INDEX IF EXISTS "BankFeedAccountMapping_organizationId_bankAccountId_key";
DROP INDEX IF EXISTS "BankFeedAccountMapping_bankFeedItemId_providerAccountReference_key";
DROP INDEX IF EXISTS "BankFeedItem_organizationId_status_idx";
DROP INDEX IF EXISTS "BankFeedItem_organizationId_id_key";
DROP INDEX IF EXISTS "BankFeedItem_organizationId_providerKey_providerItemReference_key";

ALTER TABLE "BankImportedTransaction" DROP CONSTRAINT IF EXISTS "BankImportedTransaction_bankFeedItemId_fkey";
ALTER TABLE "BankImportedTransaction"
  DROP COLUMN IF EXISTS "feedLastObservedAt",
  DROP COLUMN IF EXISTS "feedTransactionState",
  DROP COLUMN IF EXISTS "providerPayloadHash",
  DROP COLUMN IF EXISTS "bankFeedItemId";

ALTER TABLE "BankImportBatch" DROP CONSTRAINT IF EXISTS "BankImportBatch_bankFeedSyncId_fkey";
ALTER TABLE "BankImportBatch" DROP COLUMN IF EXISTS "bankFeedSyncId";

DROP TABLE IF EXISTS "BankFeedSync";
DROP TABLE IF EXISTS "BankFeedAccountMapping";
DROP TABLE IF EXISTS "BankFeedItem";

DROP TYPE IF EXISTS "BankFeedTransactionState";
DROP TYPE IF EXISTS "BankFeedSyncStatus";
DROP TYPE IF EXISTS "BankFeedItemStatus";
