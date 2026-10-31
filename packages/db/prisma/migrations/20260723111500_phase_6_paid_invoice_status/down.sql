DO $rollback$
BEGIN
  IF to_regclass('public."Invoice"') IS NOT NULL THEN
    ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_posted_totals_immutable";

    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_posted_totals_immutable" CHECK (
  "status" NOT IN ('POSTED', 'PARTIALLY_CREDITED', 'CREDITED', 'VOIDED')
  OR ("invoiceNumber" IS NOT NULL AND "journalId" IS NOT NULL AND "postedAt" IS NOT NULL)
);
  END IF;
END;
$rollback$;
