-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('BANK', 'CREDIT_CARD');

-- CreateEnum
CREATE TYPE "BankImportFormat" AS ENUM ('CSV', 'OFX', 'QFX');

-- CreateEnum
CREATE TYPE "BankImportBatchStatus" AS ENUM ('PREVIEWED', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "BankTransactionDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "BankDuplicateStatus" AS ENUM ('NONE', 'PROBABLE', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "BankTransactionStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'CATEGORIZED');

-- CreateEnum
CREATE TYPE "BankMatchTargetType" AS ENUM ('INVOICE_PAYMENT', 'PROCESSOR_SETTLEMENT', 'BILL_PAYMENT', 'IMMEDIATE_EXPENSE', 'MANUAL_JOURNAL', 'TRANSFER', 'BANK_FEE', 'INTEREST');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "BankAccount" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "accountKind" "BankAccountKind" NOT NULL,
    "maskedAccountReference" TEXT NOT NULL,
    "financialInstitutionName" TEXT,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "linkedLedgerAccountId" UUID NOT NULL,
    "openingDate" DATE NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMPTZ(6),
    "lastImportAt" TIMESTAMPTZ(6),
    "lastReconciledAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankImportBatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "format" "BankImportFormat" NOT NULL,
    "originalFileName" TEXT NOT NULL,
    "fileHash" CHAR(64) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mapping" JSONB,
    "normalizedRows" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "probableDuplicates" INTEGER NOT NULL DEFAULT 0,
    "status" "BankImportBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
    "committedAt" TIMESTAMPTZ(6),
    "committedByUserId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankImportedTransaction" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "importBatchId" UUID NOT NULL,
    "sourceRowNumber" INTEGER NOT NULL,
    "sourceRowIdentifier" TEXT,
    "providerTransactionId" TEXT,
    "postingDate" DATE NOT NULL,
    "transactionDate" DATE,
    "description" TEXT NOT NULL,
    "normalizedDescription" TEXT NOT NULL,
    "payee" TEXT,
    "memo" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "direction" "BankTransactionDirection" NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "balanceMinor" BIGINT,
    "referenceNumber" TEXT,
    "rawFingerprint" CHAR(64) NOT NULL,
    "duplicateStatus" "BankDuplicateStatus" NOT NULL DEFAULT 'NONE',
    "probableDuplicateOfId" UUID,
    "duplicateOverrideReason" TEXT,
    "status" "BankTransactionStatus" NOT NULL DEFAULT 'UNMATCHED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankImportedTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransactionMatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "importedTransactionId" UUID NOT NULL,
    "targetJournalId" UUID NOT NULL,
    "targetType" "BankMatchTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "confidenceBasisPoints" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reversedAt" TIMESTAMPTZ(6),
    "reversedByUserId" UUID,
    "reversalReason" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransactionMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankCategorization" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "importedTransactionId" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "vendorId" UUID,
    "customerId" UUID,
    "memo" TEXT,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankCategorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankCategorizationLine" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "categorizationId" UUID NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "accountId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "taxCodeId" UUID,
    "taxCodeVersionId" UUID,
    "recoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
    "nonRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
    "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL,
    "taxSnapshot" JSONB,
    "memo" TEXT,

    CONSTRAINT "BankCategorizationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bankAccountId" UUID,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "descriptionContains" TEXT,
    "payeeContains" TEXT,
    "minimumAmountMinor" BIGINT,
    "maximumAmountMinor" BIGINT,
    "direction" "BankTransactionDirection",
    "suggestion" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankTransfer" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceBankAccountId" UUID NOT NULL,
    "destinationBankAccountId" UUID NOT NULL,
    "sourceLedgerAccountId" UUID NOT NULL,
    "destinationLedgerAccountId" UUID NOT NULL,
    "transferDate" DATE NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "reference" TEXT,
    "dedupeKey" CHAR(64) NOT NULL,
    "journalId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "statementStartDate" DATE NOT NULL,
    "statementEndDate" DATE NOT NULL,
    "openingStatementBalanceMinor" BIGINT NOT NULL,
    "closingStatementBalanceMinor" BIGINT NOT NULL,
    "calculatedClosingBalanceMinor" BIGINT NOT NULL DEFAULT 0,
    "differenceMinor" BIGINT NOT NULL DEFAULT 0,
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "completedByUserId" UUID,
    "completedAt" TIMESTAMPTZ(6),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "lastReopenedByUserId" UUID,
    "lastReopenedAt" TIMESTAMPTZ(6),
    "lastReopenReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliationItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "reconciliationId" UUID NOT NULL,
    "importedTransactionId" UUID NOT NULL,
    "statementImpactMinor" BIGINT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "removedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankReconciliationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliationSnapshot" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "reconciliationId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "completedByUserId" UUID NOT NULL,
    "completedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankReconciliationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankAccount_organizationId_isActive_idx" ON "BankAccount"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_organizationId_linkedLedgerAccountId_key" ON "BankAccount"("organizationId", "linkedLedgerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "BankAccount_organizationId_id_key" ON "BankAccount"("organizationId", "id");

