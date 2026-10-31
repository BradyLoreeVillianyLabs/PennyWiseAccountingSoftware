ALTER TABLE "PaymentCheckoutSession"
  ADD COLUMN "cancellationClaimedAt" TIMESTAMPTZ(6),
  ADD COLUMN "cancellationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cancellationLastError" VARCHAR(500);

CREATE INDEX "PaymentCheckoutSession_expiry_claim_idx"
  ON "PaymentCheckoutSession" ("organizationId", "expiresAt", "completedAt", "cancelledAt");
