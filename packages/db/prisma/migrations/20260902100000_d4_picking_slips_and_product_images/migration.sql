-- D4: tenant-owned print thumbnails, bin-ordered picking slips, and
-- non-posting short-pick review links. These records never change inventory
-- quantities or create accounting entries by themselves.

CREATE TYPE "ProductImageSourceKind" AS ENUM ('CATALOG', 'MANUAL');
CREATE TYPE "PickingSlipStatus" AS ENUM ('OPEN', 'PICKED', 'SHORT_PICK');

CREATE TABLE "ProductImageAsset" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "productItemId" UUID NOT NULL,
  "catalogImageId" UUID,
  "sourceKind" "ProductImageSourceKind" NOT NULL,
  "sourceUrlHash" CHAR(64) NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mediaType" VARCHAR(120) NOT NULL DEFAULT 'image/jpeg',
  "byteSize" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductImageAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductImageAsset_source_hash_check" CHECK ("sourceUrlHash" ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT "ProductImageAsset_checksum_check" CHECK ("checksum" ~ '^[0-9a-fA-F]{64}$'),
  CONSTRAINT "ProductImageAsset_dimensions_check" CHECK (
    "byteSize" > 0 AND "width" > 0 AND "height" > 0
  )
);

ALTER TABLE "ProductImageAsset"
  ADD CONSTRAINT "ProductImageAsset_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "ProductImageAsset"
  ADD CONSTRAINT "ProductImageAsset_organization_product_fkey"
  FOREIGN KEY ("organizationId", "productItemId")
  REFERENCES "ProductItem"("organizationId", "id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "ProductImageAsset_storageKey_key"
  ON "ProductImageAsset"("storageKey");
CREATE UNIQUE INDEX "ProductImageAsset_organizationId_id_key"
  ON "ProductImageAsset"("organizationId", "id");
CREATE UNIQUE INDEX "ProductImageAsset_organizationId_productItemId_sourceUrlHash_key"
  ON "ProductImageAsset"("organizationId", "productItemId", "sourceUrlHash");
CREATE INDEX "ProductImageAsset_organizationId_productItemId_createdAt_idx"
  ON "ProductImageAsset"("organizationId", "productItemId", "createdAt");
CREATE INDEX "ProductImageAsset_organizationId_catalogImageId_idx"
  ON "ProductImageAsset"("organizationId", "catalogImageId");

ALTER TABLE "ProductImageAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProductImageAsset" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ProductImageAsset_tenant_policy" ON "ProductImageAsset"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );
GRANT SELECT, INSERT, UPDATE ON "ProductImageAsset" TO clearledger_runtime;

CREATE TABLE "PickingSlip" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "status" "PickingSlipStatus" NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "PickingSlip_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PickingSlip_version_check" CHECK ("version" > 0)
);

ALTER TABLE "PickingSlip"
  ADD CONSTRAINT "PickingSlip_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "PickingSlip"
  ADD CONSTRAINT "PickingSlip_organization_invoice_fkey"
  FOREIGN KEY ("organizationId", "invoiceId")
  REFERENCES "Invoice"("organizationId", "id") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "PickingSlip_invoiceId_key" ON "PickingSlip"("invoiceId");
CREATE UNIQUE INDEX "PickingSlip_organizationId_id_key" ON "PickingSlip"("organizationId", "id");
CREATE UNIQUE INDEX "PickingSlip_organizationId_invoiceId_key"
  ON "PickingSlip"("organizationId", "invoiceId");
CREATE INDEX "PickingSlip_organizationId_status_createdAt_idx"
  ON "PickingSlip"("organizationId", "status", "createdAt");

ALTER TABLE "PickingSlip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PickingSlip" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PickingSlip_tenant_policy" ON "PickingSlip"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );
GRANT SELECT, INSERT, UPDATE ON "PickingSlip" TO clearledger_runtime;

CREATE TABLE "PickingSlipLine" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "pickingSlipId" UUID NOT NULL,
  "invoiceLineId" UUID NOT NULL,
  "productItemId" UUID,
  "lineNumber" INTEGER NOT NULL,
  "descriptionSnapshot" TEXT NOT NULL,
  "variantAttributes" JSONB,
  "skuSnapshot" TEXT,
  "barcodeSnapshot" TEXT,
  "quantityToPick" BIGINT NOT NULL,
  "pickedQuantityMicros" BIGINT,
  "locationId" UUID,
  "binId" UUID,
  "locationSnapshot" TEXT,
  "binSnapshot" TEXT,
  "binPriority" INTEGER,
  "imageAssetId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PickingSlipLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PickingSlipLine_line_number_check" CHECK ("lineNumber" > 0),
  CONSTRAINT "PickingSlipLine_quantity_check" CHECK (
    "quantityToPick" > 0
    AND ("pickedQuantityMicros" IS NULL OR ("pickedQuantityMicros" >= 0 AND "pickedQuantityMicros" <= "quantityToPick"))
  )
);

