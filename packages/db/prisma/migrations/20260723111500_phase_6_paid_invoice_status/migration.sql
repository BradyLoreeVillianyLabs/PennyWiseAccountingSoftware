-- A payment changes the operational invoice status but never alters its posted totals.
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_posted_totals_immutable";

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_posted_totals_immutable" CHECK (
  "status" NOT IN ('POSTED', 'PARTIALLY_PAID', 'PAID', 'PARTIALLY_CREDITED', 'CREDITED', 'VOIDED')
  OR ("invoiceNumber" IS NOT NULL AND "journalId" IS NOT NULL AND "postedAt" IS NOT NULL)
);
