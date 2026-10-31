ALTER TABLE "PaymentRefund"
  ADD COLUMN "creditNoteId" UUID;

ALTER TABLE "CreditNote"
  ADD CONSTRAINT "CreditNote_organizationId_id_key" UNIQUE ("organizationId", "id");

ALTER TABLE "PaymentRefund"
  ADD CONSTRAINT "PaymentRefund_credit_note_tenant_fkey"
  FOREIGN KEY ("organizationId", "creditNoteId")
  REFERENCES "CreditNote"("organizationId", "id") ON DELETE RESTRICT;

CREATE INDEX "PaymentRefund_organization_credit_note_status_idx"
  ON "PaymentRefund" ("organizationId", "creditNoteId", "status");

CREATE OR REPLACE FUNCTION phase6_validate_payment_refund() RETURNS TRIGGER AS $$
DECLARE
  payment_row "Payment"%ROWTYPE;
  credit_note_row "CreditNote"%ROWTYPE;
  allocated_to_invoice BIGINT;
  already_refunded BIGINT;
BEGIN
  SELECT * INTO payment_row FROM "Payment"
    WHERE "id" = NEW."paymentId" AND "organizationId" = NEW."organizationId" FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment refund must reference a payment in the same organization';
  END IF;
  IF NEW."treatment" = 'CREDIT_NOTE_AND_REFUND' THEN
    IF NEW."creditNoteId" IS NULL THEN
      RAISE EXCEPTION 'Credit-note refund requires a credit note';
    END IF;
    SELECT * INTO credit_note_row FROM "CreditNote"
      WHERE "id" = NEW."creditNoteId" AND "organizationId" = NEW."organizationId" FOR UPDATE;
    IF NOT FOUND OR credit_note_row."status" <> 'POSTED' THEN
      RAISE EXCEPTION 'Credit-note refund requires a posted credit note in the same organization';
    END IF;
    SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated_to_invoice
      FROM "PaymentAllocation"
      WHERE "paymentId" = NEW."paymentId" AND "invoiceId" = credit_note_row."invoiceId";
    IF allocated_to_invoice = 0 THEN
      RAISE EXCEPTION 'Credit-note refund requires a payment allocation to the credited invoice';
    END IF;
    SELECT COALESCE(SUM("amountMinor"), 0) INTO already_refunded
      FROM "PaymentRefund"
      WHERE "creditNoteId" = NEW."creditNoteId" AND "status" = 'SUCCEEDED';
    IF NEW."amountMinor" + already_refunded > LEAST(credit_note_row."grandTotalMinor", allocated_to_invoice) THEN
      RAISE EXCEPTION 'Credit-note refund exceeds the credited amount allocated by the payment';
    END IF;
  ELSIF NEW."creditNoteId" IS NOT NULL THEN
    RAISE EXCEPTION 'Only the credit-note refund treatment may reference a credit note';
  ELSIF NEW."amountMinor" > payment_row."unappliedMinor" THEN
    RAISE EXCEPTION 'Unapplied payment refund exceeds available customer credit';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentRefund_invariant"
  BEFORE INSERT ON "PaymentRefund"
  FOR EACH ROW EXECUTE FUNCTION phase6_validate_payment_refund();
