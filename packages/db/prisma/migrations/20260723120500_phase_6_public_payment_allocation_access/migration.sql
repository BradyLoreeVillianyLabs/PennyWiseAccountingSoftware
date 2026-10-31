CREATE POLICY "PaymentAllocation_public_invoice_status_select" ON "PaymentAllocation"
  FOR SELECT TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND phase5_public_invoice_access("organizationId", "invoiceId")
  );
