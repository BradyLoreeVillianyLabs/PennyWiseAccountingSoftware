DO $rollback$
BEGIN
  IF to_regclass('public."PaymentCheckoutSession"') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "PaymentSettings_public_checkout_select" ON "PaymentSettings";
DROP POLICY IF EXISTS "PaymentAccount_public_checkout_select" ON "PaymentAccount";
ALTER TABLE "PaymentCheckoutSession" DROP CONSTRAINT IF EXISTS "PaymentCheckoutSession_organization_invoice_idempotency_key";
  ALTER TABLE "PaymentCheckoutSession" DROP COLUMN IF EXISTS "idempotencyKeyHash";
END;
$rollback$;
