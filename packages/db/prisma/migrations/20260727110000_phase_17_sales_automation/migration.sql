CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'CONVERTED');
CREATE TYPE "RecurringScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED', 'FAILED');
CREATE TYPE "RecurringFrequency" AS ENUM ('WEEK', 'MONTH', 'YEAR');
CREATE TYPE "CommunicationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED');
CREATE TYPE "CommunicationKind" AS ENUM ('ESTIMATE', 'REMINDER', 'STATEMENT', 'RECURRING_RUN');

ALTER TABLE "Invoice" ADD COLUMN "sourceEstimateId" UUID;

CREATE TABLE "Estimate" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "estimateNumber" TEXT,
  "provisionalIdentifier" TEXT NOT NULL,
  "issueDate" DATE NOT NULL,
  "expiryDate" DATE,
  "currency" CHAR(3) NOT NULL,
  "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
  "discountTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "taxTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "grandTotalMinor" BIGINT NOT NULL DEFAULT 0,
  "customerNameSnapshot" TEXT NOT NULL,
  "customerEmailSnapshot" TEXT,
  "billingAddressSnapshot" JSONB,
  "organizationSnapshot" JSONB NOT NULL,
  "customerFacingNotes" TEXT,
  "internalNotes" TEXT,
  "terms" TEXT,
  "acceptedAt" TIMESTAMPTZ(6),
  "declinedAt" TIMESTAMPTZ(6),
  "convertedAt" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Estimate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Estimate_provisionalIdentifier_key" UNIQUE ("provisionalIdentifier"),
  CONSTRAINT "Estimate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Estimate_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Estimate_organizationId_estimateNumber_key" ON "Estimate"("organizationId", "estimateNumber");
CREATE INDEX "Estimate_organizationId_status_expiryDate_idx" ON "Estimate"("organizationId", "status", "expiryDate");
CREATE INDEX "Estimate_organizationId_customerId_status_idx" ON "Estimate"("organizationId", "customerId", "status");

CREATE TABLE "EstimateLine" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "estimateId" UUID NOT NULL,
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
  "taxSnapshot" JSONB,
  "incomeAccountId" UUID NOT NULL,
  "incomeAccountCode" TEXT NOT NULL,
  "incomeAccountName" TEXT NOT NULL,
  CONSTRAINT "EstimateLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EstimateLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EstimateLine_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EstimateLine_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "EstimateLine_incomeAccountId_fkey" FOREIGN KEY ("incomeAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "EstimateLine_estimateId_lineNumber_key" ON "EstimateLine"("estimateId", "lineNumber");
CREATE INDEX "EstimateLine_organizationId_estimateId_idx" ON "EstimateLine"("organizationId", "estimateId");

CREATE TABLE "EstimatePublicLink" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "estimateId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6),
  "revokedAt" TIMESTAMPTZ(6),
  "lastViewedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstimatePublicLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EstimatePublicLink_tokenHash_key" UNIQUE ("tokenHash"),
  CONSTRAINT "EstimatePublicLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EstimatePublicLink_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "EstimatePublicLink_organizationId_estimateId_revokedAt_idx" ON "EstimatePublicLink"("organizationId", "estimateId", "revokedAt");
CREATE INDEX "EstimatePublicLink_expiresAt_idx" ON "EstimatePublicLink"("expiresAt");

CREATE TABLE "EstimateDelivery" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "estimateId" UUID NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "message" TEXT,
  "status" "CommunicationStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "queuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMPTZ(6),
  "failedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EstimateDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EstimateDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EstimateDelivery_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "Estimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "EstimateDelivery_organizationId_estimateId_queuedAt_idx" ON "EstimateDelivery"("organizationId", "estimateId", "queuedAt");
CREATE INDEX "EstimateDelivery_status_queuedAt_idx" ON "EstimateDelivery"("status", "queuedAt");

CREATE TABLE "RecurringSchedule" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "customerId" UUID,
  "scheduleType" TEXT NOT NULL,
  "frequency" "RecurringFrequency" NOT NULL,
  "interval" INTEGER NOT NULL DEFAULT 1,
  "dayOfMonth" INTEGER,
  "timeZone" TEXT NOT NULL DEFAULT 'America/Edmonton',
  "nextRunAt" TIMESTAMPTZ(6) NOT NULL,
  "startAt" TIMESTAMPTZ(6) NOT NULL,
  "endAt" TIMESTAMPTZ(6),
  "status" "RecurringScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
  "template" JSONB NOT NULL,
  "lastRunAt" TIMESTAMPTZ(6),
  "lastError" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RecurringSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecurringSchedule_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RecurringSchedule_organizationId_status_nextRunAt_idx" ON "RecurringSchedule"("organizationId", "status", "nextRunAt");
CREATE INDEX "RecurringSchedule_organizationId_customerId_status_idx" ON "RecurringSchedule"("organizationId", "customerId", "status");

CREATE TABLE "Communication" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "customerId" UUID,
  "invoiceId" UUID,
  "kind" "CommunicationKind" NOT NULL,
  "channel" TEXT NOT NULL,
  "deduplicationKey" TEXT NOT NULL,
  "status" "CommunicationStatus" NOT NULL DEFAULT 'QUEUED',
  "scheduledAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMPTZ(6),
  "lastError" TEXT,
  "payload" JSONB NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Communication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Communication_organizationId_deduplicationKey_key" UNIQUE ("organizationId", "deduplicationKey"),
  CONSTRAINT "Communication_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Communication_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Communication_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Communication_organizationId_status_scheduledAt_idx" ON "Communication"("organizationId", "status", "scheduledAt");
CREATE INDEX "Communication_organizationId_customerId_scheduledAt_idx" ON "Communication"("organizationId", "customerId", "scheduledAt");

ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_sourceEstimateId_fkey" FOREIGN KEY ("sourceEstimateId") REFERENCES "Estimate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Invoice_sourceEstimateId_key" ON "Invoice"("sourceEstimateId");
CREATE INDEX "Invoice_organizationId_sourceEstimateId_idx" ON "Invoice"("organizationId", "sourceEstimateId");

CREATE OR REPLACE FUNCTION phase17_estimate_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD."status" = 'DRAFT' AND NEW."status" NOT IN ('DRAFT', 'SENT', 'CANCELLED'))
    OR (OLD."status" = 'SENT' AND NEW."status" NOT IN ('SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'))
    OR (OLD."status" = 'VIEWED' AND NEW."status" NOT IN ('VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED'))
    OR (OLD."status" = 'ACCEPTED' AND NEW."status" NOT IN ('ACCEPTED', 'CONVERTED', 'CANCELLED'))
    OR (OLD."status" IN ('DECLINED', 'EXPIRED', 'CANCELLED', 'CONVERTED') AND NEW."status" <> OLD."status")
  THEN
    RAISE EXCEPTION 'Invalid estimate status transition';
  END IF;
  IF NEW."status" = 'ACCEPTED' AND NEW."acceptedAt" IS NULL THEN
    RAISE EXCEPTION 'Accepted estimates require acceptance evidence';
  END IF;
  IF NEW."status" = 'CONVERTED' AND NEW."convertedAt" IS NULL THEN
    RAISE EXCEPTION 'Converted estimates require conversion evidence';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Estimate_transition_guard"
  BEFORE UPDATE ON "Estimate"
  FOR EACH ROW EXECUTE FUNCTION phase17_estimate_transition_guard();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Estimate', 'EstimateLine', 'EstimatePublicLink', 'EstimateDelivery', 'RecurringSchedule', 'Communication']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END;
$$;
