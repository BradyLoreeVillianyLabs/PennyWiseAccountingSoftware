ALTER TABLE "PaymentCheckoutSession"
  ADD COLUMN "idempotencyKeyHash" CHAR(64);

UPDATE "PaymentCheckoutSession"
  SET "idempotencyKeyHash" = encode(digest("id"::text, 'sha256'), 'hex')
  WHERE "idempotencyKeyHash" IS NULL;

ALTER TABLE "PaymentCheckoutSession"
  ALTER COLUMN "idempotencyKeyHash" SET NOT NULL;

ALTER TABLE "PaymentCheckoutSession"
  ADD CONSTRAINT "PaymentCheckoutSession_organization_invoice_idempotency_key"
  UNIQUE ("organizationId", "invoiceId", "idempotencyKeyHash");

CREATE POLICY "PaymentAccount_public_checkout_select" ON "PaymentAccount"
  FOR SELECT TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND EXISTS (
      SELECT 1 FROM "PublicInvoiceLink" link
      WHERE link."organizationId" = "PaymentAccount"."organizationId"
        AND phase5_public_invoice_access(link."organizationId", link."invoiceId")
    )
  );

CREATE POLICY "PaymentSettings_public_checkout_select" ON "PaymentSettings"
  FOR SELECT TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND EXISTS (
      SELECT 1 FROM "PublicInvoiceLink" link
      WHERE link."organizationId" = "PaymentSettings"."organizationId"
        AND phase5_public_invoice_access(link."organizationId", link."invoiceId")
    )
  );
