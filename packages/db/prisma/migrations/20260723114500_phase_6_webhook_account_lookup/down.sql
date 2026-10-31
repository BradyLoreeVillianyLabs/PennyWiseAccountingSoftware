DO $rollback$
BEGIN
  IF to_regclass('public."PaymentAccount"') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "PaymentAccount_webhook_lookup" ON "PaymentAccount";
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['Account','FiscalPeriod','Journal','JournalLine','Invoice','CreditNote','AuditEvent','OutboxEvent','PaymentAccount','PaymentSettings','Payment','PaymentAllocation','PaymentCheckoutSession','PaymentWebhookEvent','PaymentRefund','PaymentDispute','PaymentReceipt'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_payment_webhook_policy', table_name);
  END LOOP;
END $$;
DROP INDEX IF EXISTS "PaymentAccount_providerAccountLookupHash_key";
ALTER TABLE "PaymentAccount" DROP COLUMN IF EXISTS "providerAccountLookupHash";

END;
$rollback$;
