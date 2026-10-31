ALTER TABLE "BusinessDefaults"
  ADD COLUMN "paymentMethods" JSONB,
  ADD COLUMN "documentLanguage" TEXT NOT NULL DEFAULT 'en-CA';
