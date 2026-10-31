ALTER TABLE "CommerceInboxEvent"
  ADD COLUMN "conversionStatus" VARCHAR(40) NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "conversionReviewNote" TEXT,
  ADD COLUMN "conversionMissing" JSONB,
  ADD COLUMN "providerTotalsSnapshot" JSONB,
  ADD COLUMN "resultingInvoiceId" UUID;

CREATE UNIQUE INDEX "CommerceInboxEvent_resultingInvoiceId_key"
  ON "CommerceInboxEvent" ("resultingInvoiceId");

CREATE UNIQUE INDEX "CommerceInboxEvent_organizationId_resultingInvoiceId_key"
  ON "CommerceInboxEvent" ("organizationId", "resultingInvoiceId");

CREATE INDEX "CommerceInboxEvent_organizationId_conversionStatus_createdAt_idx"
  ON "CommerceInboxEvent" ("organizationId", "conversionStatus", "createdAt");

ALTER TABLE "CommerceInboxEvent"
  ADD CONSTRAINT "CommerceInboxEvent_organizationId_resultingInvoiceId_fkey"
  FOREIGN KEY ("organizationId", "resultingInvoiceId")
  REFERENCES "Invoice" ("organizationId", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
