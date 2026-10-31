DROP INDEX IF EXISTS "EmailConnection_one_default_sender_per_organization";
DROP INDEX IF EXISTS "EmailConnection_organizationId_isDefaultSender_idx";

ALTER TABLE "EmailConnection"
  DROP COLUMN IF EXISTS "isDefaultSender";
