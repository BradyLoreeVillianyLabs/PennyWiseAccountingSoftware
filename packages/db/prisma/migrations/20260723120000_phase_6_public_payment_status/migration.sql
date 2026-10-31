CREATE POLICY "Payment_public_invoice_status_select" ON "Payment"
  FOR SELECT TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND EXISTS (
      SELECT 1
      FROM "PaymentAllocation" allocation
      JOIN "PublicInvoiceLink" link ON link."organizationId" = allocation."organizationId" AND link."invoiceId" = allocation."invoiceId"
      WHERE allocation."paymentId" = "Payment"."id"
        AND phase5_public_invoice_access(link."organizationId", link."invoiceId")
    )
  );
