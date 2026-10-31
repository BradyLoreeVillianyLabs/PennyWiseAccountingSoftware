CREATE TYPE "IntercompanyTransactionStatus" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'POSTED', 'SETTLED', 'REJECTED');
CREATE TYPE "ConsolidationGroupStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE TABLE "IntercompanyTransaction" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "fromCompanyId" UUID NOT NULL,
  "toCompanyId" UUID NOT NULL,
  "status" "IntercompanyTransactionStatus" NOT NULL DEFAULT 'DRAFT',
  "amountMinor" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "effectiveDate" DATE NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "balanceEvidence" JSONB,
  "fromJournalId" UUID,
  "toJournalId" UUID,
  "createdByUserId" UUID NOT NULL,
  "approvedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IntercompanyTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntercompanyTransaction_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "IntercompanyTransaction_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "IntercompanyTransaction_description_check" CHECK (btrim("description") <> ''),
  CONSTRAINT "IntercompanyTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "IntercompanyTransaction_fromCompanyId_fkey" FOREIGN KEY ("fromCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "IntercompanyTransaction_toCompanyId_fkey" FOREIGN KEY ("toCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IntercompanyTransaction_organizationId_id_key" ON "IntercompanyTransaction"("organizationId", "id");
CREATE UNIQUE INDEX "IntercompanyTransaction_organizationId_sourceType_sourceId_key" ON "IntercompanyTransaction"("organizationId", "sourceType", "sourceId");
CREATE INDEX "IntercompanyTransaction_organizationId_status_effectiveDate_idx" ON "IntercompanyTransaction"("organizationId", "status", "effectiveDate");
CREATE INDEX "IntercompanyTransaction_fromCompanyId_status_idx" ON "IntercompanyTransaction"("fromCompanyId", "status");
CREATE INDEX "IntercompanyTransaction_toCompanyId_status_idx" ON "IntercompanyTransaction"("toCompanyId", "status");

CREATE TABLE "ConsolidationGroup" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "status" "ConsolidationGroupStatus" NOT NULL DEFAULT 'DRAFT',
  "baseCurrency" CHAR(3) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsolidationGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsolidationGroup_name_check" CHECK (btrim("name") <> ''),
  CONSTRAINT "ConsolidationGroup_currency_check" CHECK ("baseCurrency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ConsolidationGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConsolidationGroup_organizationId_id_key" ON "ConsolidationGroup"("organizationId", "id");
CREATE UNIQUE INDEX "ConsolidationGroup_organizationId_name_key" ON "ConsolidationGroup"("organizationId", "name");
CREATE INDEX "ConsolidationGroup_organizationId_status_idx" ON "ConsolidationGroup"("organizationId", "status");

CREATE TABLE "ConsolidationGroupMember" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "groupId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "eliminationPolicy" TEXT NOT NULL DEFAULT 'CONFIGURATION_REQUIRED',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsolidationGroupMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConsolidationGroupMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConsolidationGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ConsolidationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConsolidationGroupMember_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ConsolidationGroupMember_unique_group_company" UNIQUE ("groupId", "companyId"),
  CONSTRAINT "ConsolidationGroupMember_unique_organization_id" UNIQUE ("organizationId", "id")
);
CREATE INDEX "ConsolidationGroupMember_organizationId_groupId_active_idx" ON "ConsolidationGroupMember"("organizationId", "groupId", "active");

CREATE OR REPLACE FUNCTION validate_intercompany_references()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."fromCompanyId" = NEW."toCompanyId" THEN
    RAISE EXCEPTION 'Intercompany transaction requires two distinct companies';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = NEW."fromCompanyId" AND c."organizationId" = NEW."organizationId" AND c."status" = 'ACTIVE')
     OR NOT EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = NEW."toCompanyId" AND c."organizationId" = NEW."organizationId" AND c."status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'Intercompany companies must belong to the same active organization';
  END IF;
  IF NEW."status" = 'POSTED' AND (NEW."fromJournalId" IS NULL OR NEW."toJournalId" IS NULL OR NEW."balanceEvidence" IS NULL) THEN
    RAISE EXCEPTION 'Posted intercompany transactions require two linked journals and balance evidence';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" IN ('SETTLED', 'REJECTED') THEN
    RAISE EXCEPTION 'Settled or rejected intercompany transactions are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT (
    (OLD."status" = 'DRAFT' AND NEW."status" IN ('DRAFT', 'PROPOSED', 'REJECTED')) OR
    (OLD."status" = 'PROPOSED' AND NEW."status" IN ('PROPOSED', 'APPROVED', 'REJECTED')) OR
    (OLD."status" = 'APPROVED' AND NEW."status" IN ('APPROVED', 'POSTED', 'REJECTED')) OR
    (OLD."status" = 'POSTED' AND NEW."status" IN ('POSTED', 'SETTLED')) OR
    (OLD."status" = NEW."status")
  ) THEN
    RAISE EXCEPTION 'Invalid intercompany transaction state transition';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "IntercompanyTransaction_state_trigger" BEFORE INSERT OR UPDATE ON "IntercompanyTransaction" FOR EACH ROW EXECUTE FUNCTION validate_intercompany_references();

CREATE OR REPLACE FUNCTION validate_consolidation_member_reference()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ConsolidationGroup" g WHERE g."id" = NEW."groupId" AND g."organizationId" = NEW."organizationId" AND g."status" <> 'ARCHIVED')
     OR NOT EXISTS (SELECT 1 FROM "Company" c WHERE c."id" = NEW."companyId" AND c."organizationId" = NEW."organizationId" AND c."status" = 'ACTIVE') THEN
    RAISE EXCEPTION 'Consolidation members must belong to the same active organization';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ConsolidationGroupMember_reference_trigger" BEFORE INSERT OR UPDATE ON "ConsolidationGroupMember" FOR EACH ROW EXECUTE FUNCTION validate_consolidation_member_reference();

ALTER TABLE "IntercompanyTransaction" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "IntercompanyTransaction_tenant_policy" ON "IntercompanyTransaction" FOR ALL TO clearledger_runtime
USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
ALTER TABLE "ConsolidationGroup" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ConsolidationGroup_tenant_policy" ON "ConsolidationGroup" FOR ALL TO clearledger_runtime
USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
ALTER TABLE "ConsolidationGroupMember" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ConsolidationGroupMember_tenant_policy" ON "ConsolidationGroupMember" FOR ALL TO clearledger_runtime
USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "IntercompanyTransaction" TO clearledger_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConsolidationGroup" TO clearledger_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConsolidationGroupMember" TO clearledger_runtime;