ALTER TABLE "PickingSlipLine"
  ADD CONSTRAINT "PickingSlipLine_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "PickingSlipLine"
  ADD CONSTRAINT "PickingSlipLine_organization_pickingSlip_fkey"
  FOREIGN KEY ("organizationId", "pickingSlipId")
  REFERENCES "PickingSlip"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "PickingSlipLine"
  ADD CONSTRAINT "PickingSlipLine_invoiceLine_fkey"
  FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE RESTRICT;
ALTER TABLE "PickingSlipLine"
  ADD CONSTRAINT "PickingSlipLine_product_fkey"
  FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT;
ALTER TABLE "PickingSlipLine"
  ADD CONSTRAINT "PickingSlipLine_location_fkey"
  FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE SET NULL;
ALTER TABLE "PickingSlipLine"
  ADD CONSTRAINT "PickingSlipLine_bin_fkey"
  FOREIGN KEY ("binId") REFERENCES "InventoryBin"("id") ON DELETE SET NULL;
ALTER TABLE "PickingSlipLine"
  ADD CONSTRAINT "PickingSlipLine_imageAsset_fkey"
  FOREIGN KEY ("imageAssetId") REFERENCES "ProductImageAsset"("id") ON DELETE SET NULL;

CREATE UNIQUE INDEX "PickingSlipLine_organizationId_id_key"
  ON "PickingSlipLine"("organizationId", "id");
CREATE UNIQUE INDEX "PickingSlipLine_pickingSlipId_lineNumber_key"
  ON "PickingSlipLine"("pickingSlipId", "lineNumber");
CREATE INDEX "PickingSlipLine_organizationId_pickingSlipId_locationId_binId_idx"
  ON "PickingSlipLine"("organizationId", "pickingSlipId", "locationId", "binId");
CREATE INDEX "PickingSlipLine_organizationId_productItemId_idx"
  ON "PickingSlipLine"("organizationId", "productItemId");

ALTER TABLE "PickingSlipLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PickingSlipLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PickingSlipLine_tenant_policy" ON "PickingSlipLine"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );
GRANT SELECT, INSERT, UPDATE ON "PickingSlipLine" TO clearledger_runtime;

CREATE TABLE "PickingSlipGeneration" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "pickingSlipId" UUID NOT NULL,
  "generationNumber" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "mediaType" VARCHAR(120) NOT NULL DEFAULT 'application/pdf',
  "generatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PickingSlipGeneration_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PickingSlipGeneration_number_check" CHECK ("generationNumber" > 0),
  CONSTRAINT "PickingSlipGeneration_file_check" CHECK ("byteSize" > 0 AND "pageCount" > 0),
  CONSTRAINT "PickingSlipGeneration_checksum_check" CHECK ("checksum" ~ '^[0-9a-fA-F]{64}$')
);

ALTER TABLE "PickingSlipGeneration"
  ADD CONSTRAINT "PickingSlipGeneration_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "PickingSlipGeneration"
  ADD CONSTRAINT "PickingSlipGeneration_organization_pickingSlip_fkey"
  FOREIGN KEY ("organizationId", "pickingSlipId")
  REFERENCES "PickingSlip"("organizationId", "id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "PickingSlipGeneration_storageKey_key"
  ON "PickingSlipGeneration"("storageKey");
CREATE UNIQUE INDEX "PickingSlipGeneration_organizationId_id_key"
  ON "PickingSlipGeneration"("organizationId", "id");
CREATE UNIQUE INDEX "PickingSlipGeneration_pickingSlipId_generationNumber_key"
  ON "PickingSlipGeneration"("pickingSlipId", "generationNumber");
CREATE INDEX "PickingSlipGeneration_organizationId_pickingSlipId_createdAt_idx"
  ON "PickingSlipGeneration"("organizationId", "pickingSlipId", "createdAt");

ALTER TABLE "PickingSlipGeneration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PickingSlipGeneration" FORCE ROW LEVEL SECURITY;
CREATE POLICY "PickingSlipGeneration_tenant_policy" ON "PickingSlipGeneration"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );
GRANT SELECT, INSERT ON "PickingSlipGeneration" TO clearledger_runtime;

ALTER TABLE "InventoryCount" ADD COLUMN "pickingSlipId" UUID;
ALTER TABLE "InventoryCount"
  ADD CONSTRAINT "InventoryCount_pickingSlip_fkey"
  FOREIGN KEY ("pickingSlipId") REFERENCES "PickingSlip"("id") ON DELETE SET NULL;
CREATE INDEX "InventoryCount_organizationId_pickingSlipId_idx"
  ON "InventoryCount"("organizationId", "pickingSlipId");
