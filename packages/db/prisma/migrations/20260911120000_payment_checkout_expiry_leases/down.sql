DROP INDEX IF EXISTS "PaymentCheckoutSession_expiry_claim_idx";

ALTER TABLE "PaymentCheckoutSession"
  DROP COLUMN IF EXISTS "cancellationLastError",
  DROP COLUMN IF EXISTS "cancellationAttempts",
  DROP COLUMN IF EXISTS "cancellationClaimedAt";
