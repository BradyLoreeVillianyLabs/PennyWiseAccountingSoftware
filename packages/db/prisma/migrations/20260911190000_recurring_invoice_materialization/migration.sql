ALTER TABLE "RecurringSchedule"
  ADD COLUMN "missedOccurrencePolicy" VARCHAR(16) NOT NULL DEFAULT 'EVERY',
  ADD COLUMN "invoiceMode" VARCHAR(16) NOT NULL DEFAULT 'DRAFT';

ALTER TABLE "Invoice"
  ADD COLUMN "recurrenceIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "Invoice_organizationId_recurrenceIdempotencyKey_key"
  ON "Invoice" ("organizationId", "recurrenceIdempotencyKey");

CREATE TABLE "RecurringScheduleOccurrence" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "scheduleId" UUID NOT NULL,
  "occurrenceAt" TIMESTAMPTZ(6) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "invoiceId" UUID,
  "outcome" VARCHAR(160),
  "blockingReason" TEXT,
  "failureReason" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "RecurringScheduleOccurrence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecurringScheduleOccurrence_invoiceId_key"
  ON "RecurringScheduleOccurrence" ("invoiceId");
CREATE UNIQUE INDEX "RSO_org_schedule_occurrence_key"
  ON "RecurringScheduleOccurrence" ("organizationId", "scheduleId", "occurrenceAt");
CREATE INDEX "RSO_org_schedule_occurrence_idx"
  ON "RecurringScheduleOccurrence" ("organizationId", "scheduleId", "occurrenceAt");
CREATE INDEX "RecurringScheduleOccurrence_organizationId_status_updatedAt_idx"
  ON "RecurringScheduleOccurrence" ("organizationId", "status", "updatedAt");

ALTER TABLE "RecurringScheduleOccurrence"
  ADD CONSTRAINT "RecurringScheduleOccurrence_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringScheduleOccurrence"
  ADD CONSTRAINT "RecurringScheduleOccurrence_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "RecurringSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringScheduleOccurrence"
  ADD CONSTRAINT "RecurringScheduleOccurrence_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON "RecurringScheduleOccurrence" TO clearledger_runtime;

ALTER TABLE "RecurringScheduleOccurrence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringScheduleOccurrence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "RecurringScheduleOccurrence_tenant_policy" ON "RecurringScheduleOccurrence"
  FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
