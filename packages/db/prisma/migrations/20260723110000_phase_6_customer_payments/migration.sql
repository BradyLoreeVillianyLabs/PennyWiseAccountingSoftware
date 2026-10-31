CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'MANUAL');
CREATE TYPE "PaymentAccountStatus" AS ENUM ('NOT_CONNECTED', 'PENDING_ONBOARDING', 'CONNECTED', 'DISCONNECTED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'DISPUTED', 'CANCELLED');
CREATE TYPE "PaymentMethodCategory" AS ENUM ('CARD', 'CASH', 'CHEQUE', 'ELECTRONIC_TRANSFER', 'EXTERNAL_CARD', 'OTHER');
CREATE TYPE "PaymentSource" AS ENUM ('HOSTED_CHECKOUT', 'MANUAL');
CREATE TYPE "PaymentWebhookStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'FAILED', 'IGNORED');
CREATE TYPE "PaymentRefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "PaymentRefundTreatment" AS ENUM ('CUSTOMER_CREDIT', 'CREDIT_NOTE_AND_REFUND', 'UNAPPLIED_PAYMENT');
CREATE TYPE "PaymentDisputeStatus" AS ENUM ('REVIEW_REQUIRED', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED');

CREATE TABLE "PaymentAccount" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "provider" "PaymentProvider" NOT NULL,
  "providerAccountCiphertext" TEXT,
  "status" "PaymentAccountStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
  "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
  "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "requirementsDue" JSONB,
  "connectedAt" TIMESTAMPTZ(6),
  "disconnectedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentAccount_provider_reference_check" CHECK (
    ("status" = 'CONNECTED') = ("providerAccountCiphertext" IS NOT NULL)
  ),
  CONSTRAINT "PaymentAccount_organizationId_provider_key" UNIQUE ("organizationId", "provider"),
  CONSTRAINT "PaymentAccount_organizationId_id_key" UNIQUE ("organizationId", "id")
);

CREATE TABLE "PaymentSettings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL UNIQUE REFERENCES "Organization"("id") ON DELETE CASCADE,
  "clearingAccountId" UUID NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT,
  "feeExpenseAccountId" UUID NOT NULL REFERENCES "Account"("id") ON DELETE RESTRICT,
  "allowPartialPayments" BOOLEAN NOT NULL DEFAULT false,
  "minimumPartialMinor" BIGINT NOT NULL DEFAULT 100,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentSettings_minimum_partial_check" CHECK ("minimumPartialMinor" > 0),
  CONSTRAINT "PaymentSettings_different_accounts_check" CHECK ("clearingAccountId" <> "feeExpenseAccountId")
);

CREATE TABLE "Payment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "customerId" UUID NOT NULL REFERENCES "Customer"("id") ON DELETE RESTRICT,
  "paymentAccountId" UUID REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT,
  "provider" "PaymentProvider" NOT NULL,
  "providerPaymentId" TEXT,
  "amountMinor" BIGINT NOT NULL,
  "feeMinor" BIGINT NOT NULL DEFAULT 0,
  "netMinor" BIGINT NOT NULL,
  "unappliedMinor" BIGINT NOT NULL DEFAULT 0,
  "refundedMinor" BIGINT NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentDate" DATE NOT NULL,
  "methodCategory" "PaymentMethodCategory" NOT NULL,
  "source" "PaymentSource" NOT NULL,
  "receivingAccountId" UUID REFERENCES "Account"("id") ON DELETE RESTRICT,
  "reference" TEXT,
  "failureReason" TEXT,
  "journalId" UUID UNIQUE REFERENCES "Journal"("id") ON DELETE RESTRICT,
  "createdByUserId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_positive_amount_check" CHECK ("amountMinor" > 0 AND "feeMinor" >= 0 AND "netMinor" = "amountMinor" - "feeMinor" AND "unappliedMinor" >= 0 AND "unappliedMinor" <= "amountMinor" AND "refundedMinor" >= 0 AND "refundedMinor" <= "amountMinor"),
  CONSTRAINT "Payment_provider_source_check" CHECK (("provider" = 'MANUAL') = ("source" = 'MANUAL')),
  CONSTRAINT "Payment_manual_receiving_account_check" CHECK (("source" = 'MANUAL') = ("receivingAccountId" IS NOT NULL)),
  CONSTRAINT "Payment_organizationId_id_key" UNIQUE ("organizationId", "id"),
  CONSTRAINT "Payment_organizationId_provider_providerPaymentId_key" UNIQUE ("organizationId", "provider", "providerPaymentId")
);

