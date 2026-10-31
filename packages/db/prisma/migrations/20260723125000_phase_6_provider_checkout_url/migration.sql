ALTER TABLE "PaymentCheckoutSession"
  ADD COLUMN "providerCheckoutUrl" TEXT;

UPDATE "PaymentCheckoutSession"
SET "providerCheckoutUrl" = '/provider/stripe-test/checkout/' || "providerSessionId"
WHERE "providerCheckoutUrl" IS NULL;

ALTER TABLE "PaymentCheckoutSession"
  ALTER COLUMN "providerCheckoutUrl" SET NOT NULL;

ALTER TABLE "PaymentCheckoutSession"
  ADD CONSTRAINT "PaymentCheckoutSession_provider_url_check"
  CHECK (
    "providerCheckoutUrl" LIKE 'https://%'
    OR "providerCheckoutUrl" LIKE '/provider/stripe-test/checkout/%'
  );
