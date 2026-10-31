-- Company-owned ledger identity must not collide across legal entities in one
-- workspace. Legacy rows without a company remain unique within the workspace
-- until the staged compatibility rollout is complete.
DROP INDEX IF EXISTS "Account_organizationId_code_key";
DROP INDEX IF EXISTS "Account_organizationId_systemPurpose_key";
CREATE UNIQUE INDEX "Account_organizationId_companyId_code_key"
  ON "Account"("organizationId", "companyId", "code")
  WHERE "companyId" IS NOT NULL;
CREATE UNIQUE INDEX "Account_organizationId_companyId_systemPurpose_key"
  ON "Account"("organizationId", "companyId", "systemPurpose")
  WHERE "companyId" IS NOT NULL AND "systemPurpose" IS NOT NULL;
CREATE UNIQUE INDEX "Account_organizationId_legacy_code_key"
  ON "Account"("organizationId", "code")
  WHERE "companyId" IS NULL;
CREATE UNIQUE INDEX "Account_organizationId_legacy_systemPurpose_key"
  ON "Account"("organizationId", "systemPurpose")
  WHERE "companyId" IS NULL AND "systemPurpose" IS NOT NULL;

DROP INDEX IF EXISTS "FiscalPeriod_organizationId_startDate_endDate_key";
CREATE UNIQUE INDEX "FiscalPeriod_organizationId_companyId_startDate_endDate_key"
  ON "FiscalPeriod"("organizationId", "companyId", "startDate", "endDate")
  WHERE "companyId" IS NOT NULL;
CREATE UNIQUE INDEX "FiscalPeriod_organizationId_legacy_startDate_endDate_key"
  ON "FiscalPeriod"("organizationId", "startDate", "endDate")
  WHERE "companyId" IS NULL;

DROP INDEX IF EXISTS "Journal_organizationId_postingKey_key";
DROP INDEX IF EXISTS "Journal_organizationId_sourceType_sourceId_key";
DROP INDEX IF EXISTS "Journal_organizationId_reversedJournalId_key";
CREATE UNIQUE INDEX "Journal_organizationId_companyId_postingKey_key"
  ON "Journal"("organizationId", "companyId", "postingKey")
  WHERE "companyId" IS NOT NULL;
CREATE UNIQUE INDEX "Journal_organizationId_companyId_sourceType_sourceId_key"
  ON "Journal"("organizationId", "companyId", "sourceType", "sourceId")
  WHERE "companyId" IS NOT NULL;
CREATE UNIQUE INDEX "Journal_organizationId_companyId_reversedJournalId_key"
  ON "Journal"("organizationId", "companyId", "reversedJournalId")
  WHERE "companyId" IS NOT NULL AND "reversedJournalId" IS NOT NULL;
CREATE UNIQUE INDEX "Journal_organizationId_legacy_postingKey_key"
  ON "Journal"("organizationId", "postingKey")
  WHERE "companyId" IS NULL;
CREATE UNIQUE INDEX "Journal_organizationId_legacy_sourceType_sourceId_key"
  ON "Journal"("organizationId", "sourceType", "sourceId")
  WHERE "companyId" IS NULL;
CREATE UNIQUE INDEX "Journal_organizationId_legacy_reversedJournalId_key"
  ON "Journal"("organizationId", "reversedJournalId")
  WHERE "companyId" IS NULL AND "reversedJournalId" IS NOT NULL;
