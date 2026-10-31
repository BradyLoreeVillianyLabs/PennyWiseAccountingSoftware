CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

CREATE TABLE "Company" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "legalName" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
  "baseCurrency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "timezone" TEXT NOT NULL DEFAULT 'America/Edmonton',
  "fiscalYearEndMonth" INTEGER,
  "fiscalYearEndDay" INTEGER,
  "locale" TEXT NOT NULL DEFAULT 'en-CA',
  "setupStatus" TEXT NOT NULL DEFAULT 'INCOMPLETE',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Company_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Company_name_check" CHECK (btrim("legalName") <> '' AND btrim("displayName") <> ''),
  CONSTRAINT "Company_currency_check" CHECK ("baseCurrency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "Company_fiscal_month_check" CHECK ("fiscalYearEndMonth" IS NULL OR "fiscalYearEndMonth" BETWEEN 1 AND 12),
  CONSTRAINT "Company_fiscal_day_check" CHECK ("fiscalYearEndDay" IS NULL OR "fiscalYearEndDay" BETWEEN 1 AND 31),
  CONSTRAINT "Company_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Company_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Company_organizationId_id_key" ON "Company"("organizationId", "id");
CREATE INDEX "Company_organizationId_status_displayName_idx" ON "Company"("organizationId", "status", "displayName");
CREATE UNIQUE INDEX "Company_one_default_per_organization_key" ON "Company"("organizationId") WHERE "isDefault" = true;

CREATE TABLE "CompanyMembership" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanyMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompanyMembership_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompanyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CompanyMembership_unique_company_user" UNIQUE ("companyId", "userId"),
  CONSTRAINT "CompanyMembership_unique_organization_id" UNIQUE ("organizationId", "id")
);

CREATE INDEX "CompanyMembership_organizationId_userId_status_idx" ON "CompanyMembership"("organizationId", "userId", "status");
CREATE INDEX "CompanyMembership_companyId_status_role_idx" ON "CompanyMembership"("companyId", "status", "role");

