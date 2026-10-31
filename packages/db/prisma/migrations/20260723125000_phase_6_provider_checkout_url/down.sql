DO $rollback$
BEGIN
  IF to_regclass('public."PaymentCheckoutSession"') IS NOT NULL THEN
    ALTER TABLE "PaymentCheckoutSession"
      DROP CONSTRAINT IF EXISTS "PaymentCheckoutSession_provider_url_check";

    ALTER TABLE "PaymentCheckoutSession"
      DROP COLUMN IF EXISTS "providerCheckoutUrl";
  END IF;
END;
$rollback$;
