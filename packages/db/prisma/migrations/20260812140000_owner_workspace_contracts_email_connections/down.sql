DROP TABLE IF EXISTS "EmailOAuthAttempt";
DROP TABLE IF EXISTS "EmailConnection";
DROP TABLE IF EXISTS "ContractDocument";
DROP TABLE IF EXISTS "ContractTemplate";

DROP TYPE IF EXISTS "EmailConnectionStatus";
DROP TYPE IF EXISTS "EmailConnectionProvider";
DROP TYPE IF EXISTS "ContractDocumentStatus";

ALTER TABLE "WorkflowPreferences"
  DROP COLUMN IF EXISTS "ownerWorkspaceEnabled";
