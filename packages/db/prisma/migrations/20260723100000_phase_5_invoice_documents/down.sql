DO $rollback$
BEGIN
  IF to_regclass('public."PublicInvoiceLink"') IS NULL THEN
    RETURN;
  END IF;

  DROP POLICY IF EXISTS "AuditEvent_public_invoice_policy" ON "AuditEvent";
DROP POLICY IF EXISTS "InvoicePdfArtifact_public_policy" ON "InvoicePdfArtifact";
DROP POLICY IF EXISTS "InvoiceAttachment_public_policy" ON "InvoiceAttachment";
DROP POLICY IF EXISTS "InvoiceLine_public_policy" ON "InvoiceLine";
DROP POLICY IF EXISTS "Invoice_public_policy" ON "Invoice";
DROP POLICY IF EXISTS "PublicInvoiceLink_tenant_policy" ON "PublicInvoiceLink";

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['InvoiceTemplateConfig','InvoicePdfArtifact','InvoiceDelivery','InvoiceDeliveryEvent'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_policy', table_name);
    EXECUTE format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;
ALTER TABLE "PublicInvoiceLink" DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS "Invoice_render_data_protection" ON "Invoice";
DROP TRIGGER IF EXISTS "InvoicePdfArtifact_append_only_update" ON "InvoicePdfArtifact";
DROP TRIGGER IF EXISTS "InvoiceDeliveryEvent_append_only_update" ON "InvoiceDeliveryEvent";
DROP TRIGGER IF EXISTS "InvoiceAttachment_issued_protection" ON "InvoiceAttachment";
DROP FUNCTION IF EXISTS phase5_protect_issued_render_data();
DROP FUNCTION IF EXISTS phase5_append_only_document_record();
DROP FUNCTION IF EXISTS phase5_protect_issued_attachment();
DROP FUNCTION IF EXISTS phase5_public_invoice_access(UUID, UUID);

DROP TABLE "PublicInvoiceLink";
DROP TABLE "InvoiceAttachment";
DROP TABLE "InvoiceDeliveryEvent";
DROP TABLE "InvoiceDelivery";
DROP TABLE "InvoicePdfArtifact";
DROP TABLE "InvoiceTemplateConfig";
ALTER TABLE "Invoice"
  DROP COLUMN "renderDataHash",
  DROP COLUMN "renderData",
  DROP COLUMN "templateVersion",
  DROP COLUMN "templateKey";
ALTER TABLE "Invoice" DROP CONSTRAINT IF EXISTS "Invoice_organizationId_id_key";
DROP TYPE "InvoiceAttachmentScanStatus";
  DROP TYPE "InvoiceDeliveryStatus";
END;
$rollback$;
