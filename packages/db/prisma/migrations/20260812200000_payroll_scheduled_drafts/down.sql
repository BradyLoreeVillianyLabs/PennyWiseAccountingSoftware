DROP INDEX IF EXISTS "PayrollSchedule_automaticDraftsEnabled_active_idx";

ALTER TABLE "PayrollSchedule"
  DROP CONSTRAINT IF EXISTS "PayrollSchedule_draftLeadDays_range";

ALTER TABLE "PayrollSchedule"
  DROP COLUMN IF EXISTS "lastAutomaticDraftAt",
  DROP COLUMN IF EXISTS "draftLeadDays",
  DROP COLUMN IF EXISTS "automaticDraftsEnabled";
