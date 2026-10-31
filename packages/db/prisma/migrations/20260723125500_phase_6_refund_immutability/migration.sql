CREATE OR REPLACE FUNCTION phase6_protect_refund_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment refunds are append-only';
  END IF;
  IF OLD."status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Completed payment refunds are immutable';
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
     OR NEW."paymentId" IS DISTINCT FROM OLD."paymentId"
     OR NEW."creditNoteId" IS DISTINCT FROM OLD."creditNoteId"
     OR NEW."providerRefundId" IS DISTINCT FROM OLD."providerRefundId"
     OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor"
     OR NEW."currency" IS DISTINCT FROM OLD."currency"
     OR NEW."treatment" IS DISTINCT FROM OLD."treatment"
     OR NEW."reason" IS DISTINCT FROM OLD."reason"
     OR NEW."requestedByUserId" IS DISTINCT FROM OLD."requestedByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Payment refund financial history is immutable';
  END IF;
  IF NEW."status" = 'SUCCEEDED'
     AND (NEW."journalId" IS NULL OR NEW."completedAt" IS NULL) THEN
    RAISE EXCEPTION 'Successful payment refund requires a journal and completion time';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "PaymentRefund_append_only"
  BEFORE UPDATE OR DELETE ON "PaymentRefund"
  FOR EACH ROW EXECUTE FUNCTION phase6_protect_refund_history();
