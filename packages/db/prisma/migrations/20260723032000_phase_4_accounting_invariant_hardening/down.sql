DO $rollback$
BEGIN
  IF to_regclass('public."CreditNoteLine"') IS NOT NULL THEN
    ALTER TABLE "CreditNoteLine"
      DROP CONSTRAINT IF EXISTS "CreditNoteLine_total_check";
    ALTER TABLE "InvoiceLine"
      DROP CONSTRAINT IF EXISTS "InvoiceLine_taxable_check",
      DROP CONSTRAINT IF EXISTS "InvoiceLine_total_check";
  END IF;
END;
$rollback$;