CREATE TABLE "PaymentAllocation" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "paymentId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentAllocation_positive_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentAllocation_payment_invoice_key" UNIQUE ("paymentId", "invoiceId"),
  CONSTRAINT "PaymentAllocation_payment_tenant_fkey" FOREIGN KEY ("organizationId", "paymentId") REFERENCES "Payment"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "PaymentAllocation_invoice_tenant_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT
);

CREATE TABLE "PaymentCheckoutSession" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "invoiceId" UUID NOT NULL,
  "paymentAccountId" UUID NOT NULL,
  "providerSessionId" TEXT NOT NULL UNIQUE,
  "requestedAmountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "completedAt" TIMESTAMPTZ(6),
  "cancelledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentCheckoutSession_positive_amount_check" CHECK ("requestedAmountMinor" > 0),
  CONSTRAINT "PaymentCheckoutSession_invoice_tenant_fkey" FOREIGN KEY ("organizationId", "invoiceId") REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "PaymentCheckoutSession_account_tenant_fkey" FOREIGN KEY ("organizationId", "paymentAccountId") REFERENCES "PaymentAccount"("organizationId", "id") ON DELETE RESTRICT
);

CREATE TABLE "PaymentWebhookEvent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "paymentAccountId" UUID NOT NULL,
  "paymentId" UUID,
  "provider" "PaymentProvider" NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payloadRedacted" JSONB NOT NULL,
  "status" "PaymentWebhookStatus" NOT NULL DEFAULT 'RECEIVED',
  "processingError" TEXT,
  "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(6),
  CONSTRAINT "PaymentWebhookEvent_provider_event_key" UNIQUE ("provider", "providerEventId"),
  CONSTRAINT "PaymentWebhookEvent_account_tenant_fkey" FOREIGN KEY ("organizationId", "paymentAccountId") REFERENCES "PaymentAccount"("organizationId", "id") ON DELETE RESTRICT,
  CONSTRAINT "PaymentWebhookEvent_payment_tenant_fkey" FOREIGN KEY ("organizationId", "paymentId") REFERENCES "Payment"("organizationId", "id") ON DELETE SET NULL
);

CREATE TABLE "PaymentRefund" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "paymentId" UUID NOT NULL,
  "providerRefundId" TEXT,
  "amountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "PaymentRefundStatus" NOT NULL DEFAULT 'PENDING',
  "treatment" "PaymentRefundTreatment" NOT NULL,
  "reason" TEXT NOT NULL,
  "journalId" UUID UNIQUE REFERENCES "Journal"("id") ON DELETE RESTRICT,
  "requestedByUserId" UUID NOT NULL,
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRefund_positive_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentRefund_provider_reference_key" UNIQUE ("organizationId", "providerRefundId"),
  CONSTRAINT "PaymentRefund_payment_tenant_fkey" FOREIGN KEY ("organizationId", "paymentId") REFERENCES "Payment"("organizationId", "id") ON DELETE RESTRICT
);

CREATE TABLE "PaymentDispute" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "paymentId" UUID NOT NULL,
  "providerDisputeId" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "status" "PaymentDisputeStatus" NOT NULL DEFAULT 'REVIEW_REQUIRED',
  "reasonCategory" TEXT,
  "evidenceDueAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(6),
  CONSTRAINT "PaymentDispute_positive_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PaymentDispute_provider_reference_key" UNIQUE ("organizationId", "providerDisputeId"),
  CONSTRAINT "PaymentDispute_payment_tenant_fkey" FOREIGN KEY ("organizationId", "paymentId") REFERENCES "Payment"("organizationId", "id") ON DELETE RESTRICT
);

CREATE TABLE "PaymentReceipt" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE,
  "paymentId" UUID NOT NULL UNIQUE,
  "receiptNumber" TEXT NOT NULL,
  "renderData" JSONB NOT NULL,
  "renderDataHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReceipt_organization_receipt_key" UNIQUE ("organizationId", "receiptNumber"),
  CONSTRAINT "PaymentReceipt_payment_tenant_fkey" FOREIGN KEY ("organizationId", "paymentId") REFERENCES "Payment"("organizationId", "id") ON DELETE RESTRICT
);

CREATE INDEX "Payment_organization_customer_date_idx" ON "Payment" ("organizationId", "customerId", "paymentDate");
CREATE INDEX "Payment_organization_status_idx" ON "Payment" ("organizationId", "status");
CREATE INDEX "PaymentAllocation_organization_invoice_idx" ON "PaymentAllocation" ("organizationId", "invoiceId");
CREATE INDEX "PaymentCheckoutSession_organization_invoice_expiry_idx" ON "PaymentCheckoutSession" ("organizationId", "invoiceId", "expiresAt");
CREATE INDEX "PaymentWebhookEvent_organization_status_received_idx" ON "PaymentWebhookEvent" ("organizationId", "status", "receivedAt");
CREATE INDEX "PaymentRefund_organization_payment_status_idx" ON "PaymentRefund" ("organizationId", "paymentId", "status");
CREATE INDEX "PaymentDispute_organization_payment_status_idx" ON "PaymentDispute" ("organizationId", "paymentId", "status");

