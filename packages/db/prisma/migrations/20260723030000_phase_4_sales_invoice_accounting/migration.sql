CREATE TYPE "ProductItemType" AS ENUM ('SERVICE', 'NON_INVENTORY_PRODUCT', 'INVENTORY_PRODUCT', 'DISCOUNT', 'SHIPPING');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOIDED', 'PARTIALLY_CREDITED', 'CREDITED');
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

ALTER TABLE "BusinessDefaults"
  ADD COLUMN "creditNotePrefix" TEXT NOT NULL DEFAULT 'CN',
  ADD COLUMN "creditNoteNextPlaceholder" TEXT NOT NULL DEFAULT '0001';

CREATE TABLE "Customer" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "customerNumber" TEXT NOT NULL,
  "legalName" TEXT,
  "displayName" TEXT NOT NULL,
  "primaryContact" TEXT,
  "additionalContacts" JSONB,
  "billingAddress" JSONB,
  "serviceAddress" JSONB,
  "email" TEXT,
  "telephone" TEXT,
  "website" TEXT,
  "taxRegistrationIdentifiers" JSONB,
  "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 30,
  "defaultTaxCodeId" UUID,
  "defaultCurrency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "internalNotes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "archivedAt" TIMESTAMPTZ(6),
  "archivedByUserId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Customer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "Customer_defaultTaxCodeId_fkey" FOREIGN KEY ("defaultTaxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT,
  CONSTRAINT "Customer_terms_check" CHECK ("defaultPaymentTermsDays" BETWEEN 0 AND 365),
  CONSTRAINT "Customer_currency_check" CHECK ("defaultCurrency" = 'CAD'),
  CONSTRAINT "Customer_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "Customer_organizationId_customerNumber_key" ON "Customer" ("organizationId", "customerNumber");
CREATE INDEX "Customer_organizationId_active_displayName_idx" ON "Customer" ("organizationId", "active", "displayName");
CREATE INDEX "Customer_organizationId_defaultTaxCodeId_idx" ON "Customer" ("organizationId", "defaultTaxCodeId");

