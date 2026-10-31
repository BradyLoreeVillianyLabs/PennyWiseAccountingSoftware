DO $rollback$
BEGIN
  IF to_regclass('public."PaymentRefund"') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS "PaymentRefund_invariant" ON "PaymentRefund";
DROP FUNCTION IF EXISTS phase6_validate_payment_refund();
DROP INDEX IF EXISTS "PaymentRefund_organization_credit_note_status_idx";
ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "PaymentRefund_credit_note_tenant_fkey";
ALTER TABLE "PaymentRefund" DROP COLUMN IF EXISTS "creditNoteId";
  ALTER TABLE "CreditNote" DROP CONSTRAINT IF EXISTS "CreditNote_organizationId_id_key";
END;
$rollback$;
