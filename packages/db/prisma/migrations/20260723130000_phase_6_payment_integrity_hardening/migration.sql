ALTER TABLE "PaymentAccount"
  DROP CONSTRAINT "PaymentAccount_provider_reference_check";

ALTER TABLE "PaymentAccount"
  ADD CONSTRAINT "PaymentAccount_provider_reference_check" CHECK (
    ("status" = 'NOT_CONNECTED' AND "providerAccountCiphertext" IS NULL)
    OR
    ("status" IN ('PENDING_ONBOARDING', 'CONNECTED', 'DISCONNECTED')
      AND "providerAccountCiphertext" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION phase6_protect_payment_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'PaymentAllocation' THEN
    RAISE EXCEPTION 'Payment allocations are immutable';
  END IF;
  IF TG_OP = 'DELETE' AND OLD."journalId" IS NOT NULL THEN
    RAISE EXCEPTION 'Posted payments are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."journalId" IS NOT NULL AND (
    NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."customerId" IS DISTINCT FROM OLD."customerId"
    OR NEW."paymentAccountId" IS DISTINCT FROM OLD."paymentAccountId"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."providerPaymentId" IS DISTINCT FROM OLD."providerPaymentId"
    OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
    OR NEW."feeMinor" IS DISTINCT FROM OLD."feeMinor"
    OR NEW."netMinor" IS DISTINCT FROM OLD."netMinor"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."paymentDate" IS DISTINCT FROM OLD."paymentDate"
    OR NEW."methodCategory" IS DISTINCT FROM OLD."methodCategory"
    OR NEW."source" IS DISTINCT FROM OLD."source"
    OR NEW."receivingAccountId" IS DISTINCT FROM OLD."receivingAccountId"
    OR NEW."reference" IS DISTINCT FROM OLD."reference"
    OR NEW."journalId" IS DISTINCT FROM OLD."journalId"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Posted payment financial and provider history is immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER "Payment_posted_history_protection" ON "Payment";
CREATE TRIGGER "Payment_posted_history_protection"
BEFORE UPDATE OR DELETE ON "Payment"
FOR EACH ROW EXECUTE FUNCTION phase6_protect_payment_history();

CREATE OR REPLACE FUNCTION phase6_protect_provider_event_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment provider event history is append-only';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."paymentAccountId" IS DISTINCT FROM OLD."paymentAccountId"
    OR NEW."provider" IS DISTINCT FROM OLD."provider"
    OR NEW."providerEventId" IS DISTINCT FROM OLD."providerEventId"
    OR NEW."eventType" IS DISTINCT FROM OLD."eventType"
    OR NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt"
  THEN
    RAISE EXCEPTION 'Payment provider event identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentWebhookEvent_history_protection"
BEFORE UPDATE OR DELETE ON "PaymentWebhookEvent"
FOR EACH ROW EXECUTE FUNCTION phase6_protect_provider_event_history();

CREATE OR REPLACE FUNCTION phase6_protect_dispute_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment disputes are append-only';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
    OR NEW."providerDisputeId" IS DISTINCT FROM OLD."providerDisputeId"
    OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Payment dispute provider history is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentDispute_history_protection"
BEFORE UPDATE OR DELETE ON "PaymentDispute"
FOR EACH ROW EXECUTE FUNCTION phase6_protect_dispute_history();

CREATE OR REPLACE FUNCTION phase6_protect_checkout_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment checkout history is append-only';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
    OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId"
    OR NEW."paymentAccountId" IS DISTINCT FROM OLD."paymentAccountId"
    OR NEW."providerSessionId" IS DISTINCT FROM OLD."providerSessionId"
    OR NEW."providerCheckoutUrl" IS DISTINCT FROM OLD."providerCheckoutUrl"
    OR NEW."idempotencyKeyHash" IS DISTINCT FROM OLD."idempotencyKeyHash"
    OR NEW."requestedAmountMinor" IS DISTINCT FROM OLD."requestedAmountMinor"
    OR NEW."currency" IS DISTINCT FROM OLD."currency"
    OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Payment checkout financial and provider history is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentCheckoutSession_history_protection"
BEFORE UPDATE OR DELETE ON "PaymentCheckoutSession"
FOR EACH ROW EXECUTE FUNCTION phase6_protect_checkout_history();