CREATE TABLE "ProductItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "sku" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "itemType" "ProductItemType" NOT NULL,
  "salesPriceMinor" BIGINT NOT NULL DEFAULT 0,
  "purchaseCostMinor" BIGINT,
  "incomeAccountId" UUID NOT NULL,
  "expenseAccountId" UUID,
  "inventoryAssetAccountId" UUID,
  "defaultTaxCodeId" UUID,
  "unitOfMeasure" TEXT,
  "productImageReference" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ProductItem_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "ProductItem_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "ProductItem_inventoryAssetAccountId_fkey" FOREIGN KEY ("inventoryAssetAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "ProductItem_defaultTaxCodeId_fkey" FOREIGN KEY ("defaultTaxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT,
  CONSTRAINT "ProductItem_price_check" CHECK ("salesPriceMinor" >= 0 AND ("purchaseCostMinor" IS NULL OR "purchaseCostMinor" >= 0)),
  CONSTRAINT "ProductItem_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "ProductItem_organizationId_sku_key" ON "ProductItem" ("organizationId", "sku");
CREATE INDEX "ProductItem_organizationId_active_name_idx" ON "ProductItem" ("organizationId", "active", "name");
CREATE INDEX "ProductItem_organizationId_incomeAccountId_idx" ON "ProductItem" ("organizationId", "incomeAccountId");
CREATE INDEX "ProductItem_organizationId_defaultTaxCodeId_idx" ON "ProductItem" ("organizationId", "defaultTaxCodeId");

CREATE TABLE "Invoice" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "invoiceNumber" TEXT,
  "provisionalIdentifier" TEXT NOT NULL,
  "issueDate" DATE NOT NULL,
  "dueDate" DATE NOT NULL,
  "paymentTermsDays" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
  "discountTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "grandTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "amountPaidMinor" BIGINT NOT NULL DEFAULT 0,
  "journalId" UUID,
  "postedAt" TIMESTAMPTZ(6),
  "postedByUserId" UUID,
  "approvedAt" TIMESTAMPTZ(6),
  "approvedByUserId" UUID,
  "voidedAt" TIMESTAMPTZ(6),
  "voidedByUserId" UUID,
  "voidReason" TEXT,
  "customerNameSnapshot" TEXT NOT NULL,
  "customerEmailSnapshot" TEXT,
  "billingAddressSnapshot" JSONB,
  "serviceAddressSnapshot" JSONB,
  "organizationSnapshot" JSONB NOT NULL,
  "customerFacingNotes" TEXT,
  "internalNotes" TEXT,
  "terms" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Invoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT,
  CONSTRAINT "Invoice_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  CONSTRAINT "Invoice_terms_check" CHECK ("paymentTermsDays" BETWEEN 0 AND 365),
  CONSTRAINT "Invoice_dates_check" CHECK ("dueDate" >= "issueDate"),
  CONSTRAINT "Invoice_currency_check" CHECK ("currency" = 'CAD'),
  CONSTRAINT "Invoice_amount_paid_check" CHECK ("amountPaidMinor" = 0),
  CONSTRAINT "Invoice_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "Invoice_provisionalIdentifier_key" ON "Invoice" ("provisionalIdentifier");
CREATE UNIQUE INDEX "Invoice_organizationId_invoiceNumber_key" ON "Invoice" ("organizationId", "invoiceNumber");
CREATE INDEX "Invoice_organizationId_status_dueDate_idx" ON "Invoice" ("organizationId", "status", "dueDate");
CREATE INDEX "Invoice_organizationId_customerId_status_idx" ON "Invoice" ("organizationId", "customerId", "status");

CREATE TABLE "InvoiceLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "productItemId" UUID,
  "description" TEXT NOT NULL,
  "quantityMicros" BIGINT NOT NULL,
  "unitPriceMinor" BIGINT NOT NULL,
  "grossAmountMinor" BIGINT NOT NULL,
  "discountMinor" BIGINT NOT NULL DEFAULT 0,
  "netAmountMinor" BIGINT NOT NULL,
  "taxableAmountMinor" BIGINT NOT NULL,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "totalMinor" BIGINT NOT NULL,
  "taxCodeId" UUID,
  "taxCodeVersionId" UUID,
  "taxSnapshot" JSONB,
  "incomeAccountId" UUID NOT NULL,
  "incomeAccountCode" TEXT NOT NULL,
  "incomeAccountName" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT,
  CONSTRAINT "InvoiceLine_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT,
  CONSTRAINT "InvoiceLine_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT,
  CONSTRAINT "InvoiceLine_taxCodeVersionId_fkey" FOREIGN KEY ("taxCodeVersionId") REFERENCES "TaxCodeVersion"("id") ON DELETE RESTRICT,
  CONSTRAINT "InvoiceLine_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "InvoiceLine_quantity_check" CHECK ("quantityMicros" > 0),
  CONSTRAINT "InvoiceLine_price_check" CHECK ("unitPriceMinor" >= 0 AND "discountMinor" >= 0),
  CONSTRAINT "InvoiceLine_versionless_history_check" CHECK ("lineNumber" > 0)
);
CREATE UNIQUE INDEX "InvoiceLine_invoiceId_lineNumber_key" ON "InvoiceLine" ("invoiceId", "lineNumber");
CREATE INDEX "InvoiceLine_organizationId_invoiceId_idx" ON "InvoiceLine" ("organizationId", "invoiceId");
CREATE INDEX "InvoiceLine_organizationId_productItemId_idx" ON "InvoiceLine" ("organizationId", "productItemId");

CREATE TABLE "CreditNote" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "creditNoteNumber" TEXT,
  "provisionalIdentifier" TEXT NOT NULL,
  "issueDate" DATE NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "grandTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "journalId" UUID,
  "postedAt" TIMESTAMPTZ(6),
  "postedByUserId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT,
  CONSTRAINT "CreditNote_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  CONSTRAINT "CreditNote_dates_check" CHECK ("currency" = 'CAD'),
  CONSTRAINT "CreditNote_amounts_check" CHECK ("subtotalMinor" >= 0 AND "taxTotalMinor" >= 0 AND "grandTotalMinor" > 0),
  CONSTRAINT "CreditNote_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "CreditNote_provisionalIdentifier_key" ON "CreditNote" ("provisionalIdentifier");
CREATE UNIQUE INDEX "CreditNote_organizationId_creditNoteNumber_key" ON "CreditNote" ("organizationId", "creditNoteNumber");
CREATE INDEX "CreditNote_organizationId_invoiceId_status_idx" ON "CreditNote" ("organizationId", "invoiceId", "status");

