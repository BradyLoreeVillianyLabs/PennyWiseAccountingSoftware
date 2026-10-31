DO $rollback$
BEGIN
  IF to_regclass('public."BankReconciliationSnapshot"') IS NULL THEN
    RETURN;
  END IF;

  DROP TABLE "BankReconciliationSnapshot";
DROP TABLE "BankReconciliationItem";
DROP TABLE "BankReconciliation";
DROP TABLE "BankTransfer";
DROP TABLE "BankRule";
DROP TABLE "BankCategorizationLine";
DROP TABLE "BankCategorization";
DROP TABLE "BankTransactionMatch";
DROP TABLE "BankImportedTransaction";
DROP TABLE "BankImportBatch";
DROP TABLE "BankAccount";

DROP FUNCTION phase8_guard_reconciliation();
DROP FUNCTION phase8_guard_reconciliation_item();
DROP FUNCTION phase8_validate_match_total();
DROP FUNCTION phase8_protect_bank_history();
DROP FUNCTION phase8_lock_reconciled_transaction();
DROP FUNCTION phase8_validate_tenant_references();

DROP TYPE "BankReconciliationStatus";
DROP TYPE "BankMatchTargetType";
DROP TYPE "BankTransactionStatus";
DROP TYPE "BankDuplicateStatus";
DROP TYPE "BankTransactionDirection";
DROP TYPE "BankImportBatchStatus";
DROP TYPE "BankImportFormat";
  DROP TYPE "BankAccountKind";
END;
$rollback$;
