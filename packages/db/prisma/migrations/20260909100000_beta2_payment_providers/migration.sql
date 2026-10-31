-- Beta 2 adds hosted processor identities without changing existing Stripe or
-- manual payment rows. PostgreSQL enum values are append-only for compatibility
-- with already-deployed databases.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'PAYPAL';
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'SQUARE';