CREATE TABLE "CreditNoteLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "creditNoteId" UUID NOT NULL,
  "invoiceLineId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantityMicros" BIGINT NOT NULL,
  "netAmountMinor" BIGINT NOT NULL,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "totalMinor" BIGINT NOT NULL,
  "taxSnapshot" JSONB,
  "incomeAccountId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CreditNoteLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditNoteLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "CreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT,
  CONSTRAINT "CreditNoteLine_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE RESTRICT,
  CONSTRAINT "CreditNoteLine_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "CreditNoteLine_quantity_check" CHECK ("quantityMicros" > 0),
  CONSTRAINT "CreditNoteLine_amounts_check" CHECK ("netAmountMinor" >= 0 AND "taxTotalMinor" >= 0 AND "totalMinor" > 0),
  CONSTRAINT "CreditNoteLine_line_check" CHECK ("lineNumber" > 0)
);
CREATE UNIQUE INDEX "CreditNoteLine_creditNoteId_lineNumber_key" ON "CreditNoteLine" ("creditNoteId", "lineNumber");
CREATE INDEX "CreditNoteLine_organizationId_invoiceLineId_idx" ON "CreditNoteLine" ("organizationId", "invoiceLineId");

CREATE OR REPLACE FUNCTION phase4_verify_tenant_references() RETURNS TRIGGER AS $$
DECLARE parent_org UUID; referenced_org UUID; parent_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Customer' THEN
    IF NEW."defaultTaxCodeId" IS NOT NULL THEN
      SELECT "organizationId" INTO referenced_org FROM "TaxCode" WHERE "id" = NEW."defaultTaxCodeId";
      IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Customer tax code must belong to organization'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'ProductItem' THEN
    SELECT "organizationId" INTO referenced_org FROM "Account" WHERE "id" = NEW."incomeAccountId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Product income account must belong to organization'; END IF;
    FOREACH referenced_org IN ARRAY ARRAY[NEW."expenseAccountId", NEW."inventoryAssetAccountId", NEW."defaultTaxCodeId"] LOOP
      IF referenced_org IS NOT NULL THEN
        IF TG_TABLE_NAME = 'ProductItem' AND referenced_org NOT IN (SELECT "id" FROM "Account" WHERE "organizationId" = NEW."organizationId")
           AND referenced_org NOT IN (SELECT "id" FROM "TaxCode" WHERE "organizationId" = NEW."organizationId") THEN
          RAISE EXCEPTION 'Product reference must belong to organization';
        END IF;
      END IF;
    END LOOP;
  ELSIF TG_TABLE_NAME = 'Invoice' THEN
    SELECT "organizationId" INTO referenced_org FROM "Customer" WHERE "id" = NEW."customerId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Invoice customer must belong to organization'; END IF;
    IF NEW."journalId" IS NOT NULL THEN
      SELECT "organizationId" INTO referenced_org FROM "Journal" WHERE "id" = NEW."journalId";
      IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Invoice journal must belong to organization'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'InvoiceLine' THEN
    SELECT "organizationId", "status" INTO parent_org, parent_status FROM "Invoice" WHERE "id" = NEW."invoiceId";
    IF parent_org IS NULL OR parent_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Invoice line invoice must belong to organization'; END IF;
    IF parent_status NOT IN ('DRAFT', 'APPROVED') THEN RAISE EXCEPTION 'Posted invoice lines are immutable'; END IF;
    SELECT "organizationId" INTO referenced_org FROM "Account" WHERE "id" = NEW."incomeAccountId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Invoice income account must belong to organization'; END IF;
  ELSIF TG_TABLE_NAME = 'CreditNote' THEN
    SELECT "organizationId" INTO referenced_org FROM "Invoice" WHERE "id" = NEW."invoiceId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Credit note invoice must belong to organization'; END IF;
  ELSIF TG_TABLE_NAME = 'CreditNoteLine' THEN
    SELECT "organizationId", "status" INTO parent_org, parent_status FROM "CreditNote" WHERE "id" = NEW."creditNoteId";
    IF parent_org IS NULL OR parent_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Credit note line parent must belong to organization'; END IF;
    IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Posted credit note lines are immutable'; END IF;
    SELECT "organizationId" INTO referenced_org FROM "InvoiceLine" WHERE "id" = NEW."invoiceLineId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Credit note source line must belong to organization'; END IF;
    SELECT "organizationId" INTO referenced_org FROM "Account" WHERE "id" = NEW."incomeAccountId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Credit note account must belong to organization'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "Customer_tenant_reference" BEFORE INSERT OR UPDATE ON "Customer" FOR EACH ROW EXECUTE FUNCTION phase4_verify_tenant_references();
