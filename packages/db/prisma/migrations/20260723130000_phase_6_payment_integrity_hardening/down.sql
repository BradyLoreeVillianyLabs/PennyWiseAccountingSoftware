DO $rollback$
BEGIN
  IF to_regclass('public."Payment"') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS "PaymentCheckoutSession_history_protection" ON "PaymentCheckoutSession";
DROP FUNCTION IF EXISTS phase6_protect_checkout_history();
DROP TRIGGER IF EXISTS "PaymentDispute_history_protection" ON "PaymentDispute";
DROP FUNCTION IF EXISTS phase6_protect_dispute_history();
DROP TRIGGER IF EXISTS "PaymentWebhookEvent_history_protection" ON "PaymentWebhookEvent";
DROP FUNCTION IF EXISTS phase6_protect_provider_event_history();

DROP TRIGGER IF EXISTS "Payment_posted_history_protection" ON "Payment";
CREATE OR REPLACE FUNCTION phase6_protect_payment_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'PaymentAllocation' THEN
    RAISE EXCEPTION 'Payment allocations are immutable';
  END IF;
  IF OLD."journalId" IS NOT NULL AND (
    NEW."amountMinor" <> OLD."amountMinor"
    OR NEW."customerId" <> OLD."customerId"
    OR NEW."receivingAccountId" IS DISTINCT FROM OLD."receivingAccountId"
  ) THEN
    RAISE EXCEPTION 'Posted payment financial attributes are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Payment_posted_history_protection"
BEFORE UPDATE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION phase6_protect_payment_history();

ALTER TABLE "PaymentAccount"
  DROP CONSTRAINT "PaymentAccount_provider_reference_check";
ALTER TABLE "PaymentAccount"
  ADD CONSTRAINT "PaymentAccount_provider_reference_check" CHECK (
    ("status" = 'CONNECTED') = ("providerAccountCiphertext" IS NOT NULL)
  );

END;
$rollback$;
