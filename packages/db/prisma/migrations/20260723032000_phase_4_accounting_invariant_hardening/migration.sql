ALTER TABLE "InvoiceLine"
  ADD CONSTRAINT "InvoiceLine_total_check" CHECK ("totalMinor" = "netAmountMinor" + "taxTotalMinor"),
  ADD CONSTRAINT "InvoiceLine_taxable_check" CHECK ("taxableAmountMinor" = "netAmountMinor");

ALTER TABLE "CreditNoteLine"
  ADD CONSTRAINT "CreditNoteLine_total_check" CHECK ("totalMinor" = "netAmountMinor" + "taxTotalMinor");

CREATE OR REPLACE FUNCTION phase4_protect_invoice_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" NOT IN ('DRAFT', 'APPROVED') THEN
    RAISE EXCEPTION 'Posted invoices are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" NOT IN ('DRAFT', 'APPROVED') THEN
    IF OLD."status" = 'POSTED' AND NEW."status" = 'VOIDED' THEN
      IF NEW."voidedAt" IS NULL OR NEW."voidedByUserId" IS NULL OR NEW."voidReason" IS NULL OR length(trim(NEW."voidReason")) = 0 THEN
        RAISE EXCEPTION 'Voiding requires timestamp, actor, and reason';
      END IF;
    ELSIF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
      OLD."status" = 'POSTED' AND NEW."status" IN ('PARTIALLY_CREDITED', 'CREDITED')
    ) THEN
      RAISE EXCEPTION 'Posted invoice status transition is not permitted';
    END IF;

    IF NEW."customerId" IS DISTINCT FROM OLD."customerId"
      OR NEW."provisionalIdentifier" IS DISTINCT FROM OLD."provisionalIdentifier"
      OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber"
      OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
      OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
      OR NEW."paymentTermsDays" IS DISTINCT FROM OLD."paymentTermsDays"
      OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."subtotalMinor" IS DISTINCT FROM OLD."subtotalMinor"
      OR NEW."discountTotalMinor" IS DISTINCT FROM OLD."discountTotalMinor"
      OR NEW."taxTotalMinor" IS DISTINCT FROM OLD."taxTotalMinor"
      OR NEW."grandTotalMinor" IS DISTINCT FROM OLD."grandTotalMinor"
      OR NEW."amountPaidMinor" IS DISTINCT FROM OLD."amountPaidMinor"
      OR NEW."journalId" IS DISTINCT FROM OLD."journalId"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt"
      OR NEW."postedByUserId" IS DISTINCT FROM OLD."postedByUserId"
      OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
      OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId"
      OR NEW."customerNameSnapshot" IS DISTINCT FROM OLD."customerNameSnapshot"
      OR NEW."customerEmailSnapshot" IS DISTINCT FROM OLD."customerEmailSnapshot"
      OR NEW."billingAddressSnapshot" IS DISTINCT FROM OLD."billingAddressSnapshot"
      OR NEW."serviceAddressSnapshot" IS DISTINCT FROM OLD."serviceAddressSnapshot"
      OR NEW."organizationSnapshot" IS DISTINCT FROM OLD."organizationSnapshot"
      OR NEW."customerFacingNotes" IS DISTINCT FROM OLD."customerFacingNotes"
      OR NEW."internalNotes" IS DISTINCT FROM OLD."internalNotes"
      OR NEW."terms" IS DISTINCT FROM OLD."terms"
      OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR (NEW."status" <> 'VOIDED' AND (NEW."voidedAt" IS DISTINCT FROM OLD."voidedAt" OR NEW."voidedByUserId" IS DISTINCT FROM OLD."voidedByUserId" OR NEW."voidReason" IS DISTINCT FROM OLD."voidReason")) THEN
      RAISE EXCEPTION 'Posted invoice financial and audit history is immutable';
    END IF;

    IF NEW."status" IN ('PARTIALLY_CREDITED', 'CREDITED') AND NOT EXISTS (
      SELECT 1 FROM "CreditNote" WHERE "organizationId" = OLD."organizationId" AND "invoiceId" = OLD."id" AND "status" = 'POSTED'
    ) THEN
      RAISE EXCEPTION 'Credit status requires a posted credit note';
    END IF;
    IF NEW."status" = 'VOIDED' AND NOT EXISTS (
      SELECT 1 FROM "Journal" WHERE "organizationId" = OLD."organizationId" AND "reversedJournalId" = OLD."journalId" AND "status" = 'POSTED'
    ) THEN
      RAISE EXCEPTION 'Voiding requires a posted reversal';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase4_validate_credit_note() RETURNS TRIGGER AS $$
