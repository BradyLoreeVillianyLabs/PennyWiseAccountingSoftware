CREATE OR REPLACE FUNCTION phase4_validate_credit_note() RETURNS TRIGGER AS $$
DECLARE line_subtotal BIGINT; line_tax BIGINT; line_total BIGINT;
BEGIN
  IF NEW."status" = 'POSTED' THEN
    SELECT COALESCE(SUM("netAmountMinor"),0), COALESCE(SUM("taxTotalMinor"),0), COALESCE(SUM("totalMinor"),0)
      INTO line_subtotal, line_tax, line_total FROM "CreditNoteLine" WHERE "creditNoteId" = NEW."id";
    IF NEW."grandTotalMinor" <= 0 OR NEW."subtotalMinor" <> line_subtotal OR NEW."taxTotalMinor" <> line_tax OR NEW."grandTotalMinor" <> line_total
      OR NEW."journalId" IS NULL OR NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL
      OR NOT EXISTS (SELECT 1 FROM "Journal" WHERE "id" = NEW."journalId" AND "organizationId" = NEW."organizationId" AND "sourceType" = 'credit_note' AND "sourceId" = NEW."id"::text AND "status" = 'POSTED')
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
      OR NOT EXISTS (SELECT 1 FROM "Journal" WHERE "id" = NEW."journalId" AND "organizationId" = NEW."organizationId" AND "sourceType" = 'invoice' AND "sourceId" = NEW."id"::text AND "status" = 'POSTED')
      OR COALESCE((SELECT SUM("debitMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."grandTotalMinor"
      OR COALESCE((SELECT SUM("creditMinor") FROM "JournalLine" WHERE "journalId" = NEW."journalId"), 0) <> NEW."grandTotalMinor" THEN
      RAISE EXCEPTION 'Invoice totals and posted journal must agree';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
