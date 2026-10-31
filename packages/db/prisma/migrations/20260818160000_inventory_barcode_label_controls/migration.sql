-- Tenant-safe barcode aliases and label-template scaffolding. These records
-- never change stock; only the existing inventory movement workflows may post
-- quantity or value changes.

CREATE TABLE "ProductBarcode" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "productItemId" UUID NOT NULL,
  "code" VARCHAR(200) NOT NULL,
  "normalizedCode" VARCHAR(200) NOT NULL,
  "symbology" VARCHAR(32) NOT NULL DEFAULT 'AUTO',
  "source" VARCHAR(80),
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductBarcode_code_check" CHECK (length(btrim("code")) BETWEEN 1 AND 200),
  CONSTRAINT "ProductBarcode_normalized_check" CHECK (
    "normalizedCode" = catalog_normalize_identifier("code")
    AND "normalizedCode" IS NOT NULL
  ),
  CONSTRAINT "ProductBarcode_symbology_check" CHECK (
    "symbology" IN ('AUTO', 'CODE128', 'CODE39', 'EAN8', 'EAN13', 'UPC_A', 'UPC_E', 'ITF14', 'QR', 'DATA_MATRIX')
  )
);

ALTER TABLE "ProductBarcode"
  ADD CONSTRAINT "ProductBarcode_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "ProductBarcode"
  ADD CONSTRAINT "ProductBarcode_organization_product_fkey"
  FOREIGN KEY ("organizationId", "productItemId")
  REFERENCES "ProductItem"("organizationId", "id") ON DELETE RESTRICT;
ALTER TABLE "ProductBarcode"
  ADD CONSTRAINT "ProductBarcode_organization_company_fkey"
  FOREIGN KEY ("organizationId", "companyId")
  REFERENCES "Company"("organizationId", "id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "ProductBarcode_organizationId_id_key"
  ON "ProductBarcode" ("organizationId", "id");
CREATE UNIQUE INDEX "ProductBarcode_organizationId_normalizedCode_key"
  ON "ProductBarcode" ("organizationId", "normalizedCode");
CREATE INDEX "ProductBarcode_organizationId_productItemId_active_idx"
  ON "ProductBarcode" ("organizationId", "productItemId", "active");
CREATE INDEX "ProductBarcode_organizationId_companyId_normalizedCode_active_idx"
  ON "ProductBarcode" ("organizationId", "companyId", "normalizedCode", "active");

ALTER TABLE "ProductBarcode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductBarcode" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ProductBarcode_tenant_policy" ON "ProductBarcode"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  );
GRANT SELECT, INSERT, UPDATE ON "ProductBarcode" TO clearledger_runtime;

CREATE TABLE "InventoryLabelTemplate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "name" VARCHAR(120) NOT NULL,
  "symbology" VARCHAR(32) NOT NULL DEFAULT 'CODE128',
  "widthMmMicros" BIGINT NOT NULL,
  "heightMmMicros" BIGINT NOT NULL,
  "fields" JSONB NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventoryLabelTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryLabelTemplate_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "InventoryLabelTemplate_dimensions_check" CHECK ("widthMmMicros" > 0 AND "heightMmMicros" > 0),
  CONSTRAINT "InventoryLabelTemplate_fields_check" CHECK (jsonb_typeof("fields") = 'array'),
  CONSTRAINT "InventoryLabelTemplate_version_check" CHECK ("version" > 0),
  CONSTRAINT "InventoryLabelTemplate_symbology_check" CHECK (
    "symbology" IN ('CODE128', 'CODE39', 'EAN8', 'EAN13', 'UPC_A', 'UPC_E', 'ITF14', 'QR', 'DATA_MATRIX')
  )
);

ALTER TABLE "InventoryLabelTemplate"
  ADD CONSTRAINT "InventoryLabelTemplate_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "InventoryLabelTemplate"
  ADD CONSTRAINT "InventoryLabelTemplate_organization_company_fkey"
  FOREIGN KEY ("organizationId", "companyId")
  REFERENCES "Company"("organizationId", "id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "InventoryLabelTemplate_organizationId_id_key"
  ON "InventoryLabelTemplate" ("organizationId", "id");
CREATE UNIQUE INDEX "InventoryLabelTemplate_organizationId_name_key"
  ON "InventoryLabelTemplate" ("organizationId", "name");
CREATE INDEX "InventoryLabelTemplate_organizationId_companyId_active_default_idx"
  ON "InventoryLabelTemplate" ("organizationId", "companyId", "active", "isDefault");

ALTER TABLE "InventoryLabelTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLabelTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InventoryLabelTemplate_tenant_policy" ON "InventoryLabelTemplate"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
    AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())
  );
GRANT SELECT, INSERT, UPDATE ON "InventoryLabelTemplate" TO clearledger_runtime;
