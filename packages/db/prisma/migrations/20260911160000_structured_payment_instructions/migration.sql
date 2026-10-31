CREATE TABLE "PaymentInstructionSettings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "legacyInstructions" TEXT,
    "methods" JSONB,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentInstructionSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentInstructionSettings_organizationId_key"
    ON "PaymentInstructionSettings"("organizationId");

CREATE INDEX "PaymentInstructionSettings_organizationId_version_idx"
    ON "PaymentInstructionSettings"("organizationId", "version");

ALTER TABLE "PaymentInstructionSettings"
    ADD CONSTRAINT "PaymentInstructionSettings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