ALTER TABLE "Session" ADD COLUMN "activeCompanyId" UUID;
ALTER TABLE "Session" ADD CONSTRAINT "Session_activeCompanyId_fkey" FOREIGN KEY ("activeCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Session_activeCompanyId_userId_idx" ON "Session"("activeCompanyId", "userId");

ALTER TABLE "Account" ADD COLUMN "companyId" UUID;
ALTER TABLE "FiscalPeriod" ADD COLUMN "companyId" UUID;
ALTER TABLE "Journal" ADD COLUMN "companyId" UUID;
ALTER TABLE "JournalLine" ADD COLUMN "companyId" UUID;

ALTER TABLE "Account" ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FiscalPeriod" ADD CONSTRAINT "FiscalPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Account_organizationId_companyId_code_idx" ON "Account"("organizationId", "companyId", "code");
CREATE INDEX "FiscalPeriod_organizationId_companyId_status_idx" ON "FiscalPeriod"("organizationId", "companyId", "status");
CREATE INDEX "Journal_organizationId_companyId_effectiveDate_idx" ON "Journal"("organizationId", "companyId", "effectiveDate");
CREATE INDEX "JournalLine_organizationId_companyId_accountId_idx" ON "JournalLine"("organizationId", "companyId", "accountId");

-- Every pre-existing organization receives exactly one immutable default company.
-- The owner membership supplies the creator identity required by the audit model.
INSERT INTO "Company" (
  "id", "organizationId", "legalName", "displayName", "baseCurrency", "timezone",
  "locale", "setupStatus", "isDefault", "createdByUserId", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  o."id",
  o."legalName",
  o."displayName",
  COALESCE(NULLIF(s."baseCurrency", ''), o."currency"),
  COALESCE(NULLIF(s."timeZone", ''), o."timezone"),
  COALESCE(NULLIF(s."locale", ''), 'en-CA'),
  CASE WHEN s."setupCompletedAt" IS NULL THEN 'INCOMPLETE' ELSE 'COMPLETE' END,
  true,
  owner."userId",
  o."createdAt",
  o."updatedAt"
FROM "Organization" o
JOIN LATERAL (
  SELECT m."userId"
  FROM "Membership" m
  WHERE m."organizationId" = o."id" AND m."role" = 'OWNER' AND m."status" = 'ACTIVE'
  ORDER BY m."createdAt", m."id"
  LIMIT 1
) owner ON true
LEFT JOIN "OrganizationSettings" s ON s."organizationId" = o."id";

UPDATE "Account" a
SET "companyId" = c."id"
FROM "Company" c
WHERE c."organizationId" = a."organizationId" AND c."isDefault" = true;
UPDATE "FiscalPeriod" p
SET "companyId" = c."id"
FROM "Company" c
WHERE c."organizationId" = p."organizationId" AND c."isDefault" = true;
-- Backfilling provenance is metadata-only. Existing posted-journal triggers
-- intentionally reject ordinary updates, so suspend user triggers for this
-- one transactional backfill and restore them immediately afterwards.
ALTER TABLE "Journal" DISABLE TRIGGER USER;
ALTER TABLE "JournalLine" DISABLE TRIGGER USER;
UPDATE "Journal" j
SET "companyId" = c."id"
FROM "Company" c
WHERE c."organizationId" = j."organizationId" AND c."isDefault" = true;
UPDATE "JournalLine" l
SET "companyId" = c."id"
FROM "Company" c
WHERE c."organizationId" = l."organizationId" AND c."isDefault" = true;
ALTER TABLE "JournalLine" ENABLE TRIGGER USER;
ALTER TABLE "Journal" ENABLE TRIGGER USER;

INSERT INTO "CompanyMembership" ("id", "organizationId", "companyId", "userId", "role", "status")
SELECT gen_random_uuid(), c."organizationId", c."id", m."userId", m."role", m."status"
FROM "Company" c
JOIN "Membership" m ON m."organizationId" = c."organizationId" AND m."status" = 'ACTIVE';

UPDATE "Session" s
SET "activeCompanyId" = c."id"
FROM "Company" c
WHERE s."activeOrganizationId" = c."organizationId" AND c."isDefault" = true;

CREATE OR REPLACE FUNCTION validate_company_tenant_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."companyId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Company" c
    WHERE c."id" = NEW."companyId" AND c."organizationId" = NEW."organizationId" AND c."status" <> 'ARCHIVED'
  ) THEN
    RAISE EXCEPTION 'Company must belong to the record organization and be active';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Account_company_tenant_trigger" BEFORE INSERT OR UPDATE OF "organizationId", "companyId" ON "Account" FOR EACH ROW EXECUTE FUNCTION validate_company_tenant_reference();
CREATE TRIGGER "FiscalPeriod_company_tenant_trigger" BEFORE INSERT OR UPDATE OF "organizationId", "companyId" ON "FiscalPeriod" FOR EACH ROW EXECUTE FUNCTION validate_company_tenant_reference();
CREATE TRIGGER "Journal_company_tenant_trigger" BEFORE INSERT OR UPDATE OF "organizationId", "companyId" ON "Journal" FOR EACH ROW EXECUTE FUNCTION validate_company_tenant_reference();
CREATE TRIGGER "JournalLine_company_tenant_trigger" BEFORE INSERT OR UPDATE OF "organizationId", "companyId" ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION validate_company_tenant_reference();

CREATE OR REPLACE FUNCTION validate_company_membership_tenant_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = NEW."companyId" AND c."organizationId" = NEW."organizationId") THEN
    RAISE EXCEPTION 'Company membership must belong to the same organization as its company';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Membership" m WHERE m."organizationId" = NEW."organizationId" AND m."userId" = NEW."userId" AND m."status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'Company membership requires an active organization membership';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "CompanyMembership_tenant_reference_trigger" BEFORE INSERT OR UPDATE ON "CompanyMembership" FOR EACH ROW EXECUTE FUNCTION validate_company_membership_tenant_reference();

ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company_tenant_policy" ON "Company" FOR ALL TO clearledger_runtime
USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
ALTER TABLE "CompanyMembership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CompanyMembership_tenant_policy" ON "CompanyMembership" FOR ALL TO clearledger_runtime
USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Company" TO clearledger_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "CompanyMembership" TO clearledger_runtime;
