CREATE TYPE "BillStatus" AS ENUM (
  'DRAFT', 'APPROVED', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE',
  'VOIDED', 'PARTIALLY_CREDITED', 'CREDITED'
);
CREATE TYPE "PurchasePaymentMethod" AS ENUM (
  'CASH', 'CHEQUE', 'ELECTRONIC_TRANSFER', 'CREDIT_CARD', 'OWNER_PAID', 'OTHER'
);
CREATE TYPE "VendorCreditStatus" AS ENUM ('DRAFT', 'POSTED', 'APPLIED', 'VOIDED');
CREATE TYPE "PurchaseAttachmentScanStatus" AS ENUM ('PENDING', 'CLEAN', 'REJECTED');

CREATE TABLE "Vendor" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorNumber" TEXT NOT NULL,
  "legalName" TEXT NOT NULL, "displayName" TEXT NOT NULL, "primaryContact" JSONB,
  "additionalContacts" JSONB, "remittanceAddress" JSONB, "serviceAddress" JSONB,
  "email" TEXT, "telephone" TEXT, "website" TEXT, "businessIdentifier" TEXT,
  "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 30, "defaultExpenseAccountId" UUID,
  "defaultTaxCodeId" UUID, "preferredPaymentMethod" "PurchasePaymentMethod",
  "internalNotes" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true, "archivedAt" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1, "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Vendor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "Vendor_defaultExpenseAccountId_fkey" FOREIGN KEY ("defaultExpenseAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "Vendor_defaultTaxCodeId_fkey" FOREIGN KEY ("defaultTaxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT,
  CONSTRAINT "Vendor_terms_check" CHECK ("defaultPaymentTermsDays" >= 0 AND "defaultPaymentTermsDays" <= 3650),
  CONSTRAINT "Vendor_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "Vendor_organizationId_vendorNumber_key" ON "Vendor"("organizationId", "vendorNumber");
CREATE UNIQUE INDEX "Vendor_organizationId_id_key" ON "Vendor"("organizationId", "id");
CREATE INDEX "Vendor_organizationId_displayName_idx" ON "Vendor"("organizationId", "displayName");
CREATE INDEX "Vendor_organizationId_isActive_idx" ON "Vendor"("organizationId", "isActive");

CREATE TABLE "Bill" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorId" UUID NOT NULL,
  "vendorInvoiceNumber" TEXT NOT NULL, "issueDate" DATE NOT NULL, "dueDate" DATE NOT NULL,
  "paymentTermsDays" INTEGER NOT NULL, "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "status" "BillStatus" NOT NULL DEFAULT 'DRAFT', "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
  "discountTotalMinor" BIGINT NOT NULL DEFAULT 0, "recoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  "nonRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0, "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "grandTotalMinor" BIGINT NOT NULL DEFAULT 0, "amountPaidMinor" BIGINT NOT NULL DEFAULT 0,
  "creditedMinor" BIGINT NOT NULL DEFAULT 0, "internalNotes" TEXT, "vendorNameSnapshot" TEXT,
  "remittanceSnapshot" JSONB, "journalId" UUID, "postedAt" TIMESTAMPTZ(6),
  "postedByUserId" UUID, "approvedAt" TIMESTAMPTZ(6), "approvedByUserId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1, "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Bill_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Bill_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "Bill_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT,
  CONSTRAINT "Bill_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  CONSTRAINT "Bill_dates_check" CHECK ("dueDate" >= "issueDate"),
  CONSTRAINT "Bill_currency_check" CHECK ("currency" = 'CAD'),
  CONSTRAINT "Bill_amounts_check" CHECK (
    "subtotalMinor" >= 0 AND "discountTotalMinor" >= 0 AND
    "recoverableTaxMinor" >= 0 AND "nonRecoverableTaxMinor" >= 0 AND "taxTotalMinor" >= 0 AND
    "grandTotalMinor" >= 0 AND "amountPaidMinor" >= 0 AND "creditedMinor" >= 0 AND
    "amountPaidMinor" + "creditedMinor" <= "grandTotalMinor"
  ),
  CONSTRAINT "Bill_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "Bill_journalId_key" ON "Bill"("journalId");
CREATE UNIQUE INDEX "Bill_organizationId_vendorId_vendorInvoiceNumber_key" ON "Bill"("organizationId", "vendorId", "vendorInvoiceNumber");
CREATE UNIQUE INDEX "Bill_organizationId_id_key" ON "Bill"("organizationId", "id");
CREATE INDEX "Bill_organizationId_status_dueDate_idx" ON "Bill"("organizationId", "status", "dueDate");
CREATE INDEX "Bill_organizationId_vendorId_status_idx" ON "Bill"("organizationId", "vendorId", "status");

CREATE TABLE "BillLine" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "billId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL, "description" TEXT NOT NULL, "quantityMicros" BIGINT NOT NULL,
  "unitCostMinor" BIGINT NOT NULL, "grossAmountMinor" BIGINT NOT NULL,
  "discountMinor" BIGINT NOT NULL DEFAULT 0, "netAmountMinor" BIGINT NOT NULL,
  "recoverableTaxMinor" BIGINT NOT NULL DEFAULT 0, "nonRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0, "totalMinor" BIGINT NOT NULL,
  "accountId" UUID NOT NULL, "accountCode" TEXT NOT NULL, "accountName" TEXT NOT NULL,
  "taxCodeId" UUID, "taxCodeVersionId" UUID, "taxSnapshot" JSONB,
  "inventoryPlaceholder" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "BillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillLine_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillLine_taxCodeVersionId_fkey" FOREIGN KEY ("taxCodeVersionId") REFERENCES "TaxCodeVersion"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillLine_line_check" CHECK ("lineNumber" > 0 AND "quantityMicros" > 0),
  CONSTRAINT "BillLine_amounts_check" CHECK (
    "unitCostMinor" >= 0 AND "grossAmountMinor" >= 0 AND "discountMinor" >= 0 AND
    "discountMinor" <= "grossAmountMinor" AND "netAmountMinor" >= 0 AND
    "recoverableTaxMinor" >= 0 AND "nonRecoverableTaxMinor" >= 0 AND
    "taxTotalMinor" = "recoverableTaxMinor" + "nonRecoverableTaxMinor" AND "totalMinor" > 0
  )
);
CREATE UNIQUE INDEX "BillLine_billId_lineNumber_key" ON "BillLine"("billId", "lineNumber");
CREATE INDEX "BillLine_organizationId_billId_idx" ON "BillLine"("organizationId", "billId");
CREATE INDEX "BillLine_organizationId_accountId_idx" ON "BillLine"("organizationId", "accountId");

