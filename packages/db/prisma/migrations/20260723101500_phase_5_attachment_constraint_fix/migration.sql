ALTER TABLE "InvoiceAttachment" DROP CONSTRAINT IF EXISTS "InvoiceAttachment_file_name_check";
ALTER TABLE "InvoiceAttachment"
  ADD CONSTRAINT "InvoiceAttachment_file_name_check"
  CHECK (length("fileName") BETWEEN 1 AND 255 AND "fileName" !~ E'[\r\n/\\"]');