CREATE OR REPLACE FUNCTION phase6_validate_payment_allocation() RETURNS TRIGGER AS $$
DECLARE payment_row "Payment"%ROWTYPE; invoice_row "Invoice"%ROWTYPE; allocated BIGINT; credits BIGINT;
BEGIN
  SELECT * INTO payment_row FROM "Payment" WHERE "id" = NEW."paymentId" FOR UPDATE;
  SELECT * INTO invoice_row FROM "Invoice" WHERE "id" = NEW."invoiceId" FOR UPDATE;
  IF NOT FOUND OR payment_row."organizationId" <> NEW."organizationId" OR invoice_row."organizationId" <> NEW."organizationId" OR payment_row."customerId" <> invoice_row."customerId" THEN
    RAISE EXCEPTION 'Payment allocation must reference one customer and organization';
  END IF;
  IF payment_row."status" NOT IN ('SUCCEEDED','PARTIALLY_REFUNDED') OR invoice_row."status" NOT IN ('POSTED','PARTIALLY_PAID','PARTIALLY_CREDITED') THEN
    RAISE EXCEPTION 'Payment allocation requires an open succeeded payment and invoice';
  END IF;
  SELECT COALESCE(SUM("amountMinor"), 0) INTO allocated FROM "PaymentAllocation" WHERE "paymentId" = NEW."paymentId";
  SELECT COALESCE(SUM("grandTotalMinor"), 0) INTO credits FROM "CreditNote" WHERE "invoiceId" = NEW."invoiceId" AND "status" = 'POSTED';
  IF allocated + NEW."amountMinor" > payment_row."amountMinor" - payment_row."refundedMinor" OR invoice_row."amountPaidMinor" + NEW."amountMinor" > invoice_row."grandTotalMinor" - credits THEN
    RAISE EXCEPTION 'Payment allocation exceeds eligible balance';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PaymentAllocation_invariant" BEFORE INSERT ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION phase6_validate_payment_allocation();

CREATE OR REPLACE FUNCTION phase6_protect_payment_history() RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'PaymentAllocation' THEN RAISE EXCEPTION 'Payment allocations are immutable'; END IF;
  IF OLD."journalId" IS NOT NULL AND (NEW."amountMinor" <> OLD."amountMinor" OR NEW."customerId" <> OLD."customerId" OR NEW."receivingAccountId" IS DISTINCT FROM OLD."receivingAccountId") THEN
    RAISE EXCEPTION 'Posted payment financial attributes are immutable';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PaymentAllocation_append_only_update" BEFORE UPDATE OR DELETE ON "PaymentAllocation" FOR EACH ROW EXECUTE FUNCTION phase6_protect_payment_history();
CREATE TRIGGER "Payment_posted_history_protection" BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION phase6_protect_payment_history();

CREATE OR REPLACE FUNCTION phase6_protect_payment_receipt() RETURNS TRIGGER AS $$ BEGIN RAISE EXCEPTION 'Payment receipts are append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "PaymentReceipt_append_only_update" BEFORE UPDATE OR DELETE ON "PaymentReceipt" FOR EACH ROW EXECUTE FUNCTION phase6_protect_payment_receipt();

GRANT SELECT, INSERT, UPDATE ON "PaymentAccount", "PaymentSettings", "Payment", "PaymentAllocation", "PaymentCheckoutSession", "PaymentWebhookEvent", "PaymentRefund", "PaymentDispute", "PaymentReceipt" TO clearledger_runtime;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['PaymentAccount','PaymentSettings','Payment','PaymentAllocation','PaymentCheckoutSession','PaymentWebhookEvent','PaymentRefund','PaymentDispute','PaymentReceipt'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())', table_name || '_tenant_policy', table_name);
  END LOOP;
END $$;

CREATE POLICY "PaymentCheckoutSession_public_insert_policy" ON "PaymentCheckoutSession" FOR INSERT TO clearledger_runtime WITH CHECK (phase5_public_invoice_access("organizationId", "invoiceId"));
CREATE POLICY "PaymentCheckoutSession_public_select_policy" ON "PaymentCheckoutSession" FOR SELECT TO clearledger_runtime USING (phase5_public_invoice_access("organizationId", "invoiceId"));
