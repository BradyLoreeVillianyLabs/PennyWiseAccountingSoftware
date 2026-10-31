CREATE TYPE "PaymentAccountMode" AS ENUM ('PLATFORM_CONNECTED', 'OWN_ACCOUNT');
CREATE TYPE "PaymentLinkStatus" AS ENUM ('ACTIVE', 'PAID', 'DEACTIVATED', 'REVIEW_REQUIRED', 'FAILED');

ALTER TABLE "PaymentAccount"
  ADD COLUMN "accountMode" "PaymentAccountMode" NOT NULL DEFAULT 'PLATFORM_CONNECTED',
  ADD COLUMN "credentialCiphertext" TEXT,
  ADD COLUMN "providerDisplayName" TEXT,
  ADD COLUMN "providerLocationId" TEXT,
  ADD COLUMN "providerEnvironment" TEXT NOT NULL DEFAULT 'test';

CREATE TABLE "PaymentLink" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "paymentAccountId" UUID NOT NULL,
  "providerLinkId" TEXT NOT NULL,
  "providerPaymentId" TEXT,
  "providerLinkUrl" TEXT NOT NULL,
  "idempotencyKeyHash" CHAR(64) NOT NULL,
  "requestedAmountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "status" "PaymentLinkStatus" NOT NULL DEFAULT 'ACTIVE',
  "pollAttempts" INTEGER NOT NULL DEFAULT 0,
  "nextPollAt" TIMESTAMPTZ(6),
  "lastPolledAt" TIMESTAMPTZ(6),
  "lastErrorCode" VARCHAR(120),
  "completedAt" TIMESTAMPTZ(6),
  "deactivatedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentLink_providerLinkId_key" UNIQUE ("providerLinkId"),
  CONSTRAINT "PaymentLink_organizationId_invoiceId_idempotencyKeyHash_key" UNIQUE ("organizationId", "invoiceId", "idempotencyKeyHash"),
  CONSTRAINT "PaymentLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PaymentLink_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PaymentLink_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "PaymentLink_organizationId_invoiceId_status_idx" ON "PaymentLink" ("organizationId", "invoiceId", "status");
CREATE INDEX "PaymentLink_organizationId_status_nextPollAt_idx" ON "PaymentLink" ("organizationId", "status", "nextPollAt");