CREATE TABLE "BillPayment" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorId" UUID NOT NULL,
  "paymentDate" DATE NOT NULL, "amountMinor" BIGINT NOT NULL, "unappliedMinor" BIGINT NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL DEFAULT 'CAD', "method" "PurchasePaymentMethod" NOT NULL,
  "payingAccountId" UUID NOT NULL, "reference" TEXT, "journalId" UUID NOT NULL,
  "reversedJournalId" UUID, "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillPayment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "BillPayment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillPayment_payingAccountId_fkey" FOREIGN KEY ("payingAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillPayment_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillPayment_reversedJournalId_fkey" FOREIGN KEY ("reversedJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillPayment_amount_check" CHECK ("amountMinor" > 0 AND "unappliedMinor" >= 0 AND "unappliedMinor" <= "amountMinor"),
  CONSTRAINT "BillPayment_currency_check" CHECK ("currency" = 'CAD'),
  CONSTRAINT "BillPayment_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "BillPayment_journalId_key" ON "BillPayment"("journalId");
CREATE UNIQUE INDEX "BillPayment_reversedJournalId_key" ON "BillPayment"("reversedJournalId");
CREATE UNIQUE INDEX "BillPayment_organizationId_id_key" ON "BillPayment"("organizationId", "id");
CREATE INDEX "BillPayment_organizationId_vendorId_paymentDate_idx" ON "BillPayment"("organizationId", "vendorId", "paymentDate");
CREATE INDEX "BillPayment_organizationId_reference_idx" ON "BillPayment"("organizationId", "reference");

CREATE TABLE "BillPaymentAllocation" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "billPaymentId" UUID NOT NULL,
  "billId" UUID NOT NULL, "amountMinor" BIGINT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillPaymentAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillPaymentAllocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "BillPaymentAllocation_billPaymentId_fkey" FOREIGN KEY ("billPaymentId") REFERENCES "BillPayment"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillPaymentAllocation_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT,
  CONSTRAINT "BillPaymentAllocation_amount_check" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "BillPaymentAllocation_billPaymentId_billId_key" ON "BillPaymentAllocation"("billPaymentId", "billId");
CREATE INDEX "BillPaymentAllocation_organizationId_billId_idx" ON "BillPaymentAllocation"("organizationId", "billId");

CREATE TABLE "VendorCredit" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorId" UUID NOT NULL,
  "vendorCreditNumber" TEXT NOT NULL, "issueDate" DATE NOT NULL, "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "status" "VendorCreditStatus" NOT NULL DEFAULT 'DRAFT', "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
  "recoverableTaxMinor" BIGINT NOT NULL DEFAULT 0, "nonRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0, "grandTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "appliedMinor" BIGINT NOT NULL DEFAULT 0, "reason" TEXT NOT NULL, "journalId" UUID,
  "postedAt" TIMESTAMPTZ(6), "postedByUserId" UUID, "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL, "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VendorCredit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorCredit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "VendorCredit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT,
  CONSTRAINT "VendorCredit_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  CONSTRAINT "VendorCredit_amounts_check" CHECK (
    "subtotalMinor" >= 0 AND "recoverableTaxMinor" >= 0 AND "nonRecoverableTaxMinor" >= 0 AND
    "taxTotalMinor" = "recoverableTaxMinor" + "nonRecoverableTaxMinor" AND
    "grandTotalMinor" >= 0 AND "appliedMinor" >= 0 AND "appliedMinor" <= "grandTotalMinor"
  ),
  CONSTRAINT "VendorCredit_currency_check" CHECK ("currency" = 'CAD'),
  CONSTRAINT "VendorCredit_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "VendorCredit_journalId_key" ON "VendorCredit"("journalId");
CREATE UNIQUE INDEX "VendorCredit_organizationId_vendorId_vendorCreditNumber_key" ON "VendorCredit"("organizationId", "vendorId", "vendorCreditNumber");
CREATE UNIQUE INDEX "VendorCredit_organizationId_id_key" ON "VendorCredit"("organizationId", "id");
CREATE INDEX "VendorCredit_organizationId_vendorId_status_idx" ON "VendorCredit"("organizationId", "vendorId", "status");

CREATE TABLE "VendorCreditLine" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorCreditId" UUID NOT NULL,
  "billLineId" UUID, "lineNumber" INTEGER NOT NULL, "description" TEXT NOT NULL,
  "netAmountMinor" BIGINT NOT NULL, "recoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  "nonRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0, "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "totalMinor" BIGINT NOT NULL, "accountId" UUID NOT NULL, "taxSnapshot" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendorCreditLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorCreditLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "VendorCreditLine_vendorCreditId_fkey" FOREIGN KEY ("vendorCreditId") REFERENCES "VendorCredit"("id") ON DELETE RESTRICT,
  CONSTRAINT "VendorCreditLine_billLineId_fkey" FOREIGN KEY ("billLineId") REFERENCES "BillLine"("id") ON DELETE RESTRICT,
  CONSTRAINT "VendorCreditLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "VendorCreditLine_line_check" CHECK ("lineNumber" > 0),
  CONSTRAINT "VendorCreditLine_amounts_check" CHECK (
    "netAmountMinor" >= 0 AND "recoverableTaxMinor" >= 0 AND "nonRecoverableTaxMinor" >= 0 AND
    "taxTotalMinor" = "recoverableTaxMinor" + "nonRecoverableTaxMinor" AND "totalMinor" > 0
  )
);
CREATE UNIQUE INDEX "VendorCreditLine_vendorCreditId_lineNumber_key" ON "VendorCreditLine"("vendorCreditId", "lineNumber");
CREATE INDEX "VendorCreditLine_organizationId_billLineId_idx" ON "VendorCreditLine"("organizationId", "billLineId");

