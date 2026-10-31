DO $rollback$
BEGIN
  IF to_regclass('public."PaymentReceipt"') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "PaymentCheckoutSession_public_select_policy" ON "PaymentCheckoutSession";
DROP POLICY IF EXISTS "PaymentCheckoutSession_public_insert_policy" ON "PaymentCheckoutSession";
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['PaymentReceipt','PaymentDispute','PaymentRefund','PaymentWebhookEvent','PaymentCheckoutSession','PaymentAllocation','Payment','PaymentSettings','PaymentAccount'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_policy', table_name);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;
DROP TRIGGER IF EXISTS "PaymentReceipt_append_only_update" ON "PaymentReceipt";
DROP FUNCTION IF EXISTS phase6_protect_payment_receipt();
DROP TRIGGER IF EXISTS "Payment_posted_history_protection" ON "Payment";
DROP TRIGGER IF EXISTS "PaymentAllocation_append_only_update" ON "PaymentAllocation";
DROP FUNCTION IF EXISTS phase6_protect_payment_history();
DROP TRIGGER IF EXISTS "PaymentAllocation_invariant" ON "PaymentAllocation";
DROP FUNCTION IF EXISTS phase6_validate_payment_allocation();
DROP TABLE "PaymentReceipt";
DROP TABLE "PaymentDispute";
DROP TABLE "PaymentRefund";
DROP TABLE "PaymentWebhookEvent";
DROP TABLE "PaymentCheckoutSession";
DROP TABLE "PaymentAllocation";
DROP TABLE "Payment";
DROP TABLE "PaymentSettings";
DROP TABLE "PaymentAccount";
DROP TYPE "PaymentDisputeStatus";
DROP TYPE "PaymentRefundTreatment";
DROP TYPE "PaymentRefundStatus";
DROP TYPE "PaymentWebhookStatus";
DROP TYPE "PaymentSource";
DROP TYPE "PaymentMethodCategory";
DROP TYPE "PaymentStatus";
DROP TYPE "PaymentAccountStatus";
  DROP TYPE "PaymentProvider";
END;
$rollback$;
