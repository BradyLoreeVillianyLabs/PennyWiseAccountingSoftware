CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "SetupStep" AS ENUM ('BUSINESS_PROFILE', 'FISCAL_CURRENCY', 'TAX_REGISTRATION', 'INDUSTRY_PRESET', 'CHART_REVIEW', 'OPENING_BALANCES', 'BRANDING_DEFAULTS', 'FINAL_REVIEW');
CREATE TYPE "SetupStepStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');
CREATE TYPE "OpeningBalanceStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT');
CREATE TYPE "TaxCalculationMode" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');
CREATE TYPE "LogoScanStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'CLEAN', 'REJECTED');

ALTER TABLE "Account"
  ADD COLUMN "systemPurpose" TEXT,
  ADD COLUMN "normalBalance" "NormalBalance",
  ADD COLUMN "presetKey" TEXT,
  ADD COLUMN "presetVersion" INTEGER;
CREATE UNIQUE INDEX "Account_organizationId_systemPurpose_key"
  ON "Account" ("organizationId", "systemPurpose");

CREATE TABLE "OrganizationSettings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL UNIQUE,
  "version" INTEGER NOT NULL DEFAULT 1, "businessType" TEXT, "industryPresetKey" TEXT,
  "businessNumber" TEXT, "businessAddress" JSONB, "mailingAddress" JSONB, "phone" TEXT,
  "email" TEXT, "website" TEXT, "locale" TEXT NOT NULL DEFAULT 'en-CA',
  "timeZone" TEXT NOT NULL DEFAULT 'America/Edmonton', "baseCurrency" TEXT NOT NULL DEFAULT 'CAD',
  "fiscalYearEndMonth" INTEGER, "fiscalYearEndDay" INTEGER, "accountingStartDate" DATE,
  "primaryColor" TEXT, "accentColor" TEXT, "setupCompletedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "OrganizationSettings_version_check" CHECK ("version" > 0),
  CONSTRAINT "OrganizationSettings_currency_check" CHECK ("baseCurrency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "OrganizationSettings_fiscal_check" CHECK (
    ("fiscalYearEndMonth" IS NULL AND "fiscalYearEndDay" IS NULL) OR
    ("fiscalYearEndMonth" BETWEEN 1 AND 12 AND "fiscalYearEndDay" BETWEEN 1 AND 31)
  ),
  CONSTRAINT "OrganizationSettings_primary_color_check" CHECK ("primaryColor" IS NULL OR "primaryColor" ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT "OrganizationSettings_accent_color_check" CHECK ("accentColor" IS NULL OR "accentColor" ~ '^#[0-9A-Fa-f]{6}$')
);
CREATE INDEX "OrganizationSettings_organizationId_setupCompletedAt_idx" ON "OrganizationSettings" ("organizationId", "setupCompletedAt");

CREATE TABLE "SetupStepState" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "step" "SetupStep" NOT NULL, "status" "SetupStepStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "version" INTEGER NOT NULL DEFAULT 1, "completedAt" TIMESTAMPTZ(6), "completedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SetupStepState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "SetupStepState_version_check" CHECK ("version" > 0),
  UNIQUE ("organizationId", "step")
);
CREATE INDEX "SetupStepState_organizationId_status_idx" ON "SetupStepState" ("organizationId", "status");

CREATE TABLE "AppliedAccountPreset" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "presetKey" TEXT NOT NULL, "presetVersion" INTEGER NOT NULL, "appliedByUserId" UUID NOT NULL,
  "appliedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppliedAccountPreset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  UNIQUE ("organizationId", "presetKey", "presetVersion")
);
CREATE INDEX "AppliedAccountPreset_organizationId_appliedAt_idx" ON "AppliedAccountPreset" ("organizationId", "appliedAt");

CREATE TABLE "TaxRegistration" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "registrationType" TEXT NOT NULL, "jurisdiction" TEXT NOT NULL, "registrationNumber" TEXT,
  "registered" BOOLEAN NOT NULL DEFAULT false, "effectiveFrom" DATE, "effectiveTo" DATE,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxRegistration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "TaxRegistration_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveFrom" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  UNIQUE ("organizationId", "registrationType", "jurisdiction")
);
CREATE INDEX "TaxRegistration_organizationId_registered_idx" ON "TaxRegistration" ("organizationId", "registered");

CREATE TABLE "TaxCode" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "code" TEXT NOT NULL, "name" TEXT NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  UNIQUE ("organizationId", "code")
);
CREATE INDEX "TaxCode_organizationId_active_idx" ON "TaxCode" ("organizationId", "active");

