ALTER TABLE "PayrollSchedule"
  ADD COLUMN "automaticDraftsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "draftLeadDays" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "lastAutomaticDraftAt" TIMESTAMPTZ(6);

ALTER TABLE "PayrollSchedule"
  ADD CONSTRAINT "PayrollSchedule_draftLeadDays_range"
  CHECK ("draftLeadDays" >= 0 AND "draftLeadDays" <= 31);

CREATE INDEX "PayrollSchedule_automaticDraftsEnabled_active_idx"
  ON "PayrollSchedule"("organizationId", "automaticDraftsEnabled", "active");