-- CreateIndex
CREATE INDEX "BankImportBatch_organizationId_bankAccountId_createdAt_idx" ON "BankImportBatch"("organizationId", "bankAccountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BankImportBatch_bankAccountId_fileHash_key" ON "BankImportBatch"("bankAccountId", "fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "BankImportBatch_organizationId_id_key" ON "BankImportBatch"("organizationId", "id");

-- CreateIndex
CREATE INDEX "BankImportedTransaction_organizationId_bankAccountId_postin_idx" ON "BankImportedTransaction"("organizationId", "bankAccountId", "postingDate");

-- CreateIndex
CREATE INDEX "BankImportedTransaction_organizationId_status_postingDate_idx" ON "BankImportedTransaction"("organizationId", "status", "postingDate");

-- CreateIndex
CREATE INDEX "BankImportedTransaction_bankAccountId_providerTransactionId_idx" ON "BankImportedTransaction"("bankAccountId", "providerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "BankImportedTransaction_bankAccountId_rawFingerprint_key" ON "BankImportedTransaction"("bankAccountId", "rawFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "BankImportedTransaction_organizationId_id_key" ON "BankImportedTransaction"("organizationId", "id");

-- CreateIndex
CREATE INDEX "BankTransactionMatch_organizationId_targetJournalId_idx" ON "BankTransactionMatch"("organizationId", "targetJournalId");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransactionMatch_importedTransactionId_targetType_targe_key" ON "BankTransactionMatch"("importedTransactionId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "BankCategorization_importedTransactionId_key" ON "BankCategorization"("importedTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "BankCategorization_journalId_key" ON "BankCategorization"("journalId");

-- CreateIndex
CREATE INDEX "BankCategorization_organizationId_createdAt_idx" ON "BankCategorization"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "BankCategorizationLine_organizationId_accountId_idx" ON "BankCategorizationLine"("organizationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "BankCategorizationLine_categorizationId_lineNumber_key" ON "BankCategorizationLine"("categorizationId", "lineNumber");

-- CreateIndex
CREATE INDEX "BankRule_organizationId_isActive_priority_idx" ON "BankRule"("organizationId", "isActive", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "BankRule_organizationId_name_key" ON "BankRule"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BankRule_organizationId_priority_key" ON "BankRule"("organizationId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_journalId_key" ON "BankTransfer"("journalId");

-- CreateIndex
CREATE INDEX "BankTransfer_organizationId_transferDate_idx" ON "BankTransfer"("organizationId", "transferDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_organizationId_dedupeKey_key" ON "BankTransfer"("organizationId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "BankTransfer_organizationId_id_key" ON "BankTransfer"("organizationId", "id");

-- CreateIndex
CREATE INDEX "BankReconciliation_organizationId_bankAccountId_status_idx" ON "BankReconciliation"("organizationId", "bankAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_bankAccountId_statementStartDate_stateme_key" ON "BankReconciliation"("bankAccountId", "statementStartDate", "statementEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_organizationId_id_key" ON "BankReconciliation"("organizationId", "id");

-- CreateIndex
CREATE INDEX "BankReconciliationItem_organizationId_importedTransactionId_idx" ON "BankReconciliationItem"("organizationId", "importedTransactionId", "active");

-- CreateIndex
CREATE INDEX "BankReconciliationItem_reconciliationId_importedTransaction_idx" ON "BankReconciliationItem"("reconciliationId", "importedTransactionId");

CREATE UNIQUE INDEX "BankReconciliationItem_active_transaction_key"
  ON "BankReconciliationItem" ("importedTransactionId")
  WHERE "active";

-- CreateIndex
CREATE INDEX "BankReconciliationSnapshot_organizationId_reconciliationId_idx" ON "BankReconciliationSnapshot"("organizationId", "reconciliationId");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliationSnapshot_reconciliationId_revision_key" ON "BankReconciliationSnapshot"("reconciliationId", "revision");

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_linkedLedgerAccountId_fkey" FOREIGN KEY ("linkedLedgerAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportBatch" ADD CONSTRAINT "BankImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportBatch" ADD CONSTRAINT "BankImportBatch_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportedTransaction" ADD CONSTRAINT "BankImportedTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportedTransaction" ADD CONSTRAINT "BankImportedTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportedTransaction" ADD CONSTRAINT "BankImportedTransaction_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "BankImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankImportedTransaction" ADD CONSTRAINT "BankImportedTransaction_probableDuplicateOfId_fkey" FOREIGN KEY ("probableDuplicateOfId") REFERENCES "BankImportedTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_importedTransactionId_fkey" FOREIGN KEY ("importedTransactionId") REFERENCES "BankImportedTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransactionMatch" ADD CONSTRAINT "BankTransactionMatch_targetJournalId_fkey" FOREIGN KEY ("targetJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorization" ADD CONSTRAINT "BankCategorization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorization" ADD CONSTRAINT "BankCategorization_importedTransactionId_fkey" FOREIGN KEY ("importedTransactionId") REFERENCES "BankImportedTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorization" ADD CONSTRAINT "BankCategorization_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankCategorization" ADD CONSTRAINT "BankCategorization_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankCategorization" ADD CONSTRAINT "BankCategorization_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorizationLine" ADD CONSTRAINT "BankCategorizationLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorizationLine" ADD CONSTRAINT "BankCategorizationLine_categorizationId_fkey" FOREIGN KEY ("categorizationId") REFERENCES "BankCategorization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorizationLine" ADD CONSTRAINT "BankCategorizationLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorizationLine" ADD CONSTRAINT "BankCategorizationLine_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankCategorizationLine" ADD CONSTRAINT "BankCategorizationLine_taxCodeVersionId_fkey" FOREIGN KEY ("taxCodeVersionId") REFERENCES "TaxCodeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankRule" ADD CONSTRAINT "BankRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankRule" ADD CONSTRAINT "BankRule_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_sourceBankAccountId_fkey" FOREIGN KEY ("sourceBankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_destinationBankAccountId_fkey" FOREIGN KEY ("destinationBankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_sourceLedgerAccountId_fkey" FOREIGN KEY ("sourceLedgerAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_destinationLedgerAccountId_fkey" FOREIGN KEY ("destinationLedgerAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankTransfer" ADD CONSTRAINT "BankTransfer_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationItem" ADD CONSTRAINT "BankReconciliationItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationItem" ADD CONSTRAINT "BankReconciliationItem_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationItem" ADD CONSTRAINT "BankReconciliationItem_importedTransactionId_fkey" FOREIGN KEY ("importedTransactionId") REFERENCES "BankImportedTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationSnapshot" ADD CONSTRAINT "BankReconciliationSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationSnapshot" ADD CONSTRAINT "BankReconciliationSnapshot_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-generated identifiers also protect direct SQL paths.
ALTER TABLE "BankAccount" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankImportBatch" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankImportedTransaction" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankTransactionMatch" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankCategorization" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankCategorizationLine" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankRule" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankTransfer" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankReconciliation" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankReconciliationItem" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
ALTER TABLE "BankReconciliationSnapshot" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

ALTER TABLE "BankAccount"
  ADD CONSTRAINT "BankAccount_masked_reference_check"
    CHECK (
      char_length(btrim("maskedAccountReference")) BETWEEN 4 AND 64
      AND "maskedAccountReference" !~ '^[0-9]+$'
      AND char_length(regexp_replace("maskedAccountReference", '[^0-9]', '', 'g')) <= 4
    ),
  ADD CONSTRAINT "BankAccount_currency_check" CHECK ("currency" = 'CAD'),
  ADD CONSTRAINT "BankAccount_version_check" CHECK ("version" > 0);

ALTER TABLE "BankImportBatch"
  ADD CONSTRAINT "BankImportBatch_file_check"
    CHECK ("fileSize" > 0 AND "fileSize" <= 5242880 AND "fileHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "BankImportBatch_count_check"
    CHECK ("rowCount" > 0 AND "probableDuplicates" >= 0 AND "probableDuplicates" <= "rowCount"),
  ADD CONSTRAINT "BankImportBatch_status_check"
    CHECK (
      ("status" = 'PREVIEWED' AND "committedAt" IS NULL AND "committedByUserId" IS NULL)
      OR ("status" = 'COMMITTED' AND "committedAt" IS NOT NULL AND "committedByUserId" IS NOT NULL)
      OR "status" = 'FAILED'
    );

ALTER TABLE "BankImportedTransaction"
  ADD CONSTRAINT "BankImportedTransaction_amount_check" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "BankImportedTransaction_row_check" CHECK ("sourceRowNumber" > 0),
  ADD CONSTRAINT "BankImportedTransaction_currency_check" CHECK ("currency" = 'CAD'),
  ADD CONSTRAINT "BankImportedTransaction_fingerprint_check"
    CHECK ("rawFingerprint" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "BankImportedTransaction_override_check"
    CHECK (
      ("duplicateStatus" = 'OVERRIDDEN' AND nullif(btrim("duplicateOverrideReason"), '') IS NOT NULL)
      OR ("duplicateStatus" <> 'OVERRIDDEN' AND "duplicateOverrideReason" IS NULL)
    );

CREATE UNIQUE INDEX "BankImportedTransaction_provider_id_key"
  ON "BankImportedTransaction" ("bankAccountId", "providerTransactionId")
  WHERE "providerTransactionId" IS NOT NULL;

ALTER TABLE "BankTransactionMatch"
  ADD CONSTRAINT "BankTransactionMatch_amount_check" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "BankTransactionMatch_confidence_check"
    CHECK ("confidenceBasisPoints" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "BankTransactionMatch_reversal_check"
    CHECK (
      ("active" AND "reversedAt" IS NULL AND "reversedByUserId" IS NULL AND "reversalReason" IS NULL)
      OR (
        NOT "active"
        AND "reversedAt" IS NOT NULL
        AND "reversedByUserId" IS NOT NULL
        AND nullif(btrim("reversalReason"), '') IS NOT NULL
      )
    );

ALTER TABLE "BankCategorizationLine"
  ADD CONSTRAINT "BankCategorizationLine_amount_check"
    CHECK (
      "lineNumber" > 0
      AND "amountMinor" > 0
      AND "recoverableTaxMinor" >= 0
      AND "nonRecoverableTaxMinor" >= 0
      AND "taxTotalMinor" = "recoverableTaxMinor" + "nonRecoverableTaxMinor"
      AND "totalMinor" > 0
    );

ALTER TABLE "BankRule"
  ADD CONSTRAINT "BankRule_priority_check" CHECK ("priority" > 0),
  ADD CONSTRAINT "BankRule_amount_range_check"
    CHECK (
      ("minimumAmountMinor" IS NULL OR "minimumAmountMinor" >= 0)
      AND ("maximumAmountMinor" IS NULL OR "maximumAmountMinor" >= 0)
      AND (
        "minimumAmountMinor" IS NULL
        OR "maximumAmountMinor" IS NULL
        OR "minimumAmountMinor" <= "maximumAmountMinor"
      )
    ),
  ADD CONSTRAINT "BankRule_has_condition_check"
    CHECK (
      nullif(btrim("descriptionContains"), '') IS NOT NULL
      OR nullif(btrim("payeeContains"), '') IS NOT NULL
      OR "minimumAmountMinor" IS NOT NULL
      OR "maximumAmountMinor" IS NOT NULL
      OR "direction" IS NOT NULL
    );

ALTER TABLE "BankTransfer"
  ADD CONSTRAINT "BankTransfer_amount_check" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "BankTransfer_accounts_check"
    CHECK (
      "sourceBankAccountId" <> "destinationBankAccountId"
      AND "sourceLedgerAccountId" <> "destinationLedgerAccountId"
    ),
  ADD CONSTRAINT "BankTransfer_currency_check" CHECK ("currency" = 'CAD'),
  ADD CONSTRAINT "BankTransfer_dedupe_check" CHECK ("dedupeKey" ~ '^[0-9a-f]{64}$');

ALTER TABLE "BankReconciliation"
  ADD CONSTRAINT "BankReconciliation_dates_check"
    CHECK ("statementStartDate" <= "statementEndDate"),
  ADD CONSTRAINT "BankReconciliation_difference_check"
    CHECK ("differenceMinor" = "closingStatementBalanceMinor" - "calculatedClosingBalanceMinor"),
  ADD CONSTRAINT "BankReconciliation_completion_check"
    CHECK (
      (
        "status" = 'IN_PROGRESS'
        AND "completedByUserId" IS NULL
        AND "completedAt" IS NULL
      )
      OR (
        "status" = 'COMPLETED'
        AND "completedByUserId" IS NOT NULL
        AND "completedAt" IS NOT NULL
        AND "differenceMinor" = 0
      )
    ),
  ADD CONSTRAINT "BankReconciliation_reopen_check"
    CHECK (
      "reopenCount" >= 0
      AND (
        ("reopenCount" = 0 AND "lastReopenedByUserId" IS NULL AND "lastReopenedAt" IS NULL AND "lastReopenReason" IS NULL)
        OR (
          "reopenCount" > 0
          AND "lastReopenedByUserId" IS NOT NULL
          AND "lastReopenedAt" IS NOT NULL
          AND nullif(btrim("lastReopenReason"), '') IS NOT NULL
        )
      )
    );

ALTER TABLE "BankReconciliationItem"
  ADD CONSTRAINT "BankReconciliationItem_active_check"
    CHECK (("active" AND "removedAt" IS NULL) OR (NOT "active" AND "removedAt" IS NOT NULL));

ALTER TABLE "BankReconciliationSnapshot"
  ADD CONSTRAINT "BankReconciliationSnapshot_revision_check" CHECK ("revision" > 0);

CREATE OR REPLACE FUNCTION phase8_validate_tenant_references()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ref_org UUID;
  ref_account_type "AccountType";
  ref_kind "BankAccountKind";
  ref_currency CHAR(3);
  ref_ledger UUID;
  ref_status "JournalStatus";
  ref_reconciliation_status "BankReconciliationStatus";
  ref_bank_account UUID;
  ref_amount BIGINT;
  ref_direction "BankTransactionDirection";
  ref_debit NUMERIC;
  ref_credit NUMERIC;
  expected_impact BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'BankAccount' THEN
    SELECT "organizationId", "type" INTO ref_org, ref_account_type
    FROM "Account" WHERE "id" = NEW."linkedLedgerAccountId";
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR (NEW."accountKind" = 'BANK' AND ref_account_type <> 'ASSET')
      OR (NEW."accountKind" = 'CREDIT_CARD' AND ref_account_type <> 'LIABILITY') THEN
      RAISE EXCEPTION 'Bank ledger account must belong to the tenant and have a compatible type';
    END IF;
  ELSIF TG_TABLE_NAME = 'BankImportBatch' THEN
    SELECT "organizationId" INTO ref_org FROM "BankAccount" WHERE "id" = NEW."bankAccountId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Import batch bank account tenant mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'BankImportedTransaction' THEN
    SELECT "organizationId" INTO ref_org FROM "BankAccount"
    WHERE "id" = NEW."bankAccountId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Imported transaction bank account tenant mismatch';
    END IF;
    SELECT "organizationId" INTO ref_org FROM "BankImportBatch"
    WHERE "id" = NEW."importBatchId" AND "bankAccountId" = NEW."bankAccountId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Imported transaction batch tenant or account mismatch';
    END IF;
    IF NEW."probableDuplicateOfId" IS NOT NULL THEN
      SELECT "organizationId" INTO ref_org FROM "BankImportedTransaction"
      WHERE "id" = NEW."probableDuplicateOfId" AND "bankAccountId" = NEW."bankAccountId";
      IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
        RAISE EXCEPTION 'Probable duplicate tenant or account mismatch';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'BankTransactionMatch' THEN
    SELECT "organizationId", "bankAccountId", "direction"
      INTO ref_org, ref_bank_account, ref_direction
    FROM "BankImportedTransaction"
    WHERE "id" = NEW."importedTransactionId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Match imported transaction tenant mismatch';
    END IF;
    SELECT "organizationId", "status" INTO ref_org, ref_status FROM "Journal"
    WHERE "id" = NEW."targetJournalId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" OR ref_status <> 'POSTED' THEN
      RAISE EXCEPTION 'Match journal must be a posted tenant journal';
    END IF;
    IF NEW."active" THEN
      PERFORM 1 FROM "Journal" WHERE "id" = NEW."targetJournalId" FOR UPDATE;
      SELECT "linkedLedgerAccountId" INTO ref_ledger
      FROM "BankAccount" WHERE "id" = ref_bank_account;
      PERFORM 1
      FROM "JournalLine"
      WHERE "journalId" = NEW."targetJournalId"
        AND "accountId" = ref_ledger
        AND CASE
          WHEN ref_direction = 'CREDIT' THEN "debitMinor" >= NEW."amountMinor"
          ELSE "creditMinor" >= NEW."amountMinor"
        END;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Match journal does not contain the expected bank-side amount';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM "BankTransactionMatch" existing
        JOIN "BankImportedTransaction" imported
          ON imported."id" = existing."importedTransactionId"
        WHERE existing."targetJournalId" = NEW."targetJournalId"
          AND imported."bankAccountId" = ref_bank_account
          AND existing."active"
          AND existing."id" <> NEW."id"
      ) THEN
        RAISE EXCEPTION 'A journal may only be actively matched once per bank account';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'BankCategorization' THEN
    SELECT "organizationId", "bankAccountId", "amountMinor", "direction"
      INTO ref_org, ref_bank_account, ref_amount, ref_direction
    FROM "BankImportedTransaction"
    WHERE "id" = NEW."importedTransactionId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Categorization imported transaction tenant mismatch';
    END IF;
    SELECT "organizationId", "status" INTO ref_org, ref_status FROM "Journal"
    WHERE "id" = NEW."journalId" AND "sourceType" = 'BANK_CATEGORIZATION'
      AND "sourceId" = NEW."importedTransactionId"::text;
    IF ref_org IS DISTINCT FROM NEW."organizationId" OR ref_status <> 'POSTED' THEN
      RAISE EXCEPTION 'Categorization journal is invalid';
    END IF;
    SELECT "linkedLedgerAccountId" INTO ref_ledger
    FROM "BankAccount" WHERE "id" = ref_bank_account;
    SELECT COALESCE(sum("debitMinor"), 0), COALESCE(sum("creditMinor"), 0)
      INTO ref_debit, ref_credit
    FROM "JournalLine"
    WHERE "journalId" = NEW."journalId" AND "accountId" = ref_ledger;
    IF (ref_direction = 'CREDIT' AND (ref_debit <> ref_amount OR ref_credit <> 0))
      OR (ref_direction = 'DEBIT' AND (ref_credit <> ref_amount OR ref_debit <> 0)) THEN
      RAISE EXCEPTION 'Categorization journal bank-side amount is invalid';
    END IF;
    IF NEW."vendorId" IS NOT NULL THEN
      SELECT "organizationId" INTO ref_org FROM "Vendor" WHERE "id" = NEW."vendorId";
      IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
        RAISE EXCEPTION 'Categorization vendor tenant mismatch';
      END IF;
    END IF;
    IF NEW."customerId" IS NOT NULL THEN
      SELECT "organizationId" INTO ref_org FROM "Customer" WHERE "id" = NEW."customerId";
      IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
        RAISE EXCEPTION 'Categorization customer tenant mismatch';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'BankCategorizationLine' THEN
    SELECT "organizationId" INTO ref_org FROM "BankCategorization"
    WHERE "id" = NEW."categorizationId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Categorization line parent tenant mismatch';
    END IF;
    SELECT "organizationId" INTO ref_org FROM "Account" WHERE "id" = NEW."accountId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Categorization line account tenant mismatch';
    END IF;
    IF NEW."taxCodeId" IS NOT NULL THEN
      SELECT "organizationId" INTO ref_org FROM "TaxCode" WHERE "id" = NEW."taxCodeId";
      IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
        RAISE EXCEPTION 'Categorization tax code tenant mismatch';
      END IF;
    END IF;
    IF NEW."taxCodeVersionId" IS NOT NULL THEN
      SELECT "organizationId" INTO ref_org FROM "TaxCodeVersion"
      WHERE "id" = NEW."taxCodeVersionId" AND "taxCodeId" = NEW."taxCodeId";
      IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
        RAISE EXCEPTION 'Categorization tax version tenant mismatch';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'BankRule' THEN
    IF NEW."bankAccountId" IS NOT NULL THEN
      SELECT "organizationId" INTO ref_org FROM "BankAccount" WHERE "id" = NEW."bankAccountId";
      IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
        RAISE EXCEPTION 'Bank rule account tenant mismatch';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'BankTransfer' THEN
    SELECT "organizationId", "currency", "linkedLedgerAccountId"
      INTO ref_org, ref_currency, ref_ledger
    FROM "BankAccount" WHERE "id" = NEW."sourceBankAccountId";
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR ref_currency <> NEW."currency"
      OR ref_ledger <> NEW."sourceLedgerAccountId" THEN
      RAISE EXCEPTION 'Transfer source account is invalid';
    END IF;
    SELECT "organizationId", "currency", "linkedLedgerAccountId"
      INTO ref_org, ref_currency, ref_ledger
    FROM "BankAccount" WHERE "id" = NEW."destinationBankAccountId";
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR ref_currency <> NEW."currency"
      OR ref_ledger <> NEW."destinationLedgerAccountId" THEN
      RAISE EXCEPTION 'Transfer destination account is invalid';
    END IF;
    SELECT "organizationId", "status" INTO ref_org, ref_status FROM "Journal"
    WHERE "id" = NEW."journalId" AND "sourceType" = 'BANK_TRANSFER'
      AND "sourceId" = NEW."id"::text;
    IF ref_org IS DISTINCT FROM NEW."organizationId" OR ref_status <> 'POSTED' THEN
      RAISE EXCEPTION 'Transfer journal is invalid';
    END IF;
    SELECT COALESCE(sum("creditMinor" - "debitMinor"), 0) INTO ref_credit
    FROM "JournalLine"
    WHERE "journalId" = NEW."journalId" AND "accountId" = NEW."sourceLedgerAccountId";
    SELECT COALESCE(sum("debitMinor" - "creditMinor"), 0) INTO ref_debit
    FROM "JournalLine"
    WHERE "journalId" = NEW."journalId" AND "accountId" = NEW."destinationLedgerAccountId";
    IF ref_credit <> NEW."amountMinor" OR ref_debit <> NEW."amountMinor" THEN
      RAISE EXCEPTION 'Transfer journal does not exactly represent the bank transfer';
    END IF;
  ELSIF TG_TABLE_NAME = 'BankReconciliation' THEN
    SELECT "organizationId" INTO ref_org FROM "BankAccount" WHERE "id" = NEW."bankAccountId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Reconciliation bank account tenant mismatch';
    END IF;
  ELSIF TG_TABLE_NAME = 'BankReconciliationItem' THEN
    SELECT CASE
      WHEN account."accountKind" = 'BANK' THEN
        CASE WHEN imported."direction" = 'CREDIT' THEN imported."amountMinor"
          ELSE -imported."amountMinor" END
      ELSE
        CASE WHEN imported."direction" = 'DEBIT' THEN imported."amountMinor"
          ELSE -imported."amountMinor" END
      END
      INTO expected_impact
    FROM "BankReconciliation" reconciliation
    JOIN "BankAccount" account ON account."id" = reconciliation."bankAccountId"
    JOIN "BankImportedTransaction" imported
      ON imported."id" = NEW."importedTransactionId"
      AND imported."bankAccountId" = reconciliation."bankAccountId"
      AND imported."postingDate" BETWEEN reconciliation."statementStartDate" AND reconciliation."statementEndDate"
    WHERE reconciliation."id" = NEW."reconciliationId"
      AND reconciliation."organizationId" = NEW."organizationId"
      AND imported."organizationId" = NEW."organizationId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Reconciliation item tenant, account, or date mismatch';
    END IF;
    IF NEW."statementImpactMinor" <> expected_impact THEN
      RAISE EXCEPTION 'Reconciliation item statement impact is invalid';
    END IF;
  ELSIF TG_TABLE_NAME = 'BankReconciliationSnapshot' THEN
    SELECT "organizationId", "status" INTO ref_org, ref_reconciliation_status
    FROM "BankReconciliation"
    WHERE "id" = NEW."reconciliationId";
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR ref_reconciliation_status <> 'COMPLETED' THEN
      RAISE EXCEPTION 'Reconciliation snapshot requires a completed tenant reconciliation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'BankAccount', 'BankImportBatch', 'BankImportedTransaction', 'BankTransactionMatch',
    'BankCategorization', 'BankCategorizationLine', 'BankRule', 'BankTransfer',
    'BankReconciliation', 'BankReconciliationItem', 'BankReconciliationSnapshot'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION phase8_validate_tenant_references()',
      table_name || '_tenant_reference_trigger',
      table_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION phase8_lock_reconciled_transaction()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  imported_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'BankImportedTransaction' THEN
    imported_id := COALESCE(NEW."id", OLD."id");
  ELSE
    imported_id := COALESCE(NEW."importedTransactionId", OLD."importedTransactionId");
  END IF;
  PERFORM 1
  FROM "BankReconciliationItem" item
  JOIN "BankReconciliation" reconciliation ON reconciliation."id" = item."reconciliationId"
  WHERE item."importedTransactionId" = imported_id
    AND item."active"
    AND reconciliation."status" = 'COMPLETED';
  IF FOUND THEN
    RAISE EXCEPTION 'A reconciled transaction cannot be changed until reconciliation is reopened';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BankImportedTransaction_reconciled_lock_trigger"
BEFORE UPDATE OR DELETE ON "BankImportedTransaction"
FOR EACH ROW EXECUTE FUNCTION phase8_lock_reconciled_transaction();

CREATE TRIGGER "BankTransactionMatch_reconciled_lock_trigger"
BEFORE UPDATE OR DELETE ON "BankTransactionMatch"
FOR EACH ROW EXECUTE FUNCTION phase8_lock_reconciled_transaction();

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

CREATE TRIGGER "BankAccount_history_trigger"
BEFORE UPDATE OR DELETE ON "BankAccount"
FOR EACH ROW EXECUTE FUNCTION phase8_protect_bank_history();
CREATE TRIGGER "BankImportBatch_history_trigger"
BEFORE UPDATE OR DELETE ON "BankImportBatch"
FOR EACH ROW EXECUTE FUNCTION phase8_protect_bank_history();
CREATE TRIGGER "BankImportedTransaction_history_trigger"
BEFORE UPDATE OR DELETE ON "BankImportedTransaction"
FOR EACH ROW EXECUTE FUNCTION phase8_protect_bank_history();
CREATE TRIGGER "BankTransactionMatch_history_trigger"
BEFORE UPDATE OR DELETE ON "BankTransactionMatch"
FOR EACH ROW EXECUTE FUNCTION phase8_protect_bank_history();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'BankCategorization', 'BankCategorizationLine', 'BankTransfer', 'BankReconciliationSnapshot'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION phase8_protect_bank_history()',
      table_name || '_history_trigger',
      table_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION phase8_validate_match_total()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  imported_id UUID;
  categorization_id UUID;
  imported_status "BankTransactionStatus";
  imported_amount BIGINT;
  matched_amount NUMERIC;
  categorized_amount NUMERIC;
  categorization_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'BankImportedTransaction' THEN
    imported_id := COALESCE(NEW."id", OLD."id");
  ELSIF TG_TABLE_NAME = 'BankCategorizationLine' THEN
    categorization_id := COALESCE(NEW."categorizationId", OLD."categorizationId");
    SELECT "importedTransactionId" INTO imported_id
    FROM "BankCategorization" WHERE "id" = categorization_id;
  ELSE
    imported_id := COALESCE(NEW."importedTransactionId", OLD."importedTransactionId");
  END IF;
  SELECT "status", "amountMinor" INTO imported_status, imported_amount
  FROM "BankImportedTransaction" WHERE "id" = imported_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT COALESCE(sum("amountMinor"), 0) INTO matched_amount
  FROM "BankTransactionMatch" WHERE "importedTransactionId" = imported_id AND "active";
  SELECT count(*) INTO categorization_count
  FROM "BankCategorization" WHERE "importedTransactionId" = imported_id;
  SELECT COALESCE(sum(line."totalMinor"), 0) INTO categorized_amount
  FROM "BankCategorizationLine" line
  JOIN "BankCategorization" categorization ON categorization."id" = line."categorizationId"
  WHERE categorization."importedTransactionId" = imported_id;
  IF imported_status = 'MATCHED'
    AND (matched_amount <> imported_amount OR categorization_count <> 0) THEN
    RAISE EXCEPTION 'Active match amounts must exactly equal the imported transaction';
  ELSIF imported_status = 'CATEGORIZED'
    AND (
      categorization_count <> 1
      OR matched_amount <> 0
      OR categorized_amount <> imported_amount
    ) THEN
    RAISE EXCEPTION 'Categorized transactions require exactly one categorization and no active matches';
  ELSIF imported_status = 'UNMATCHED'
    AND (matched_amount <> 0 OR categorization_count <> 0) THEN
    RAISE EXCEPTION 'Unmatched transactions cannot have active matches or a categorization';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "BankImportedTransaction_match_total_trigger"
AFTER INSERT OR UPDATE ON "BankImportedTransaction"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase8_validate_match_total();
CREATE CONSTRAINT TRIGGER "BankTransactionMatch_total_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "BankTransactionMatch"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase8_validate_match_total();
CREATE CONSTRAINT TRIGGER "BankCategorization_total_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "BankCategorization"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase8_validate_match_total();
CREATE CONSTRAINT TRIGGER "BankCategorizationLine_total_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "BankCategorizationLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase8_validate_match_total();

CREATE OR REPLACE FUNCTION phase8_guard_reconciliation_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  reconciliation_status "BankReconciliationStatus";
BEGIN
  SELECT "status" INTO reconciliation_status
  FROM "BankReconciliation"
  WHERE "id" = NEW."reconciliationId"
  FOR UPDATE;
  IF reconciliation_status <> 'IN_PROGRESS' THEN
    RAISE EXCEPTION 'Completed reconciliation items are immutable';
  END IF;
  PERFORM 1 FROM "BankImportedTransaction"
  WHERE "id" = NEW."importedTransactionId" FOR UPDATE;
  IF NEW."active" AND EXISTS (
    SELECT 1
    FROM "BankReconciliationItem" item
    JOIN "BankReconciliation" reconciliation ON reconciliation."id" = item."reconciliationId"
    WHERE item."importedTransactionId" = NEW."importedTransactionId"
      AND item."active"
      AND reconciliation."status" = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Imported transaction is already in a completed reconciliation';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    NOT OLD."active"
    OR NEW."active"
    OR NEW."removedAt" IS NULL
    OR (to_jsonb(NEW) - ARRAY['active','removedAt'])
      <> (to_jsonb(OLD) - ARRAY['active','removedAt'])
  ) THEN
    RAISE EXCEPTION 'Reconciliation item history is append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BankReconciliationItem_guard_trigger"
BEFORE INSERT OR UPDATE ON "BankReconciliationItem"
FOR EACH ROW EXECUTE FUNCTION phase8_guard_reconciliation_item();

CREATE OR REPLACE FUNCTION phase8_guard_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  impact_total NUMERIC;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reconciliation history is append-only';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'COMPLETED' THEN
    IF NEW."status" <> 'IN_PROGRESS'
      OR NEW."reopenCount" <> OLD."reopenCount" + 1
      OR NEW."lastReopenedAt" IS NULL
      OR NEW."lastReopenedByUserId" IS NULL
      OR nullif(btrim(NEW."lastReopenReason"), '') IS NULL
      OR NEW."completedAt" IS NOT NULL
      OR NEW."completedByUserId" IS NOT NULL
      OR (to_jsonb(NEW) - ARRAY[
        'status','reopenCount','lastReopenedAt','lastReopenedByUserId','lastReopenReason',
        'completedAt','completedByUserId','version','updatedAt'
      ]) <> (to_jsonb(OLD) - ARRAY[
        'status','reopenCount','lastReopenedAt','lastReopenedByUserId','lastReopenReason',
        'completedAt','completedByUserId','version','updatedAt'
      ]) THEN
      RAISE EXCEPTION 'Completed reconciliation may only be reopened through the controlled transition';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."status" = 'COMPLETED' THEN
    SELECT COALESCE(sum("statementImpactMinor"), 0) INTO impact_total
    FROM "BankReconciliationItem"
    WHERE "reconciliationId" = NEW."id" AND "active";
    NEW."calculatedClosingBalanceMinor" := NEW."openingStatementBalanceMinor" + impact_total;
    NEW."differenceMinor" := NEW."closingStatementBalanceMinor" - NEW."calculatedClosingBalanceMinor";
    IF NEW."differenceMinor" <> 0 THEN
      RAISE EXCEPTION 'Reconciliation cannot complete with a non-zero difference';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM "BankReconciliationItem" item
      JOIN "BankImportedTransaction" imported ON imported."id" = item."importedTransactionId"
      WHERE item."reconciliationId" = NEW."id"
        AND item."active"
        AND imported."status" = 'UNMATCHED'
    ) THEN
      RAISE EXCEPTION 'Unmatched transactions cannot be cleared in a completed reconciliation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BankReconciliation_guard_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "BankReconciliation"
FOR EACH ROW EXECUTE FUNCTION phase8_guard_reconciliation();

GRANT SELECT, INSERT, UPDATE ON
  "BankAccount", "BankImportBatch", "BankImportedTransaction", "BankTransactionMatch",
  "BankCategorization", "BankCategorizationLine", "BankRule", "BankTransfer",
  "BankReconciliation", "BankReconciliationItem", "BankReconciliationSnapshot"
TO clearledger_runtime;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'BankAccount', 'BankImportBatch', 'BankImportedTransaction', 'BankTransactionMatch',
    'BankCategorization', 'BankCategorizationLine', 'BankRule', 'BankTransfer',
    'BankReconciliation', 'BankReconciliationItem', 'BankReconciliationSnapshot'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy',
      table_name
    );
  END LOOP;
END;
$$;