CREATE TABLE "TaxCodeVersion" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "taxCodeId" UUID NOT NULL, "version" INTEGER NOT NULL, "treatment" "TaxTreatment" NOT NULL,
  "calculationMode" "TaxCalculationMode" NOT NULL, "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE, "sourceName" TEXT NOT NULL, "sourceUrl" TEXT,
  "sourceRetrievedAt" TIMESTAMPTZ(6) NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxCodeVersion_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "TaxCode"("id") ON DELETE RESTRICT,
  CONSTRAINT "TaxCodeVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "TaxCodeVersion_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  UNIQUE ("taxCodeId", "version")
);
CREATE INDEX "TaxCodeVersion_organizationId_effectiveFrom_effectiveTo_idx" ON "TaxCodeVersion" ("organizationId", "effectiveFrom", "effectiveTo");
ALTER TABLE "TaxCodeVersion" ADD CONSTRAINT "TaxCodeVersion_no_overlap_excl" EXCLUDE USING gist (
  "taxCodeId" WITH =, daterange("effectiveFrom", COALESCE("effectiveTo", 'infinity'::date), '[]') WITH &&
);

CREATE TABLE "TaxComponent" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "taxCodeVersionId" UUID NOT NULL, "name" TEXT NOT NULL, "jurisdiction" TEXT NOT NULL,
  "rate" DECIMAL(9,6) NOT NULL, "recoverablePercent" DECIMAL(9,6) NOT NULL,
  "payableAccountId" UUID, "recoverableAccountId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxComponent_taxCodeVersionId_fkey" FOREIGN KEY ("taxCodeVersionId") REFERENCES "TaxCodeVersion"("id") ON DELETE RESTRICT,
  CONSTRAINT "TaxComponent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "TaxComponent_payableAccountId_fkey" FOREIGN KEY ("payableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "TaxComponent_recoverableAccountId_fkey" FOREIGN KEY ("recoverableAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "TaxComponent_rate_check" CHECK ("rate" BETWEEN 0 AND 1),
  CONSTRAINT "TaxComponent_recoverable_check" CHECK ("recoverablePercent" BETWEEN 0 AND 1)
);
CREATE INDEX "TaxComponent_organizationId_taxCodeVersionId_idx" ON "TaxComponent" ("organizationId", "taxCodeVersionId");
CREATE INDEX "TaxComponent_organizationId_payableAccountId_idx" ON "TaxComponent" ("organizationId", "payableAccountId");

CREATE TABLE "OpeningBalanceDraft" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1, "status" "OpeningBalanceStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveDate" DATE NOT NULL, "journalId" UUID, "postedAt" TIMESTAMPTZ(6), "postedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpeningBalanceDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "OpeningBalanceDraft_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  CONSTRAINT "OpeningBalanceDraft_posted_check" CHECK (
    ("status" = 'DRAFT' AND "journalId" IS NULL AND "postedAt" IS NULL) OR
    ("status" IN ('POSTED','REVERSED') AND "journalId" IS NOT NULL AND "postedAt" IS NOT NULL AND "postedByUserId" IS NOT NULL)
  ), UNIQUE ("organizationId", "journalId")
);
CREATE UNIQUE INDEX "OpeningBalanceDraft_one_draft_per_org" ON "OpeningBalanceDraft" ("organizationId") WHERE "status" = 'DRAFT';
CREATE INDEX "OpeningBalanceDraft_organizationId_status_idx" ON "OpeningBalanceDraft" ("organizationId", "status");

CREATE TABLE "OpeningBalanceLine" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "openingBalanceDraftId" UUID NOT NULL, "accountId" UUID NOT NULL,
  "debitMinor" BIGINT NOT NULL DEFAULT 0, "creditMinor" BIGINT NOT NULL DEFAULT 0,
  "controlDifferenceMinor" BIGINT, "note" TEXT, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OpeningBalanceLine_draft_fkey" FOREIGN KEY ("openingBalanceDraftId") REFERENCES "OpeningBalanceDraft"("id") ON DELETE CASCADE,
  CONSTRAINT "OpeningBalanceLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "OpeningBalanceLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  CONSTRAINT "OpeningBalanceLine_side_check" CHECK (("debitMinor" > 0 AND "creditMinor" = 0) OR ("creditMinor" > 0 AND "debitMinor" = 0)),
  UNIQUE ("openingBalanceDraftId", "accountId")
);
CREATE INDEX "OpeningBalanceLine_organizationId_accountId_idx" ON "OpeningBalanceLine" ("organizationId", "accountId");

