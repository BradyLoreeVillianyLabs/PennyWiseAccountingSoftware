DO $$
BEGIN
  IF to_regclass('public."Vendor"') IS NOT NULL THEN
    ALTER TABLE "Vendor" DROP CONSTRAINT IF EXISTS "Vendor_defaultCurrency_format_check";
    ALTER TABLE "Vendor" DROP COLUMN IF EXISTS "defaultCurrency";
  END IF;
END $$;
