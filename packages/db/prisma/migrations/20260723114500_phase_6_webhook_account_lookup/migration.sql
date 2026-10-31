ALTER TABLE "PaymentAccount" ADD COLUMN "providerAccountLookupHash" CHAR(64);
CREATE UNIQUE INDEX "PaymentAccount_providerAccountLookupHash_key" ON "PaymentAccount" ("providerAccountLookupHash") WHERE "providerAccountLookupHash" IS NOT NULL;

CREATE POLICY "PaymentAccount_webhook_lookup" ON "PaymentAccount"
  FOR SELECT TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'payment_webhook_lookup'
    AND "providerAccountLookupHash" = NULLIF(current_setting('app.payment_account_lookup_hash', true), '')
  );

DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['Account','FiscalPeriod','Journal','JournalLine','Invoice','CreditNote','AuditEvent','OutboxEvent','PaymentAccount','PaymentSettings','Payment','PaymentAllocation','PaymentCheckoutSession','PaymentWebhookEvent','PaymentRefund','PaymentDispute','PaymentReceipt'] LOOP
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING (current_setting(''app.access_mode'', true) = ''payment_webhook'' AND "organizationId" = app_current_organization_id()) WITH CHECK (current_setting(''app.access_mode'', true) = ''payment_webhook'' AND "organizationId" = app_current_organization_id())', table_name || '_payment_webhook_policy', table_name);
  END LOOP;
END $$;