CREATE TABLE "BusinessDefaults" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL UNIQUE,
  "version" INTEGER NOT NULL DEFAULT 1, "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
  "invoicePrefix" TEXT NOT NULL DEFAULT 'INV', "invoiceNextPlaceholder" TEXT NOT NULL DEFAULT '0001',
  "estimatePrefix" TEXT NOT NULL DEFAULT 'EST', "estimateNextPlaceholder" TEXT NOT NULL DEFAULT '0001',
  "taxCalculationMode" "TaxCalculationMode" NOT NULL DEFAULT 'EXCLUSIVE', "customerNotes" TEXT,
  "paymentInstructions" TEXT, "dateFormat" TEXT NOT NULL DEFAULT 'yyyy-MM-dd',
  "numberFormat" TEXT NOT NULL DEFAULT 'en-CA', "showLogo" BOOLEAN NOT NULL DEFAULT true,
  "showBusinessNumber" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessDefaults_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "BusinessDefaults_terms_check" CHECK ("paymentTermsDays" BETWEEN 0 AND 365),
  CONSTRAINT "BusinessDefaults_plain_text_check" CHECK (
    COALESCE("customerNotes", '') !~* '<[[:space:]]*script' AND COALESCE("paymentInstructions", '') !~* '<[[:space:]]*script'
  )
);

CREATE TABLE "LogoAsset" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "organizationId" UUID NOT NULL,
  "storageKey" TEXT NOT NULL UNIQUE, "mediaType" TEXT NOT NULL, "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "checksum" CHAR(64) NOT NULL,
  "scanStatus" "LogoScanStatus" NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "replacedAt" TIMESTAMPTZ(6), "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LogoAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "LogoAsset_limits_check" CHECK ("byteSize" BETWEEN 1 AND 2097152 AND "width" BETWEEN 1 AND 2048 AND "height" BETWEEN 1 AND 2048),
  CONSTRAINT "LogoAsset_media_check" CHECK ("mediaType" IN ('image/png','image/jpeg','image/webp'))
);
CREATE INDEX "LogoAsset_organizationId_active_idx" ON "LogoAsset" ("organizationId", "active");
CREATE UNIQUE INDEX "LogoAsset_one_active_per_org" ON "LogoAsset" ("organizationId") WHERE "active";

CREATE OR REPLACE FUNCTION phase3_verify_tenant_references() RETURNS TRIGGER AS $$
DECLARE parent_org UUID; account_org UUID;
BEGIN
  IF TG_TABLE_NAME = 'TaxCodeVersion' THEN SELECT "organizationId" INTO parent_org FROM "TaxCode" WHERE "id" = NEW."taxCodeId";
  ELSIF TG_TABLE_NAME = 'TaxComponent' THEN
    SELECT "organizationId" INTO parent_org FROM "TaxCodeVersion" WHERE "id" = NEW."taxCodeVersionId";
    IF NEW."payableAccountId" IS NOT NULL THEN SELECT "organizationId" INTO account_org FROM "Account" WHERE "id" = NEW."payableAccountId"; IF account_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Tax payable account must belong to organization'; END IF; END IF;
    IF NEW."recoverableAccountId" IS NOT NULL THEN SELECT "organizationId" INTO account_org FROM "Account" WHERE "id" = NEW."recoverableAccountId"; IF account_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Tax recoverable account must belong to organization'; END IF; END IF;
  ELSIF TG_TABLE_NAME = 'OpeningBalanceLine' THEN
    SELECT "organizationId" INTO parent_org FROM "OpeningBalanceDraft" WHERE "id" = NEW."openingBalanceDraftId";
    SELECT "organizationId" INTO account_org FROM "Account" WHERE "id" = NEW."accountId";
    IF account_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Opening balance account must belong to organization'; END IF;
  END IF;
  IF parent_org IS NULL OR parent_org IS DISTINCT FROM NEW."organizationId" THEN RAISE EXCEPTION 'Phase 3 child organization must match parent'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "TaxCodeVersion_tenant_reference" BEFORE INSERT OR UPDATE ON "TaxCodeVersion" FOR EACH ROW EXECUTE FUNCTION phase3_verify_tenant_references();
CREATE TRIGGER "TaxComponent_tenant_reference" BEFORE INSERT OR UPDATE ON "TaxComponent" FOR EACH ROW EXECUTE FUNCTION phase3_verify_tenant_references();
CREATE TRIGGER "OpeningBalanceLine_tenant_reference" BEFORE INSERT OR UPDATE ON "OpeningBalanceLine" FOR EACH ROW EXECUTE FUNCTION phase3_verify_tenant_references();

