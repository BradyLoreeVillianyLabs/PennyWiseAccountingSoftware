ALTER TABLE "Vendor"
  ADD COLUMN "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'CAD';

ALTER TABLE "Vendor"
  ADD CONSTRAINT "Vendor_defaultCurrency_format_check"
  CHECK ("defaultCurrency" ~ '^[A-Z]{3}$');