DECLARE line_subtotal BIGINT; line_tax BIGINT; line_total BIGINT;
BEGIN
  IF NEW."status" = 'POSTED' THEN
    SELECT COALESCE(SUM("netAmountMinor"),0), COALESCE(SUM("taxTotalMinor"),0), COALESCE(SUM("totalMinor"),0)
      INTO line_subtotal, line_tax, line_total FROM "CreditNoteLine" WHERE "creditNoteId" = NEW."id";
    IF NEW."grandTotalMinor" <= 0 OR NEW."subtotalMinor" <> line_subtotal OR NEW."taxTotalMinor" <> line_tax OR NEW."grandTotalMinor" <> line_total
      OR NEW."journalId" IS NULL OR NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL
      OR NOT EXISTS (SELECT 1 FROM "Journal" WHERE "id" = NEW."journalId" AND "organizationId" = NEW."organizationId" AND "sourceType" = 'credit_note' AND "sourceId" = NEW."id" AND "status" = 'POSTED')
      OR COALESCE((SELECT SUM("debitMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."grandTotalMinor"
      OR COALESCE((SELECT SUM("creditMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."grandTotalMinor" THEN
      RAISE EXCEPTION 'Posted credit note totals, lines, and journal must agree';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Invoice" WHERE "id" = NEW."invoiceId" AND "organizationId" = NEW."organizationId" AND "status" IN ('POSTED','PARTIALLY_CREDITED')) THEN
      RAISE EXCEPTION 'Credit note source invoice must be posted and open';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION phase4_validate_invoice_totals() RETURNS TRIGGER AS $$
DECLARE line_subtotal BIGINT; line_discount BIGINT; line_tax BIGINT; line_total BIGINT;
BEGIN
  IF NEW."status" IN ('POSTED','PARTIALLY_CREDITED','CREDITED','VOIDED') THEN
    SELECT COALESCE(SUM("grossAmountMinor"),0), COALESCE(SUM("discountMinor"),0), COALESCE(SUM("taxTotalMinor"),0), COALESCE(SUM("totalMinor"),0)
      INTO line_subtotal, line_discount, line_tax, line_total FROM "InvoiceLine" WHERE "invoiceId" = NEW."id";
    IF NEW."subtotalMinor" <> line_subtotal OR NEW."discountTotalMinor" <> line_discount OR NEW."taxTotalMinor" <> line_tax OR NEW."grandTotalMinor" <> line_total
      OR NEW."grandTotalMinor" <> NEW."subtotalMinor" - NEW."discountTotalMinor" + NEW."taxTotalMinor"
      OR NEW."journalId" IS NULL OR NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL
      OR NOT EXISTS (SELECT 1 FROM "Journal" WHERE "id" = NEW."journalId" AND "organizationId" = NEW."organizationId" AND "sourceType" = 'invoice' AND "sourceId" = NEW."id" AND "status" = 'POSTED')
      OR COALESCE((SELECT SUM("debitMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."grandTotalMinor"
      OR COALESCE((SELECT SUM("creditMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."grandTotalMinor" THEN
      RAISE EXCEPTION 'Invoice totals and posted journal must agree';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
