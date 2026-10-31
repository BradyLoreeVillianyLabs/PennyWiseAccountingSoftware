CREATE TYPE "FixedAssetStatus" AS ENUM (
  'DRAFT',
  'SUBMITTED',
  'REGISTERED',
  'REJECTED',
  'CANCELLED'
);
CREATE TYPE "BookDepreciationMethod" AS ENUM (
  'NONE',
  'STRAIGHT_LINE'
);
CREATE TYPE "BookDepreciationConvention" AS ENUM (
  'FULL_MONTH',
  'NEXT_MONTH'
);
CREATE TYPE "FixedAssetLedgerTreatment" AS ENUM (
  'UNDECIDED',
  'ALREADY_RECORDED',
  'OPENING_BALANCE',
  'RECLASSIFICATION_REQUIRED'
);
CREATE TYPE "FixedAssetSourceKind" AS ENUM (
  'MANUAL_REFERENCE'
);

CREATE TABLE "FixedAssetClass" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "isArchived" BOOLEAN NOT NULL DEFAULT false,
  "defaultBookMethod" "BookDepreciationMethod" NOT NULL,
  "defaultBookConvention" "BookDepreciationConvention",
  "defaultUsefulLifeMonths" INTEGER,
  "defaultResidualRatioMicros" BIGINT,
  "defaultAssetAccountId" UUID,
  "defaultAccumulatedAccountId" UUID,
  "defaultDepreciationExpenseId" UUID,
  "defaultDisposalGainAccountId" UUID,
  "defaultDisposalLossAccountId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FixedAssetClass_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FixedAssetClass_text_check" CHECK (
    length(trim("code")) > 0
    AND length(trim("name")) > 0
  ),
  CONSTRAINT "FixedAssetClass_version_check" CHECK ("version" > 0),
  CONSTRAINT "FixedAssetClass_defaults_check" CHECK (
    (
      "defaultBookMethod" = 'NONE'
      AND "defaultBookConvention" IS NULL
      AND "defaultUsefulLifeMonths" IS NULL
      AND "defaultResidualRatioMicros" IS NULL
    )
    OR (
      "defaultBookMethod" = 'STRAIGHT_LINE'
      AND "defaultBookConvention" IS NOT NULL
      AND "defaultUsefulLifeMonths" > 0
      AND "defaultUsefulLifeMonths" <= 1200
      AND (
        "defaultResidualRatioMicros" IS NULL
        OR (
          "defaultResidualRatioMicros" >= 0
          AND "defaultResidualRatioMicros" <= 1000000
        )
      )
    )
  ),
  CONSTRAINT "FixedAssetClass_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FixedAssetClass_asset_account_fkey"
    FOREIGN KEY ("organizationId", "defaultAssetAccountId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAssetClass_accumulated_account_fkey"
    FOREIGN KEY ("organizationId", "defaultAccumulatedAccountId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAssetClass_expense_account_fkey"
    FOREIGN KEY ("organizationId", "defaultDepreciationExpenseId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAssetClass_gain_account_fkey"
    FOREIGN KEY ("organizationId", "defaultDisposalGainAccountId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAssetClass_loss_account_fkey"
    FOREIGN KEY ("organizationId", "defaultDisposalLossAccountId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FixedAssetClass_organizationId_code_key"
  ON "FixedAssetClass"("organizationId", "code");
CREATE UNIQUE INDEX "FixedAssetClass_organizationId_id_key"
  ON "FixedAssetClass"("organizationId", "id");
CREATE INDEX "FixedAssetClass_organizationId_isArchived_name_idx"
  ON "FixedAssetClass"("organizationId", "isArchived", "name");
CREATE INDEX "FixedAssetClass_org_asset_account_idx"
  ON "FixedAssetClass"("organizationId", "defaultAssetAccountId");
CREATE INDEX "FixedAssetClass_org_accumulated_account_idx"
  ON "FixedAssetClass"("organizationId", "defaultAccumulatedAccountId");
CREATE INDEX "FixedAssetClass_org_depreciation_expense_idx"
  ON "FixedAssetClass"("organizationId", "defaultDepreciationExpenseId");
CREATE INDEX "FixedAssetClass_org_disposal_gain_idx"
  ON "FixedAssetClass"("organizationId", "defaultDisposalGainAccountId");
CREATE INDEX "FixedAssetClass_org_disposal_loss_idx"
  ON "FixedAssetClass"("organizationId", "defaultDisposalLossAccountId");

CREATE TABLE "FixedAsset" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "fixedAssetClassId" UUID NOT NULL,
  "classVersionSnapshot" INTEGER NOT NULL,
  "assetNumber" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" "FixedAssetStatus" NOT NULL DEFAULT 'DRAFT',
  "acquiredOn" DATE NOT NULL,
  "inServiceOn" DATE NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
  "acquisitionCostMinor" BIGINT NOT NULL,
  "residualValueMinor" BIGINT NOT NULL,
  "residualRatioMicrosSnapshot" BIGINT,
  "openingAccumulatedDepreciationMinor" BIGINT NOT NULL DEFAULT 0,
  "openingBalanceDate" DATE,
  "remainingUsefulLifeMonths" INTEGER,
  "bookMethod" "BookDepreciationMethod" NOT NULL,
  "bookConvention" "BookDepreciationConvention",
  "usefulLifeMonths" INTEGER,
  "ledgerTreatment" "FixedAssetLedgerTreatment" NOT NULL DEFAULT 'UNDECIDED',
  "sourceKind" "FixedAssetSourceKind" NOT NULL DEFAULT 'MANUAL_REFERENCE',
  "sourceReference" TEXT NOT NULL,
  "assetAccountId" UUID,
  "accumulatedDepreciationAccountId" UUID,
  "depreciationExpenseAccountId" UUID,
  "disposalGainAccountId" UUID,
  "disposalLossAccountId" UUID,
  "serialNumber" TEXT,
  "location" TEXT,
  "notes" TEXT,
  "submittedAt" TIMESTAMPTZ(6),
  "registeredAt" TIMESTAMPTZ(6),
  "registeredByUserId" UUID,
  "rejectedAt" TIMESTAMPTZ(6),
  "rejectedByUserId" UUID,
  "cancelledAt" TIMESTAMPTZ(6),
  "cancelledByUserId" UUID,
  "decisionNote" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FixedAsset_text_check" CHECK (
    length(trim("assetNumber")) > 0
    AND length(trim("name")) > 0
    AND length(trim("sourceReference")) > 0
  ),
  CONSTRAINT "FixedAsset_version_check" CHECK (
    "version" > 0
    AND "classVersionSnapshot" > 0
  ),
  CONSTRAINT "FixedAsset_currency_check" CHECK ("currency" = 'CAD'),
  CONSTRAINT "FixedAsset_dates_check" CHECK ("acquiredOn" <= "inServiceOn"),
  CONSTRAINT "FixedAsset_amounts_check" CHECK (
    "acquisitionCostMinor" > 0
    AND "residualValueMinor" >= 0
    AND "residualValueMinor" <= "acquisitionCostMinor"
    AND "openingAccumulatedDepreciationMinor" >= 0
    AND "openingAccumulatedDepreciationMinor"
      <= "acquisitionCostMinor" - "residualValueMinor"
    AND (
      "residualRatioMicrosSnapshot" IS NULL
      OR (
        "residualRatioMicrosSnapshot" >= 0
        AND "residualRatioMicrosSnapshot" <= 1000000
      )
    )
  ),
  CONSTRAINT "FixedAsset_book_configuration_check" CHECK (
    (
      "bookMethod" = 'NONE'
      AND "bookConvention" IS NULL
      AND "usefulLifeMonths" IS NULL
      AND "openingBalanceDate" IS NULL
      AND "remainingUsefulLifeMonths" IS NULL
      AND "openingAccumulatedDepreciationMinor"
        = "acquisitionCostMinor" - "residualValueMinor"
    )
    OR (
      "bookMethod" = 'STRAIGHT_LINE'
      AND "bookConvention" IS NOT NULL
      AND "usefulLifeMonths" > 0
      AND "usefulLifeMonths" <= 1200
      AND (
        (
          "openingBalanceDate" IS NULL
          AND "remainingUsefulLifeMonths" IS NULL
          AND "openingAccumulatedDepreciationMinor" = 0
        )
        OR (
          "openingBalanceDate" IS NOT NULL
          AND "openingBalanceDate" >= "inServiceOn"
          AND "remainingUsefulLifeMonths" > 0
          AND "remainingUsefulLifeMonths" <= "usefulLifeMonths"
        )
      )
    )
  ),
  CONSTRAINT "FixedAsset_status_metadata_check" CHECK (
    ("status" <> 'SUBMITTED' OR "submittedAt" IS NOT NULL)
    AND (
      "status" <> 'REGISTERED'
      OR (
        "registeredAt" IS NOT NULL
        AND "registeredByUserId" IS NOT NULL
        AND "ledgerTreatment" <> 'UNDECIDED'
      )
    )
    AND (
      "status" <> 'REJECTED'
      OR ("rejectedAt" IS NOT NULL AND "rejectedByUserId" IS NOT NULL)
    )
    AND (
      "status" <> 'CANCELLED'
      OR ("cancelledAt" IS NOT NULL AND "cancelledByUserId" IS NOT NULL)
    )
  ),
  CONSTRAINT "FixedAsset_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FixedAsset_class_fkey"
    FOREIGN KEY ("organizationId", "fixedAssetClassId")
    REFERENCES "FixedAssetClass"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAsset_asset_account_fkey"
    FOREIGN KEY ("organizationId", "assetAccountId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAsset_accumulated_account_fkey"
    FOREIGN KEY ("organizationId", "accumulatedDepreciationAccountId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAsset_expense_account_fkey"
    FOREIGN KEY ("organizationId", "depreciationExpenseAccountId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAsset_gain_account_fkey"
    FOREIGN KEY ("organizationId", "disposalGainAccountId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FixedAsset_loss_account_fkey"
    FOREIGN KEY ("organizationId", "disposalLossAccountId")
    REFERENCES "Account"("organizationId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FixedAsset_organizationId_assetNumber_key"
  ON "FixedAsset"("organizationId", "assetNumber");
CREATE UNIQUE INDEX "FixedAsset_organizationId_id_key"
  ON "FixedAsset"("organizationId", "id");
CREATE INDEX "FixedAsset_organizationId_status_inServiceOn_idx"
  ON "FixedAsset"("organizationId", "status", "inServiceOn");
CREATE INDEX "FixedAsset_organizationId_class_status_idx"
  ON "FixedAsset"("organizationId", "fixedAssetClassId", "status");
CREATE INDEX "FixedAsset_org_asset_account_idx"
  ON "FixedAsset"("organizationId", "assetAccountId");
CREATE INDEX "FixedAsset_org_accumulated_account_idx"
  ON "FixedAsset"("organizationId", "accumulatedDepreciationAccountId");
CREATE INDEX "FixedAsset_org_depreciation_expense_idx"
  ON "FixedAsset"("organizationId", "depreciationExpenseAccountId");
CREATE INDEX "FixedAsset_org_disposal_gain_idx"
  ON "FixedAsset"("organizationId", "disposalGainAccountId");
CREATE INDEX "FixedAsset_org_disposal_loss_idx"
  ON "FixedAsset"("organizationId", "disposalLossAccountId");

ALTER TABLE "FixedAssetClass" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "FixedAssetClass_tenant_policy"
  ON "FixedAssetClass"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );

ALTER TABLE "FixedAsset" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "FixedAsset_tenant_policy"
  ON "FixedAsset"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  "FixedAssetClass",
  "FixedAsset"
TO clearledger_runtime;