CREATE TRIGGER "ProductItem_tenant_reference" BEFORE INSERT OR UPDATE ON "ProductItem" FOR EACH ROW EXECUTE FUNCTION phase4_verify_tenant_references();
CREATE TRIGGER "Invoice_tenant_reference" BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION phase4_verify_tenant_references();
CREATE TRIGGER "InvoiceLine_tenant_reference" BEFORE INSERT OR UPDATE ON "InvoiceLine" FOR EACH ROW EXECUTE FUNCTION phase4_verify_tenant_references();
CREATE TRIGGER "CreditNote_tenant_reference" BEFORE INSERT OR UPDATE ON "CreditNote" FOR EACH ROW EXECUTE FUNCTION phase4_verify_tenant_references();
CREATE TRIGGER "CreditNoteLine_tenant_reference" BEFORE INSERT OR UPDATE ON "CreditNoteLine" FOR EACH ROW EXECUTE FUNCTION phase4_verify_tenant_references();

CREATE OR REPLACE FUNCTION phase4_protect_invoice_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" NOT IN ('DRAFT', 'APPROVED') THEN RAISE EXCEPTION 'Posted invoices are immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" NOT IN ('DRAFT', 'APPROVED') THEN
    IF NEW."customerId" IS DISTINCT FROM OLD."customerId" OR NEW."invoiceNumber" IS DISTINCT FROM OLD."invoiceNumber"
      OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate" OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
      OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."subtotalMinor" IS DISTINCT FROM OLD."subtotalMinor"
      OR NEW."discountTotalMinor" IS DISTINCT FROM OLD."discountTotalMinor" OR NEW."taxTotalMinor" IS DISTINCT FROM OLD."taxTotalMinor"
      OR NEW."grandTotalMinor" IS DISTINCT FROM OLD."grandTotalMinor" OR NEW."journalId" IS DISTINCT FROM OLD."journalId"
      OR NEW."customerNameSnapshot" IS DISTINCT FROM OLD."customerNameSnapshot" OR NEW."customerEmailSnapshot" IS DISTINCT FROM OLD."customerEmailSnapshot"
      OR NEW."billingAddressSnapshot" IS DISTINCT FROM OLD."billingAddressSnapshot" OR NEW."serviceAddressSnapshot" IS DISTINCT FROM OLD."serviceAddressSnapshot"
      OR NEW."organizationSnapshot" IS DISTINCT FROM OLD."organizationSnapshot" OR NEW."internalNotes" IS DISTINCT FROM OLD."internalNotes"
      OR NEW."customerFacingNotes" IS DISTINCT FROM OLD."customerFacingNotes" OR NEW."terms" IS DISTINCT FROM OLD."terms"
      OR NEW."amountPaidMinor" IS DISTINCT FROM OLD."amountPaidMinor" THEN
      RAISE EXCEPTION 'Posted invoice financial history is immutable';
    END IF;
    IF OLD."status" = 'POSTED' AND NEW."status" = 'VOIDED' AND NOT EXISTS (
      SELECT 1 FROM "Journal" WHERE "organizationId" = OLD."organizationId" AND "reversedJournalId" = OLD."journalId" AND "status" = 'POSTED'
    ) THEN RAISE EXCEPTION 'Voiding requires a posted reversal'; END IF;
    IF OLD."status" = 'POSTED' AND NEW."status" IN ('PARTIALLY_CREDITED','CREDITED') AND NOT EXISTS (
      SELECT 1 FROM "CreditNote" WHERE "organizationId" = OLD."organizationId" AND "invoiceId" = OLD."id" AND "status" = 'POSTED'
    ) THEN RAISE EXCEPTION 'Credit status requires a posted credit note'; END IF;
    IF NEW."status" NOT IN ('VOIDED','PARTIALLY_CREDITED','CREDITED','OVERDUE','PARTIALLY_PAID','PAID') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'Posted invoice status transition is not permitted';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Invoice_history_protection" BEFORE UPDATE OR DELETE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION phase4_protect_invoice_history();