CREATE OR REPLACE FUNCTION prevent_phase3_history_mutation() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Effective-dated tax and posted opening-balance history is immutable'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "TaxCodeVersion_immutable_update" BEFORE UPDATE OR DELETE ON "TaxCodeVersion" FOR EACH ROW EXECUTE FUNCTION prevent_phase3_history_mutation();
CREATE TRIGGER "TaxComponent_immutable_update" BEFORE UPDATE OR DELETE ON "TaxComponent" FOR EACH ROW EXECUTE FUNCTION prevent_phase3_history_mutation();

CREATE OR REPLACE FUNCTION protect_organization_accounting_settings() RETURNS TRIGGER AS $$
BEGIN
  IF NEW."baseCurrency" IS DISTINCT FROM OLD."baseCurrency" AND EXISTS (
    SELECT 1 FROM "Journal" WHERE "organizationId" = OLD."organizationId" AND "status" = 'POSTED'
  ) THEN RAISE EXCEPTION 'Base currency is locked after posted financial activity'; END IF;
  IF (NEW."accountingStartDate", NEW."fiscalYearEndMonth", NEW."fiscalYearEndDay") IS DISTINCT FROM
     (OLD."accountingStartDate", OLD."fiscalYearEndMonth", OLD."fiscalYearEndDay") AND EXISTS (
    SELECT 1 FROM "FiscalPeriod" WHERE "organizationId" = OLD."organizationId"
  ) THEN RAISE EXCEPTION 'Fiscal settings are locked after fiscal periods exist'; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "OrganizationSettings_accounting_lock" BEFORE UPDATE ON "OrganizationSettings"
FOR EACH ROW EXECUTE FUNCTION protect_organization_accounting_settings();

CREATE OR REPLACE FUNCTION protect_opening_balance_history() RETURNS TRIGGER AS $$
DECLARE draft_status "OpeningBalanceStatus";
BEGIN
  IF TG_TABLE_NAME = 'OpeningBalanceDraft' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Posted opening balances are immutable'; END IF;
      RETURN OLD;
    END IF;
    IF OLD."status" = 'DRAFT' AND NEW."status" = 'POSTED' AND NOT EXISTS (
      SELECT 1 FROM "Journal" WHERE "id" = NEW."journalId" AND "organizationId" = OLD."organizationId"
        AND "sourceType" = 'opening_balance' AND "sourceId" = OLD."id"::text AND "status" = 'POSTED'
    ) THEN RAISE EXCEPTION 'Opening balance posting must reference its posted Phase 1 journal';
    ELSIF OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED' AND EXISTS (
      SELECT 1 FROM "Journal" WHERE "organizationId" = OLD."organizationId"
        AND "reversedJournalId" = OLD."journalId" AND "status" = 'POSTED'
    ) THEN RETURN NEW;
    ELSIF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Posted opening balances are immutable'; END IF;
    RETURN NEW;
  END IF;
  SELECT "status" INTO draft_status FROM "OpeningBalanceDraft" WHERE "id" = COALESCE(NEW."openingBalanceDraftId", OLD."openingBalanceDraftId");
  IF draft_status <> 'DRAFT' THEN RAISE EXCEPTION 'Posted opening balance lines are immutable'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER "OpeningBalanceDraft_immutable" BEFORE UPDATE OR DELETE ON "OpeningBalanceDraft" FOR EACH ROW EXECUTE FUNCTION protect_opening_balance_history();
CREATE TRIGGER "OpeningBalanceLine_immutable" BEFORE UPDATE OR DELETE ON "OpeningBalanceLine" FOR EACH ROW EXECUTE FUNCTION protect_opening_balance_history();

INSERT INTO "OrganizationSettings" ("organizationId", "baseCurrency", "timeZone")
SELECT "id", "currency", "timezone" FROM "Organization" ON CONFLICT DO NOTHING;
INSERT INTO "SetupStepState" ("organizationId", "step") SELECT o."id", s.step
FROM "Organization" o CROSS JOIN unnest(enum_range(NULL::"SetupStep")) s(step) ON CONFLICT DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON "OrganizationSettings", "SetupStepState", "AppliedAccountPreset",
  "TaxRegistration", "TaxCode", "TaxCodeVersion", "TaxComponent", "OpeningBalanceDraft",
  "OpeningBalanceLine", "BusinessDefaults", "LogoAsset" TO clearledger_runtime;

DO $$ DECLARE table_name TEXT; BEGIN FOREACH table_name IN ARRAY ARRAY[
  'OrganizationSettings','SetupStepState','AppliedAccountPreset','TaxRegistration','TaxCode',
  'TaxCodeVersion','TaxComponent','OpeningBalanceDraft','OpeningBalanceLine','BusinessDefaults','LogoAsset'
] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())', table_name || '_tenant_policy', table_name);
END LOOP; END $$;
