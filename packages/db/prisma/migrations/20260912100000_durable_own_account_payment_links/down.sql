DROP TABLE IF EXISTS "PaymentLink";
ALTER TABLE "PaymentAccount"
  DROP COLUMN IF EXISTS "providerEnvironment",
  DROP COLUMN IF EXISTS "providerLocationId",
  DROP COLUMN IF EXISTS "providerDisplayName",
  DROP COLUMN IF EXISTS "credentialCiphertext",
  DROP COLUMN IF EXISTS "accountMode";
DROP TYPE IF EXISTS "PaymentLinkStatus";
DROP TYPE IF EXISTS "PaymentAccountMode";