CREATE OR REPLACE FUNCTION phase4_protect_credit_note_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Posted credit notes are immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Posted credit notes are immutable'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "CreditNote_history_protection" BEFORE UPDATE OR DELETE ON "CreditNote" FOR EACH ROW EXECUTE FUNCTION phase4_protect_credit_note_history();
CREATE OR REPLACE FUNCTION phase4_protect_line_history() RETURNS TRIGGER AS $$
DECLARE parent_status TEXT;
BEGIN
  IF TG_TABLE_NAME = 'InvoiceLine' THEN
    SELECT "status" INTO parent_status FROM "Invoice" WHERE "id" = OLD."invoiceId";
  ELSE
    SELECT "status" INTO parent_status FROM "CreditNote" WHERE "id" = OLD."creditNoteId";
  END IF;
  IF parent_status NOT IN ('DRAFT', 'APPROVED') THEN RAISE EXCEPTION 'Posted document lines are immutable'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "InvoiceLine_history_protection" BEFORE UPDATE OR DELETE ON "InvoiceLine" FOR EACH ROW EXECUTE FUNCTION phase4_protect_line_history();
CREATE TRIGGER "CreditNoteLine_history_protection" BEFORE UPDATE OR DELETE ON "CreditNoteLine" FOR EACH ROW EXECUTE FUNCTION phase4_protect_line_history();

CREATE OR REPLACE FUNCTION phase4_validate_credit_note() RETURNS TRIGGER AS $$
DECLARE line_subtotal BIGINT; line_tax BIGINT; line_total BIGINT;
BEGIN
  IF NEW."status" = 'POSTED' THEN
    SELECT COALESCE(SUM("netAmountMinor"),0), COALESCE(SUM("taxTotalMinor"),0), COALESCE(SUM("totalMinor"),0)
      INTO line_subtotal, line_tax, line_total FROM "CreditNoteLine" WHERE "creditNoteId" = NEW."id";
    IF NEW."grandTotalMinor" <= 0 OR NEW."subtotalMinor" <> line_subtotal OR NEW."taxTotalMinor" <> line_tax OR NEW."grandTotalMinor" <> line_total
      OR NEW."journalId" IS NULL OR NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL THEN
      RAISE EXCEPTION 'Posted credit note totals, lines, and journal must agree';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "Invoice" WHERE "id" = NEW."invoiceId" AND "organizationId" = NEW."organizationId" AND "status" IN ('POSTED','PARTIALLY_CREDITED')) THEN
      RAISE EXCEPTION 'Credit note source invoice must be posted and open';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "CreditNote_posting_invariant" BEFORE INSERT OR UPDATE ON "CreditNote" FOR EACH ROW EXECUTE FUNCTION phase4_validate_credit_note();

CREATE OR REPLACE FUNCTION phase4_validate_invoice_totals() RETURNS TRIGGER AS $$
DECLARE line_subtotal BIGINT; line_discount BIGINT; line_tax BIGINT; line_total BIGINT;
BEGIN
  IF NEW."status" IN ('POSTED','PARTIALLY_CREDITED','CREDITED','VOIDED') THEN
    SELECT COALESCE(SUM("grossAmountMinor"),0), COALESCE(SUM("discountMinor"),0), COALESCE(SUM("taxTotalMinor"),0), COALESCE(SUM("totalMinor"),0)
      INTO line_subtotal, line_discount, line_tax, line_total FROM "InvoiceLine" WHERE "invoiceId" = NEW."id";
    IF NEW."subtotalMinor" <> line_subtotal OR NEW."discountTotalMinor" <> line_discount OR NEW."taxTotalMinor" <> line_tax OR NEW."grandTotalMinor" <> line_total
      OR NEW."grandTotalMinor" <> NEW."subtotalMinor" - NEW."discountTotalMinor" + NEW."taxTotalMinor" THEN
      RAISE EXCEPTION 'Invoice totals do not match immutable line totals';
    END IF;
    IF NEW."journalId" IS NULL OR NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL THEN RAISE EXCEPTION 'Posted invoice requires a journal and poster'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Invoice_totals_invariant" BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW EXECUTE FUNCTION phase4_validate_invoice_totals();

GRANT SELECT, INSERT, UPDATE, DELETE ON "Customer", "ProductItem", "Invoice", "InvoiceLine", "CreditNote", "CreditNoteLine" TO clearledger_runtime;
DO $$ DECLARE table_name TEXT; BEGIN FOREACH table_name IN ARRAY ARRAY['Customer','ProductItem','Invoice','InvoiceLine','CreditNote','CreditNoteLine'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())', table_name || '_tenant_policy', table_name);
END LOOP; END $$;
