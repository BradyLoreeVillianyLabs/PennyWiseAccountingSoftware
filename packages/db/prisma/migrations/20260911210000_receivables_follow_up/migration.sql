ALTER TABLE "OrganizationSettings"
  ADD COLUMN "reminderAutomationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reminderTone" TEXT NOT NULL DEFAULT 'FRIENDLY',
  ADD COLUMN "reminderOffsets" JSONB,
  ADD COLUMN "reminderQuietStartHour" INTEGER NOT NULL DEFAULT 8,
  ADD COLUMN "reminderQuietEndHour" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "lateFeeEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "lateFeeType" TEXT NOT NULL DEFAULT 'FLAT',
  ADD COLUMN "lateFeeAmountMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "lateFeePercentBasisPoints" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lateFeePeriodDays" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lateFeeCapMinor" BIGINT,
  ADD COLUMN "lateFeeTerms" TEXT;

ALTER TABLE "Customer"
  ADD COLUMN "reminderDisabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reminderTone" TEXT,
  ADD COLUMN "reminderOffsets" JSONB;

ALTER TABLE "Invoice"
  ADD COLUMN "reminderDisabled" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Customer_organizationId_reminderDisabled_idx"
  ON "Customer" ("organizationId", "reminderDisabled");
CREATE INDEX "Invoice_organizationId_reminderDisabled_status_dueDate_idx"
  ON "Invoice" ("organizationId", "reminderDisabled", "status", "dueDate");
