DO $rollback$
BEGIN
  IF to_regclass('public."PaymentReceiptSequence"') IS NOT NULL THEN
    DROP POLICY IF EXISTS "PaymentReceiptSequence_tenant_policy" ON "PaymentReceiptSequence";
    ALTER TABLE "PaymentReceiptSequence" DISABLE ROW LEVEL SECURITY;
    DROP TABLE IF EXISTS "PaymentReceiptSequence";
  END IF;
END;
$rollback$;
