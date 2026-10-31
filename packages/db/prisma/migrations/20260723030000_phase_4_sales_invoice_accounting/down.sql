DO $rollback$
BEGIN
  IF to_regclass('public."CreditNoteLine"') IS NULL THEN
    RETURN;
  END IF;

  DROP TRIGGER IF EXISTS "Invoice_totals_invariant" ON "Invoice";
DROP TRIGGER IF EXISTS "CreditNote_posting_invariant" ON "CreditNote";
DROP TRIGGER IF EXISTS "CreditNoteLine_history_protection" ON "CreditNoteLine";
DROP TRIGGER IF EXISTS "InvoiceLine_history_protection" ON "InvoiceLine";
DROP TRIGGER IF EXISTS "CreditNote_history_protection" ON "CreditNote";
DROP TRIGGER IF EXISTS "Invoice_history_protection" ON "Invoice";
DROP TRIGGER IF EXISTS "CreditNoteLine_tenant_reference" ON "CreditNoteLine";
DROP TRIGGER IF EXISTS "CreditNote_tenant_reference" ON "CreditNote";
DROP TRIGGER IF EXISTS "InvoiceLine_tenant_reference" ON "InvoiceLine";
DROP TRIGGER IF EXISTS "Invoice_tenant_reference" ON "Invoice";
DROP TRIGGER IF EXISTS "ProductItem_tenant_reference" ON "ProductItem";
DROP TRIGGER IF EXISTS "Customer_tenant_reference" ON "Customer";
DROP FUNCTION IF EXISTS phase4_protect_line_history();
DROP FUNCTION IF EXISTS phase4_validate_invoice_totals();
DROP FUNCTION IF EXISTS phase4_validate_credit_note();
DROP FUNCTION IF EXISTS phase4_protect_credit_note_history();
DROP FUNCTION IF EXISTS phase4_protect_invoice_history();
DROP FUNCTION IF EXISTS phase4_verify_tenant_references();
DO $$ DECLARE table_name TEXT; BEGIN FOREACH table_name IN ARRAY ARRAY['Customer','ProductItem','Invoice','InvoiceLine','CreditNote','CreditNoteLine'] LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_policy', table_name);
END LOOP; END $$;
DROP TABLE "CreditNoteLine";
DROP TABLE "CreditNote";
DROP TABLE "InvoiceLine";
DROP TABLE "Invoice";
DROP TABLE "ProductItem";
DROP TABLE "Customer";
ALTER TABLE "BusinessDefaults" DROP COLUMN "creditNotePrefix", DROP COLUMN "creditNoteNextPlaceholder";
DROP TYPE "CreditNoteStatus";
DROP TYPE "InvoiceStatus";
  DROP TYPE "ProductItemType";
END;
$rollback$;
