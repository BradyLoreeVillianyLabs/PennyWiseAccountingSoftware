CREATE POLICY "PaymentReceipt_public_invoice_select" ON "PaymentReceipt"
  FOR SELECT TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND EXISTS (
      SELECT 1
      FROM "PaymentAllocation" allocation
      WHERE allocation."paymentId" = "PaymentReceipt"."paymentId"
        AND phase5_public_invoice_access(allocation."organizationId", allocation."invoiceId")
    )
  );