CREATE TABLE "VendorCreditApplication" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorCreditId" UUID NOT NULL,
  "billId" UUID NOT NULL, "amountMinor" BIGINT NOT NULL,
  "appliedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "appliedByUserId" UUID NOT NULL,
  CONSTRAINT "VendorCreditApplication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VendorCreditApplication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "VendorCreditApplication_vendorCreditId_fkey" FOREIGN KEY ("vendorCreditId") REFERENCES "VendorCredit"("id") ON DELETE RESTRICT,
  CONSTRAINT "VendorCreditApplication_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT,
  CONSTRAINT "VendorCreditApplication_amount_check" CHECK ("amountMinor" > 0)
);
CREATE UNIQUE INDEX "VendorCreditApplication_vendorCreditId_billId_key" ON "VendorCreditApplication"("vendorCreditId", "billId");
CREATE INDEX "VendorCreditApplication_organizationId_billId_idx" ON "VendorCreditApplication"("organizationId", "billId");

CREATE TABLE "ImmediateExpense" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "vendorId" UUID, "reference" TEXT,
  "expenseDate" DATE NOT NULL, "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "method" "PurchasePaymentMethod" NOT NULL, "payingAccountId" UUID NOT NULL,
  "subtotalMinor" BIGINT NOT NULL, "recoverableTaxMinor" BIGINT NOT NULL,
  "nonRecoverableTaxMinor" BIGINT NOT NULL, "taxTotalMinor" BIGINT NOT NULL,
  "grandTotalMinor" BIGINT NOT NULL, "journalId" UUID NOT NULL, "reversedJournalId" UUID,
  "internalNotes" TEXT, "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImmediateExpense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImmediateExpense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ImmediateExpense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpense_payingAccountId_fkey" FOREIGN KEY ("payingAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpense_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpense_reversedJournalId_fkey" FOREIGN KEY ("reversedJournalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpense_currency_check" CHECK ("currency" = 'CAD'),
  CONSTRAINT "ImmediateExpense_amounts_check" CHECK (
    "subtotalMinor" >= 0 AND "recoverableTaxMinor" >= 0 AND "nonRecoverableTaxMinor" >= 0 AND
    "taxTotalMinor" = "recoverableTaxMinor" + "nonRecoverableTaxMinor" AND "grandTotalMinor" > 0
  )
);
CREATE UNIQUE INDEX "ImmediateExpense_journalId_key" ON "ImmediateExpense"("journalId");
CREATE UNIQUE INDEX "ImmediateExpense_reversedJournalId_key" ON "ImmediateExpense"("reversedJournalId");
CREATE UNIQUE INDEX "ImmediateExpense_organizationId_id_key" ON "ImmediateExpense"("organizationId", "id");
CREATE INDEX "ImmediateExpense_organizationId_vendorId_expenseDate_idx" ON "ImmediateExpense"("organizationId", "vendorId", "expenseDate");
CREATE INDEX "ImmediateExpense_organizationId_reference_idx" ON "ImmediateExpense"("organizationId", "reference");

CREATE TABLE "ImmediateExpenseLine" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "immediateExpenseId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL, "description" TEXT NOT NULL, "quantityMicros" BIGINT NOT NULL,
  "unitCostMinor" BIGINT NOT NULL, "discountMinor" BIGINT NOT NULL DEFAULT 0,
  "netAmountMinor" BIGINT NOT NULL, "recoverableTaxMinor" BIGINT NOT NULL DEFAULT 0,
  "nonRecoverableTaxMinor" BIGINT NOT NULL DEFAULT 0, "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "totalMinor" BIGINT NOT NULL, "accountId" UUID NOT NULL, "taxCodeId" UUID,
  "taxCodeVersionId" UUID, "taxSnapshot" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ImmediateExpenseLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ImmediateExpenseLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "ImmediateExpenseLine_immediateExpenseId_fkey" FOREIGN KEY ("immediateExpenseId") REFERENCES "ImmediateExpense"("id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseLine_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseLine_taxCodeVersionId_fkey" FOREIGN KEY ("taxCodeVersionId") REFERENCES "TaxCodeVersion"("id") ON DELETE RESTRICT,
  CONSTRAINT "ImmediateExpenseLine_line_check" CHECK ("lineNumber" > 0 AND "quantityMicros" > 0),
  CONSTRAINT "ImmediateExpenseLine_amounts_check" CHECK (
    "unitCostMinor" >= 0 AND "discountMinor" >= 0 AND "netAmountMinor" >= 0 AND
    "recoverableTaxMinor" >= 0 AND "nonRecoverableTaxMinor" >= 0 AND
    "taxTotalMinor" = "recoverableTaxMinor" + "nonRecoverableTaxMinor" AND "totalMinor" > 0
  )
);
CREATE UNIQUE INDEX "ImmediateExpenseLine_immediateExpenseId_lineNumber_key" ON "ImmediateExpenseLine"("immediateExpenseId", "lineNumber");
CREATE INDEX "ImmediateExpenseLine_organizationId_immediateExpenseId_idx" ON "ImmediateExpenseLine"("organizationId", "immediateExpenseId");

CREATE TABLE "PurchaseAttachment" (
  "id" UUID NOT NULL, "organizationId" UUID NOT NULL, "billId" UUID,
  "vendorCreditId" UUID, "immediateExpenseId" UUID, "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL, "mediaType" TEXT NOT NULL, "byteSize" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL, "scanStatus" "PurchaseAttachmentScanStatus" NOT NULL,
  "createdByUserId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PurchaseAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "PurchaseAttachment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE RESTRICT,
  CONSTRAINT "PurchaseAttachment_vendorCreditId_fkey" FOREIGN KEY ("vendorCreditId") REFERENCES "VendorCredit"("id") ON DELETE RESTRICT,
  CONSTRAINT "PurchaseAttachment_immediateExpenseId_fkey" FOREIGN KEY ("immediateExpenseId") REFERENCES "ImmediateExpense"("id") ON DELETE RESTRICT,
  CONSTRAINT "PurchaseAttachment_parent_check" CHECK (
    num_nonnulls("billId", "vendorCreditId", "immediateExpenseId") = 1
  ),
  CONSTRAINT "PurchaseAttachment_size_check" CHECK ("byteSize" > 0 AND "byteSize" <= 10485760),
  CONSTRAINT "PurchaseAttachment_checksum_check" CHECK ("checksum" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "PurchaseAttachment_storageKey_key" ON "PurchaseAttachment"("storageKey");
CREATE INDEX "PurchaseAttachment_organizationId_billId_idx" ON "PurchaseAttachment"("organizationId", "billId");
CREATE INDEX "PurchaseAttachment_organizationId_vendorCreditId_idx" ON "PurchaseAttachment"("organizationId", "vendorCreditId");
CREATE INDEX "PurchaseAttachment_organizationId_immediateExpenseId_idx" ON "PurchaseAttachment"("organizationId", "immediateExpenseId");

CREATE OR REPLACE FUNCTION phase7_verify_tenant_references() RETURNS TRIGGER AS $$
DECLARE referenced_org UUID; parent_status TEXT; parent_vendor UUID;
BEGIN
  IF TG_TABLE_NAME = 'Vendor' THEN
    IF NEW."defaultExpenseAccountId" IS NOT NULL THEN
      SELECT "organizationId" INTO referenced_org FROM "Account" WHERE "id" = NEW."defaultExpenseAccountId";
      IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Vendor account must belong to organization'; END IF;
    END IF;
    IF NEW."defaultTaxCodeId" IS NOT NULL THEN
      SELECT "organizationId" INTO referenced_org FROM "TaxCode" WHERE "id" = NEW."defaultTaxCodeId";
      IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Vendor tax code must belong to organization'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME IN ('Bill','BillPayment','VendorCredit') THEN
    SELECT "organizationId" INTO referenced_org FROM "Vendor" WHERE "id" = NEW."vendorId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Vendor must belong to organization'; END IF;
    IF TG_TABLE_NAME = 'Bill' AND NEW."journalId" IS NOT NULL THEN
      SELECT "organizationId" INTO referenced_org FROM "Journal" WHERE "id" = NEW."journalId";
      IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Bill journal must belong to organization'; END IF;
    ELSIF TG_TABLE_NAME = 'BillPayment' THEN
      SELECT "organizationId" INTO referenced_org FROM "Account" WHERE "id" = NEW."payingAccountId";
      IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Payment account must belong to organization'; END IF;
      SELECT "organizationId" INTO referenced_org FROM "Journal" WHERE "id" = NEW."journalId";
      IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Payment journal must belong to organization'; END IF;
    ELSIF TG_TABLE_NAME = 'VendorCredit' AND NEW."journalId" IS NOT NULL THEN
      SELECT "organizationId" INTO referenced_org FROM "Journal" WHERE "id" = NEW."journalId";
      IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Vendor credit journal must belong to organization'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'BillLine' THEN
    SELECT "organizationId", "status" INTO referenced_org, parent_status FROM "Bill" WHERE "id" = NEW."billId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" OR parent_status NOT IN ('DRAFT','APPROVED') THEN
      RAISE EXCEPTION 'Bill line parent must be a mutable bill in the organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'BillPaymentAllocation' THEN
    SELECT "organizationId", "vendorId" INTO referenced_org, parent_vendor FROM "BillPayment" WHERE "id" = NEW."billPaymentId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Payment must belong to organization'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "Bill" WHERE "id" = NEW."billId" AND "organizationId" = NEW."organizationId"
      AND "vendorId" = parent_vendor AND "status" IN ('POSTED','PARTIALLY_PAID','OVERDUE','PARTIALLY_CREDITED')) THEN
      RAISE EXCEPTION 'Allocation bill must be an eligible bill for the same vendor';
    END IF;
  ELSIF TG_TABLE_NAME = 'VendorCreditLine' THEN
    SELECT "organizationId", "status" INTO referenced_org, parent_status FROM "VendorCredit" WHERE "id" = NEW."vendorCreditId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" OR parent_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Vendor credit line parent must be a draft in the organization';
    END IF;
  ELSIF TG_TABLE_NAME = 'VendorCreditApplication' THEN
    SELECT "organizationId", "vendorId" INTO referenced_org, parent_vendor FROM "VendorCredit" WHERE "id" = NEW."vendorCreditId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Vendor credit must belong to organization'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "Bill" WHERE "id" = NEW."billId" AND "organizationId" = NEW."organizationId"
      AND "vendorId" = parent_vendor AND "status" IN ('POSTED','PARTIALLY_PAID','OVERDUE','PARTIALLY_CREDITED')) THEN
      RAISE EXCEPTION 'Credit application bill must be eligible and belong to the same vendor';
    END IF;
  ELSIF TG_TABLE_NAME = 'ImmediateExpenseLine' THEN
    SELECT "organizationId" INTO referenced_org FROM "ImmediateExpense" WHERE "id" = NEW."immediateExpenseId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Expense line parent must belong to organization'; END IF;
  ELSIF TG_TABLE_NAME = 'ImmediateExpense' THEN
    IF NEW."vendorId" IS NOT NULL THEN
      SELECT "organizationId" INTO referenced_org FROM "Vendor" WHERE "id" = NEW."vendorId";
      IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Expense vendor must belong to organization'; END IF;
    END IF;
    SELECT "organizationId" INTO referenced_org FROM "Account" WHERE "id" = NEW."payingAccountId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Expense paying account must belong to organization'; END IF;
    SELECT "organizationId" INTO referenced_org FROM "Journal" WHERE "id" = NEW."journalId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Expense journal must belong to organization'; END IF;
  ELSIF TG_TABLE_NAME = 'PurchaseAttachment' THEN
    IF NEW."billId" IS NOT NULL THEN SELECT "organizationId" INTO referenced_org FROM "Bill" WHERE "id" = NEW."billId";
    ELSIF NEW."vendorCreditId" IS NOT NULL THEN SELECT "organizationId" INTO referenced_org FROM "VendorCredit" WHERE "id" = NEW."vendorCreditId";
    ELSE SELECT "organizationId" INTO referenced_org FROM "ImmediateExpense" WHERE "id" = NEW."immediateExpenseId"; END IF;
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Attachment parent must belong to organization'; END IF;
  END IF;
  IF TG_TABLE_NAME IN ('BillLine','VendorCreditLine','ImmediateExpenseLine') THEN
    SELECT "organizationId" INTO referenced_org FROM "Account" WHERE "id" = NEW."accountId";
    IF referenced_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Line account must belong to organization'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER "Vendor_tenant_reference" BEFORE INSERT OR UPDATE ON "Vendor" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "Bill_tenant_reference" BEFORE INSERT OR UPDATE ON "Bill" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "BillLine_tenant_reference" BEFORE INSERT OR UPDATE ON "BillLine" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "BillPayment_tenant_reference" BEFORE INSERT OR UPDATE ON "BillPayment" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "BillPaymentAllocation_tenant_reference" BEFORE INSERT OR UPDATE ON "BillPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "VendorCredit_tenant_reference" BEFORE INSERT OR UPDATE ON "VendorCredit" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "VendorCreditLine_tenant_reference" BEFORE INSERT OR UPDATE ON "VendorCreditLine" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "VendorCreditApplication_tenant_reference" BEFORE INSERT OR UPDATE ON "VendorCreditApplication" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "ImmediateExpense_tenant_reference" BEFORE INSERT OR UPDATE ON "ImmediateExpense" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "ImmediateExpenseLine_tenant_reference" BEFORE INSERT OR UPDATE ON "ImmediateExpenseLine" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();
CREATE TRIGGER "PurchaseAttachment_tenant_reference" BEFORE INSERT OR UPDATE ON "PurchaseAttachment" FOR EACH ROW EXECUTE FUNCTION phase7_verify_tenant_references();

CREATE OR REPLACE FUNCTION phase7_protect_history() RETURNS TRIGGER AS $$
DECLARE parent_status TEXT;
BEGIN
  IF TG_TABLE_NAME IN ('BillPaymentAllocation','VendorCreditApplication','ImmediateExpenseLine','PurchaseAttachment') THEN
    RAISE EXCEPTION 'Posted purchase history is append-only';
  ELSIF TG_TABLE_NAME = 'BillLine' THEN
    SELECT "status" INTO parent_status FROM "Bill" WHERE "id" = OLD."billId";
    IF parent_status NOT IN ('DRAFT','APPROVED') THEN RAISE EXCEPTION 'Posted bill lines are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'VendorCreditLine' THEN
    SELECT "status" INTO parent_status FROM "VendorCredit" WHERE "id" = OLD."vendorCreditId";
    IF parent_status <> 'DRAFT' THEN RAISE EXCEPTION 'Posted vendor credit lines are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'BillPayment' THEN
    IF TG_OP = 'DELETE' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."paymentDate" IS DISTINCT FROM OLD."paymentDate"
      OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."method" IS DISTINCT FROM OLD."method" OR NEW."payingAccountId" IS DISTINCT FROM OLD."payingAccountId"
      OR NEW."reference" IS DISTINCT FROM OLD."reference" OR NEW."journalId" IS DISTINCT FROM OLD."journalId"
      OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR (OLD."reversedJournalId" IS NOT NULL AND NEW."reversedJournalId" IS DISTINCT FROM OLD."reversedJournalId")
    THEN RAISE EXCEPTION 'Posted bill payments are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'ImmediateExpense' THEN
    IF TG_OP = 'DELETE' OR NEW."organizationId" IS DISTINCT FROM OLD."organizationId"
      OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId" OR NEW."reference" IS DISTINCT FROM OLD."reference"
      OR NEW."expenseDate" IS DISTINCT FROM OLD."expenseDate" OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."method" IS DISTINCT FROM OLD."method" OR NEW."payingAccountId" IS DISTINCT FROM OLD."payingAccountId"
      OR NEW."subtotalMinor" IS DISTINCT FROM OLD."subtotalMinor"
      OR NEW."recoverableTaxMinor" IS DISTINCT FROM OLD."recoverableTaxMinor"
      OR NEW."nonRecoverableTaxMinor" IS DISTINCT FROM OLD."nonRecoverableTaxMinor"
      OR NEW."taxTotalMinor" IS DISTINCT FROM OLD."taxTotalMinor"
      OR NEW."grandTotalMinor" IS DISTINCT FROM OLD."grandTotalMinor"
      OR NEW."journalId" IS DISTINCT FROM OLD."journalId"
      OR NEW."internalNotes" IS DISTINCT FROM OLD."internalNotes"
      OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
      OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR (OLD."reversedJournalId" IS NOT NULL AND NEW."reversedJournalId" IS DISTINCT FROM OLD."reversedJournalId")
    THEN RAISE EXCEPTION 'Posted immediate expenses are immutable'; END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "BillLine_history_protection" BEFORE UPDATE OR DELETE ON "BillLine" FOR EACH ROW EXECUTE FUNCTION phase7_protect_history();
CREATE TRIGGER "BillPayment_history_protection" BEFORE UPDATE OR DELETE ON "BillPayment" FOR EACH ROW EXECUTE FUNCTION phase7_protect_history();
CREATE TRIGGER "BillPaymentAllocation_history_protection" BEFORE UPDATE OR DELETE ON "BillPaymentAllocation" FOR EACH ROW EXECUTE FUNCTION phase7_protect_history();
CREATE TRIGGER "VendorCreditLine_history_protection" BEFORE UPDATE OR DELETE ON "VendorCreditLine" FOR EACH ROW EXECUTE FUNCTION phase7_protect_history();
CREATE TRIGGER "VendorCreditApplication_history_protection" BEFORE UPDATE OR DELETE ON "VendorCreditApplication" FOR EACH ROW EXECUTE FUNCTION phase7_protect_history();
CREATE TRIGGER "ImmediateExpense_history_protection" BEFORE UPDATE OR DELETE ON "ImmediateExpense" FOR EACH ROW EXECUTE FUNCTION phase7_protect_history();
CREATE TRIGGER "ImmediateExpenseLine_history_protection" BEFORE UPDATE OR DELETE ON "ImmediateExpenseLine" FOR EACH ROW EXECUTE FUNCTION phase7_protect_history();
CREATE TRIGGER "PurchaseAttachment_history_protection" BEFORE UPDATE OR DELETE ON "PurchaseAttachment" FOR EACH ROW EXECUTE FUNCTION phase7_protect_history();

CREATE OR REPLACE FUNCTION phase7_protect_documents() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."status"::text NOT IN ('DRAFT','APPROVED') THEN RAISE EXCEPTION 'Posted purchase documents are immutable'; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status"::text NOT IN ('DRAFT','APPROVED') THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
      OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate" OR NEW."currency" IS DISTINCT FROM OLD."currency"
      OR NEW."subtotalMinor" IS DISTINCT FROM OLD."subtotalMinor" OR NEW."recoverableTaxMinor" IS DISTINCT FROM OLD."recoverableTaxMinor"
      OR NEW."nonRecoverableTaxMinor" IS DISTINCT FROM OLD."nonRecoverableTaxMinor" OR NEW."taxTotalMinor" IS DISTINCT FROM OLD."taxTotalMinor"
      OR NEW."grandTotalMinor" IS DISTINCT FROM OLD."grandTotalMinor" OR NEW."journalId" IS DISTINCT FROM OLD."journalId"
      OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt" OR NEW."postedByUserId" IS DISTINCT FROM OLD."postedByUserId"
    THEN RAISE EXCEPTION 'Posted purchase document financial history is immutable'; END IF;
    IF TG_TABLE_NAME = 'Bill' THEN
      IF NEW."vendorInvoiceNumber" IS DISTINCT FROM OLD."vendorInvoiceNumber"
        OR NEW."dueDate" IS DISTINCT FROM OLD."dueDate"
        OR NEW."paymentTermsDays" IS DISTINCT FROM OLD."paymentTermsDays"
        OR NEW."internalNotes" IS DISTINCT FROM OLD."internalNotes"
        OR NEW."vendorNameSnapshot" IS DISTINCT FROM OLD."vendorNameSnapshot"
        OR NEW."remittanceSnapshot" IS DISTINCT FROM OLD."remittanceSnapshot"
      THEN RAISE EXCEPTION 'Posted bill identity and snapshots are immutable'; END IF;
    ELSE
      IF NEW."vendorCreditNumber" IS DISTINCT FROM OLD."vendorCreditNumber"
        OR NEW."reason" IS DISTINCT FROM OLD."reason"
      THEN RAISE EXCEPTION 'Posted vendor credit identity is immutable'; END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Bill_history_protection" BEFORE UPDATE OR DELETE ON "Bill" FOR EACH ROW EXECUTE FUNCTION phase7_protect_documents();
CREATE TRIGGER "VendorCredit_history_protection" BEFORE UPDATE OR DELETE ON "VendorCredit" FOR EACH ROW EXECUTE FUNCTION phase7_protect_documents();

CREATE OR REPLACE FUNCTION phase7_validate_bill_totals() RETURNS TRIGGER AS $$
DECLARE gross BIGINT; discounts BIGINT; recoverable BIGINT; nonrecoverable BIGINT; tax BIGINT; total BIGINT;
BEGIN
  IF NEW."status" NOT IN ('DRAFT','APPROVED') THEN
    SELECT COALESCE(SUM("grossAmountMinor"),0), COALESCE(SUM("discountMinor"),0),
      COALESCE(SUM("recoverableTaxMinor"),0), COALESCE(SUM("nonRecoverableTaxMinor"),0),
      COALESCE(SUM("taxTotalMinor"),0), COALESCE(SUM("totalMinor"),0)
      INTO gross, discounts, recoverable, nonrecoverable, tax, total FROM "BillLine" WHERE "billId" = NEW."id";
    IF NEW."subtotalMinor" <> gross OR NEW."discountTotalMinor" <> discounts
      OR NEW."recoverableTaxMinor" <> recoverable OR NEW."nonRecoverableTaxMinor" <> nonrecoverable
      OR NEW."taxTotalMinor" <> tax OR NEW."grandTotalMinor" <> total OR NEW."grandTotalMinor" <= 0
      OR NEW."journalId" IS NULL OR NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL
    THEN RAISE EXCEPTION 'Posted bill totals, lines, and journal must agree'; END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Bill_totals_invariant" BEFORE INSERT OR UPDATE ON "Bill" FOR EACH ROW EXECUTE FUNCTION phase7_validate_bill_totals();

CREATE OR REPLACE FUNCTION phase7_validate_payment_allocation() RETURNS TRIGGER AS $$
DECLARE payment_amount BIGINT; payment_org UUID; payment_vendor UUID;
  bill_org UUID; bill_vendor UUID; bill_total BIGINT; bill_credited BIGINT; allocated BIGINT;
BEGIN
  SELECT "amountMinor", "organizationId", "vendorId"
    INTO payment_amount, payment_org, payment_vendor
    FROM "BillPayment" WHERE "id" = NEW."billPaymentId" FOR UPDATE;
  SELECT "organizationId", "vendorId", "grandTotalMinor", "creditedMinor"
    INTO bill_org, bill_vendor, bill_total, bill_credited
    FROM "Bill" WHERE "id" = NEW."billId" FOR UPDATE;
  IF payment_org IS DISTINCT FROM NEW."organizationId" OR bill_org IS DISTINCT FROM NEW."organizationId"
    OR payment_vendor IS DISTINCT FROM bill_vendor
  THEN RAISE EXCEPTION 'Payment allocation references must share organization and vendor'; END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated
    FROM "BillPaymentAllocation" WHERE "billPaymentId" = NEW."billPaymentId";
  IF allocated + NEW."amountMinor" > payment_amount THEN
    RAISE EXCEPTION 'Payment allocations cannot exceed payment amount';
  END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated
    FROM "BillPaymentAllocation" WHERE "billId" = NEW."billId";
  IF allocated + NEW."amountMinor" > bill_total - bill_credited THEN
    RAISE EXCEPTION 'Payment allocations cannot exceed bill eligible balance';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "BillPaymentAllocation_limits"
BEFORE INSERT ON "BillPaymentAllocation"
FOR EACH ROW EXECUTE FUNCTION phase7_validate_payment_allocation();

CREATE OR REPLACE FUNCTION phase7_validate_credit_application() RETURNS TRIGGER AS $$
DECLARE credit_total BIGINT; credit_org UUID; credit_vendor UUID;
  bill_org UUID; bill_vendor UUID; bill_total BIGINT; bill_paid BIGINT; applied BIGINT;
BEGIN
  SELECT "grandTotalMinor", "organizationId", "vendorId"
    INTO credit_total, credit_org, credit_vendor
    FROM "VendorCredit" WHERE "id" = NEW."vendorCreditId" FOR UPDATE;
  SELECT "organizationId", "vendorId", "grandTotalMinor", "amountPaidMinor"
    INTO bill_org, bill_vendor, bill_total, bill_paid
    FROM "Bill" WHERE "id" = NEW."billId" FOR UPDATE;
  IF credit_org IS DISTINCT FROM NEW."organizationId" OR bill_org IS DISTINCT FROM NEW."organizationId"
    OR credit_vendor IS DISTINCT FROM bill_vendor
  THEN RAISE EXCEPTION 'Credit application references must share organization and vendor'; END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO applied
    FROM "VendorCreditApplication" WHERE "vendorCreditId" = NEW."vendorCreditId";
  IF applied + NEW."amountMinor" > credit_total THEN
    RAISE EXCEPTION 'Credit applications cannot exceed vendor credit';
  END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO applied
    FROM "VendorCreditApplication" WHERE "billId" = NEW."billId";
  IF applied + NEW."amountMinor" > bill_total - bill_paid THEN
    RAISE EXCEPTION 'Credit applications cannot exceed bill eligible balance';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "VendorCreditApplication_limits"
BEFORE INSERT ON "VendorCreditApplication"
FOR EACH ROW EXECUTE FUNCTION phase7_validate_credit_application();

CREATE OR REPLACE FUNCTION phase7_validate_vendor_credit() RETURNS TRIGGER AS $$
DECLARE subtotal BIGINT; recoverable BIGINT; nonrecoverable BIGINT; tax BIGINT; total BIGINT;
  source_line RECORD;
BEGIN
  IF NEW."status"::text IN ('POSTED','APPLIED') THEN
    SELECT COALESCE(SUM("netAmountMinor"),0), COALESCE(SUM("recoverableTaxMinor"),0),
      COALESCE(SUM("nonRecoverableTaxMinor"),0), COALESCE(SUM("taxTotalMinor"),0),
      COALESCE(SUM("totalMinor"),0)
      INTO subtotal, recoverable, nonrecoverable, tax, total
      FROM "VendorCreditLine" WHERE "vendorCreditId" = NEW."id";
    IF NEW."subtotalMinor" <> subtotal OR NEW."recoverableTaxMinor" <> recoverable
      OR NEW."nonRecoverableTaxMinor" <> nonrecoverable OR NEW."taxTotalMinor" <> tax
      OR NEW."grandTotalMinor" <> total OR NEW."grandTotalMinor" <= 0
      OR NEW."journalId" IS NULL OR NEW."postedAt" IS NULL OR NEW."postedByUserId" IS NULL
    THEN RAISE EXCEPTION 'Posted vendor credit totals, lines, and journal must agree'; END IF;
    FOR source_line IN
      SELECT line."billLineId", SUM(line."totalMinor") AS credited
      FROM "VendorCreditLine" line
      JOIN "VendorCredit" credit ON credit."id" = line."vendorCreditId"
      WHERE line."billLineId" IS NOT NULL
        AND credit."organizationId" = NEW."organizationId"
        AND (credit."status"::text IN ('POSTED','APPLIED') OR credit."id" = NEW."id")
      GROUP BY line."billLineId"
    LOOP
      IF source_line.credited > (SELECT "totalMinor" FROM "BillLine" WHERE "id" = source_line."billLineId") THEN
        RAISE EXCEPTION 'Vendor credits cannot exceed original bill line value';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "VendorCredit_posting_invariant"
BEFORE INSERT OR UPDATE ON "VendorCredit"
FOR EACH ROW EXECUTE FUNCTION phase7_validate_vendor_credit();

CREATE OR REPLACE FUNCTION phase7_validate_settlement_projection() RETURNS TRIGGER AS $$
DECLARE paid BIGINT; credited BIGINT; applied BIGINT;
BEGIN
  IF NEW."status"::text NOT IN ('DRAFT','APPROVED') THEN
    SELECT COALESCE(SUM(allocation."amountMinor"),0) INTO paid
      FROM "BillPaymentAllocation" allocation
      JOIN "BillPayment" payment ON payment."id" = allocation."billPaymentId"
      WHERE allocation."billId" = NEW."id" AND payment."reversedJournalId" IS NULL;
    SELECT COALESCE(SUM("amountMinor"),0) INTO credited
      FROM "VendorCreditApplication" WHERE "billId" = NEW."id";
    IF NEW."amountPaidMinor" <> paid OR NEW."creditedMinor" <> credited THEN
      RAISE EXCEPTION 'Bill settlement totals must equal immutable allocations';
    END IF;
    IF NEW."status"::text = 'PAID' AND paid + credited <> NEW."grandTotalMinor" THEN
      RAISE EXCEPTION 'Paid bill status requires a zero balance';
    END IF;
    IF NEW."status"::text = 'CREDITED' AND paid + credited <> NEW."grandTotalMinor" THEN
      RAISE EXCEPTION 'Credited bill status requires a zero balance';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "Bill_settlement_projection"
BEFORE INSERT OR UPDATE ON "Bill"
FOR EACH ROW EXECUTE FUNCTION phase7_validate_settlement_projection();

CREATE OR REPLACE FUNCTION phase7_validate_credit_projection() RETURNS TRIGGER AS $$
DECLARE applied BIGINT;
BEGIN
  IF NEW."status"::text IN ('POSTED','APPLIED') THEN
    SELECT COALESCE(SUM("amountMinor"),0) INTO applied
      FROM "VendorCreditApplication" WHERE "vendorCreditId" = NEW."id";
    IF NEW."appliedMinor" <> applied THEN
      RAISE EXCEPTION 'Vendor credit applied total must equal immutable applications';
    END IF;
    IF NEW."status"::text = 'APPLIED' AND applied <> NEW."grandTotalMinor" THEN
      RAISE EXCEPTION 'Applied vendor credit status requires no available balance';
    END IF;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "VendorCredit_application_projection"
BEFORE INSERT OR UPDATE ON "VendorCredit"
FOR EACH ROW EXECUTE FUNCTION phase7_validate_credit_projection();

CREATE OR REPLACE FUNCTION phase7_validate_immediate_expense() RETURNS TRIGGER AS $$
DECLARE net BIGINT; recoverable BIGINT; nonrecoverable BIGINT; tax BIGINT; total BIGINT;
BEGIN
  SELECT COALESCE(SUM("netAmountMinor"),0), COALESCE(SUM("recoverableTaxMinor"),0),
    COALESCE(SUM("nonRecoverableTaxMinor"),0), COALESCE(SUM("taxTotalMinor"),0),
    COALESCE(SUM("totalMinor"),0)
    INTO net, recoverable, nonrecoverable, tax, total
    FROM "ImmediateExpenseLine" WHERE "immediateExpenseId" = NEW."id";
  IF NEW."recoverableTaxMinor" <> recoverable OR NEW."nonRecoverableTaxMinor" <> nonrecoverable
    OR NEW."taxTotalMinor" <> tax OR NEW."grandTotalMinor" <> total
  THEN RAISE EXCEPTION 'Immediate expense totals must match immutable lines'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "ImmediateExpense_totals_invariant"
AFTER INSERT OR UPDATE ON "ImmediateExpense"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase7_validate_immediate_expense();

CREATE OR REPLACE FUNCTION phase7_validate_immediate_expense_line() RETURNS TRIGGER AS $$
DECLARE expense_record "ImmediateExpense"%ROWTYPE;
  recoverable BIGINT; nonrecoverable BIGINT; tax BIGINT; total BIGINT;
BEGIN
  SELECT * INTO expense_record FROM "ImmediateExpense" WHERE "id" = NEW."immediateExpenseId";
  SELECT COALESCE(SUM("recoverableTaxMinor"),0), COALESCE(SUM("nonRecoverableTaxMinor"),0),
    COALESCE(SUM("taxTotalMinor"),0), COALESCE(SUM("totalMinor"),0)
    INTO recoverable, nonrecoverable, tax, total
    FROM "ImmediateExpenseLine" WHERE "immediateExpenseId" = NEW."immediateExpenseId";
  IF expense_record."recoverableTaxMinor" <> recoverable
    OR expense_record."nonRecoverableTaxMinor" <> nonrecoverable
    OR expense_record."taxTotalMinor" <> tax OR expense_record."grandTotalMinor" <> total
  THEN RAISE EXCEPTION 'Immediate expense lines cannot diverge from posted totals'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "ImmediateExpenseLine_totals_invariant"
AFTER INSERT ON "ImmediateExpenseLine"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION phase7_validate_immediate_expense_line();

GRANT SELECT, INSERT, UPDATE ON "Vendor", "Bill", "BillLine", "BillPayment", "BillPaymentAllocation",
  "VendorCredit", "VendorCreditLine", "VendorCreditApplication", "ImmediateExpense",
  "ImmediateExpenseLine", "PurchaseAttachment" TO clearledger_runtime;
GRANT DELETE ON "Vendor", "Bill", "BillLine", "VendorCredit", "VendorCreditLine" TO clearledger_runtime;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Vendor','Bill','BillLine','BillPayment','BillPaymentAllocation','VendorCredit',
    'VendorCreditLine','VendorCreditApplication','ImmediateExpense','ImmediateExpenseLine','PurchaseAttachment'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;
