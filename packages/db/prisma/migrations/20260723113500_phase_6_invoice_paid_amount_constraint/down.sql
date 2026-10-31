DO $rollback$
BEGIN
  IF to_regclass('public."Invoice"') IS NOT NULL THEN
    ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_amount_paid_check";
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amount_paid_check" CHECK ("amountPaidMinor" = 0);
  END IF;
END;
$rollback$;
