-- Tenant-scoped catalog reconciliation and non-posting inventory synchronization
-- evidence. No table in this migration can create a journal or inventory movement.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "CatalogMatchStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED');
CREATE TYPE "CatalogImageIngestionStatus" AS ENUM ('OBSERVED', 'APPROVED', 'REJECTED', 'INGESTED');
CREATE TYPE "InventorySyncSourceOfTruth" AS ENUM ('LOCAL', 'CHANNEL', 'MANUAL_REVIEW');
CREATE TYPE "InventorySyncConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

CREATE OR REPLACE FUNCTION catalog_normalize_identifier(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(upper(regexp_replace(btrim(value), '[^[:alnum:]]+', '', 'g')), '')
$$;

ALTER TABLE "ProductItem"
  ADD COLUMN "normalizedSku" VARCHAR(200),
  ADD COLUMN "gtin" VARCHAR(32),
  ADD COLUMN "normalizedGtin" VARCHAR(32),
  ADD COLUMN "manufacturer" VARCHAR(200),
  ADD COLUMN "normalizedManufacturer" VARCHAR(200),
  ADD COLUMN "manufacturerPartNumber" VARCHAR(200),
  ADD COLUMN "normalizedManufacturerPartNumber" VARCHAR(200);

UPDATE "ProductItem"
SET "normalizedSku" = catalog_normalize_identifier("sku")
WHERE "sku" IS NOT NULL;

CREATE OR REPLACE FUNCTION normalize_product_catalog_identifiers()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."normalizedSku" := catalog_normalize_identifier(NEW."sku");
  NEW."normalizedGtin" := catalog_normalize_identifier(NEW."gtin");
  NEW."normalizedManufacturer" := catalog_normalize_identifier(NEW."manufacturer");
  NEW."normalizedManufacturerPartNumber" := catalog_normalize_identifier(NEW."manufacturerPartNumber");
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductItem_catalog_identifier_normalization"
BEFORE INSERT OR UPDATE OF "sku", "gtin", "manufacturer", "manufacturerPartNumber"
ON "ProductItem"
FOR EACH ROW EXECUTE FUNCTION normalize_product_catalog_identifiers();

CREATE UNIQUE INDEX "ProductItem_organizationId_id_key"
  ON "ProductItem" ("organizationId", "id");
CREATE INDEX "ProductItem_organizationId_normalizedSku_idx"
  ON "ProductItem" ("organizationId", "normalizedSku");
CREATE INDEX "ProductItem_organizationId_normalizedGtin_idx"
  ON "ProductItem" ("organizationId", "normalizedGtin");
CREATE INDEX "ProductItem_org_manufacturer_part_idx"
  ON "ProductItem" ("organizationId", "normalizedManufacturer", "normalizedManufacturerPartNumber");
CREATE INDEX "ProductItem_name_trgm_idx"
  ON "ProductItem" USING gin (lower("name") gin_trgm_ops);

CREATE TABLE "ExternalCatalogProduct" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "externalProductId" VARCHAR(200) NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" VARCHAR(500) NOT NULL,
  "description" TEXT,
  "sourceStatus" VARCHAR(80),
  "sourceUrl" TEXT,
  "sourceHash" CHAR(64) NOT NULL,
  "providerUpdatedAt" TIMESTAMPTZ(6),
  "firstObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ExternalCatalogProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalCatalogProduct_source_hash_check" CHECK ("sourceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ExternalCatalogProduct_version_check" CHECK ("version" > 0),
  CONSTRAINT "ExternalCatalogProduct_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 500),
  CONSTRAINT "ExternalCatalogProduct_source_url_check" CHECK ("sourceUrl" IS NULL OR "sourceUrl" ~ '^https://')
);

CREATE TABLE "ExternalCatalogVariant" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "catalogProductId" UUID NOT NULL,
  "externalVariantId" VARCHAR(200) NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" VARCHAR(500) NOT NULL,
  "sku" VARCHAR(200),
  "normalizedSku" VARCHAR(200),
  "gtin" VARCHAR(32),
  "normalizedGtin" VARCHAR(32),
  "manufacturer" VARCHAR(200),
  "normalizedManufacturer" VARCHAR(200),
  "manufacturerPartNumber" VARCHAR(200),
  "normalizedManufacturerPartNumber" VARCHAR(200),
  "variantSignature" JSONB NOT NULL,
  "normalizedVariantSignature" VARCHAR(1000) NOT NULL,
  "sourceStatus" VARCHAR(80),
  "sourceHash" CHAR(64) NOT NULL,
  "providerUpdatedAt" TIMESTAMPTZ(6),
  "firstObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ExternalCatalogVariant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalCatalogVariant_source_hash_check" CHECK ("sourceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "ExternalCatalogVariant_version_check" CHECK ("version" > 0),
  CONSTRAINT "ExternalCatalogVariant_signature_object_check" CHECK (jsonb_typeof("variantSignature") = 'object'),
  CONSTRAINT "ExternalCatalogVariant_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 500),
  CONSTRAINT "ExternalCatalogVariant_normalized_identifiers_check" CHECK (
    "normalizedSku" IS NOT DISTINCT FROM catalog_normalize_identifier("sku")
    AND "normalizedGtin" IS NOT DISTINCT FROM catalog_normalize_identifier("gtin")
    AND "normalizedManufacturer" IS NOT DISTINCT FROM catalog_normalize_identifier("manufacturer")
    AND "normalizedManufacturerPartNumber" IS NOT DISTINCT FROM catalog_normalize_identifier("manufacturerPartNumber")
  )
);

CREATE TABLE "CatalogMatchCandidate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "catalogVariantId" UUID NOT NULL,
  "productItemId" UUID NOT NULL,
  "status" "CatalogMatchStatus" NOT NULL DEFAULT 'SUGGESTED',
  "score" INTEGER NOT NULL,
  "reason" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "resolvedAt" TIMESTAMPTZ(6),
  "resolvedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "CatalogMatchCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogMatchCandidate_score_check" CHECK ("score" BETWEEN 0 AND 100000),
  CONSTRAINT "CatalogMatchCandidate_reason_object_check" CHECK (jsonb_typeof("reason") = 'object'),
  CONSTRAINT "CatalogMatchCandidate_version_check" CHECK ("version" > 0),
  CONSTRAINT "CatalogMatchCandidate_resolution_check" CHECK (
    ("status" = 'SUGGESTED' AND "resolvedAt" IS NULL AND "resolvedByUserId" IS NULL)
    OR ("status" IN ('CONFIRMED', 'REJECTED') AND "resolvedAt" IS NOT NULL AND "resolvedByUserId" IS NOT NULL)
  )
);

CREATE TABLE "CatalogMatchDecision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "candidateId" UUID NOT NULL,
  "fromStatus" "CatalogMatchStatus" NOT NULL,
  "toStatus" "CatalogMatchStatus" NOT NULL,
  "candidateVersion" INTEGER NOT NULL,
  "actorUserId" UUID NOT NULL,
  "reason" TEXT,
  "evidence" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogMatchDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogMatchDecision_transition_check" CHECK ("fromStatus" <> "toStatus"),
  CONSTRAINT "CatalogMatchDecision_version_check" CHECK ("candidateVersion" > 0),
  CONSTRAINT "CatalogMatchDecision_evidence_object_check" CHECK (jsonb_typeof("evidence") = 'object')
);

CREATE TABLE "CatalogImageReference" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "catalogProductId" UUID NOT NULL,
  "catalogVariantId" UUID,
  "externalImageId" VARCHAR(200) NOT NULL,
  "remoteUrl" TEXT NOT NULL,
  "urlHash" CHAR(64) NOT NULL,
  "status" "CatalogImageIngestionStatus" NOT NULL DEFAULT 'OBSERVED',
  "contentTypeHint" VARCHAR(120),
  "byteLengthHint" BIGINT,
  "width" INTEGER,
  "height" INTEGER,
  "position" INTEGER NOT NULL DEFAULT 0,
  "safeMetadata" JSONB NOT NULL,
  "firstObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastObservedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "CatalogImageReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogImageReference_url_hash_check" CHECK ("urlHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CatalogImageReference_remote_url_check" CHECK ("remoteUrl" ~ '^https://'),
  CONSTRAINT "CatalogImageReference_size_check" CHECK ("byteLengthHint" IS NULL OR "byteLengthHint" >= 0),
  CONSTRAINT "CatalogImageReference_dimensions_check" CHECK (("width" IS NULL OR "width" > 0) AND ("height" IS NULL OR "height" > 0)),
  CONSTRAINT "CatalogImageReference_metadata_object_check" CHECK (jsonb_typeof("safeMetadata") = 'object'),
  CONSTRAINT "CatalogImageReference_version_check" CHECK ("version" > 0)
);

CREATE TABLE "InventorySyncPolicy" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "catalogVariantId" UUID NOT NULL,
  "productItemId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "sourceOfTruth" "InventorySyncSourceOfTruth" NOT NULL DEFAULT 'MANUAL_REVIEW',
  "desiredQuantityMicros" BIGINT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventorySyncPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventorySyncPolicy_version_check" CHECK ("version" > 0),
  CONSTRAINT "InventorySyncPolicy_manual_disabled_check" CHECK (NOT "enabled" OR "sourceOfTruth" <> 'MANUAL_REVIEW')
);

CREATE TABLE "InventorySyncObservation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "externalObservationId" VARCHAR(200) NOT NULL,
  "sourceOfTruthSnapshot" "InventorySyncSourceOfTruth" NOT NULL,
  "observedQuantityMicros" BIGINT NOT NULL,
  "desiredQuantityMicros" BIGINT,
  "providerObservedAt" TIMESTAMPTZ(6),
  "evidenceHash" CHAR(64) NOT NULL,
  "safeMetadata" JSONB NOT NULL,
  "observedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventorySyncObservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventorySyncObservation_evidence_hash_check" CHECK ("evidenceHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "InventorySyncObservation_metadata_object_check" CHECK (jsonb_typeof("safeMetadata") = 'object')
);

CREATE TABLE "InventorySyncConflict" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "observationId" UUID NOT NULL,
  "status" "InventorySyncConflictStatus" NOT NULL DEFAULT 'OPEN',
  "observedQuantityMicros" BIGINT NOT NULL,
  "desiredQuantityMicros" BIGINT NOT NULL,
  "differenceMicros" BIGINT NOT NULL,
  "reason" JSONB NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "resolvedAt" TIMESTAMPTZ(6),
  "resolvedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventorySyncConflict_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventorySyncConflict_difference_check" CHECK ("differenceMicros" = "desiredQuantityMicros" - "observedQuantityMicros"),
  CONSTRAINT "InventorySyncConflict_nonzero_check" CHECK ("differenceMicros" <> 0),
  CONSTRAINT "InventorySyncConflict_reason_object_check" CHECK (jsonb_typeof("reason") = 'object'),
  CONSTRAINT "InventorySyncConflict_version_check" CHECK ("version" > 0),
  CONSTRAINT "InventorySyncConflict_resolution_check" CHECK (
    ("status" = 'OPEN' AND "resolvedAt" IS NULL AND "resolvedByUserId" IS NULL)
    OR ("status" IN ('RESOLVED', 'IGNORED') AND "resolvedAt" IS NOT NULL AND "resolvedByUserId" IS NOT NULL)
  )
);

-- Composite tenant foreign keys below require their referenced uniqueness to
-- exist before PostgreSQL validates the constraints.
CREATE UNIQUE INDEX "ExternalCatalogProduct_installation_externalProductId_key" ON "ExternalCatalogProduct" ("installationId", "externalProductId");
CREATE UNIQUE INDEX "ExternalCatalogProduct_organizationId_id_key" ON "ExternalCatalogProduct" ("organizationId", "id");
CREATE UNIQUE INDEX "ExternalCatalogProduct_org_installation_id_key" ON "ExternalCatalogProduct" ("organizationId", "installationId", "id");
CREATE UNIQUE INDEX "ExternalCatalogVariant_installation_externalVariantId_key" ON "ExternalCatalogVariant" ("installationId", "externalVariantId");
CREATE UNIQUE INDEX "ExternalCatalogVariant_organizationId_id_key" ON "ExternalCatalogVariant" ("organizationId", "id");
CREATE UNIQUE INDEX "ExternalCatalogVariant_org_product_id_key" ON "ExternalCatalogVariant" ("organizationId", "catalogProductId", "id");
CREATE UNIQUE INDEX "CatalogMatchCandidate_variant_product_key" ON "CatalogMatchCandidate" ("catalogVariantId", "productItemId");
CREATE UNIQUE INDEX "CatalogMatchCandidate_organizationId_id_key" ON "CatalogMatchCandidate" ("organizationId", "id");
CREATE UNIQUE INDEX "CatalogImageReference_product_externalImageId_key" ON "CatalogImageReference" ("catalogProductId", "externalImageId");
CREATE UNIQUE INDEX "InventorySyncPolicy_installation_variant_location_key" ON "InventorySyncPolicy" ("installationId", "catalogVariantId", "locationId");
CREATE UNIQUE INDEX "InventorySyncPolicy_organizationId_id_key" ON "InventorySyncPolicy" ("organizationId", "id");
CREATE UNIQUE INDEX "InventorySyncObservation_policy_externalObservationId_key" ON "InventorySyncObservation" ("policyId", "externalObservationId");
CREATE UNIQUE INDEX "InventorySyncObservation_organizationId_id_key" ON "InventorySyncObservation" ("organizationId", "id");
CREATE UNIQUE INDEX "InventorySyncConflict_policy_observation_key" ON "InventorySyncConflict" ("policyId", "observationId");

ALTER TABLE "ExternalCatalogProduct"
  ADD CONSTRAINT "ExternalCatalogProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "ExternalCatalogProduct_installation_tenant_fkey" FOREIGN KEY ("organizationId", "installationId") REFERENCES "ConnectorInstallation"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "ExternalCatalogVariant"
  ADD CONSTRAINT "ExternalCatalogVariant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "ExternalCatalogVariant_installation_tenant_fkey" FOREIGN KEY ("organizationId", "installationId") REFERENCES "ConnectorInstallation"("organizationId", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "ExternalCatalogVariant_product_tenant_fkey" FOREIGN KEY ("organizationId", "installationId", "catalogProductId") REFERENCES "ExternalCatalogProduct"("organizationId", "installationId", "id") ON DELETE CASCADE;
ALTER TABLE "CatalogMatchCandidate"
  ADD CONSTRAINT "CatalogMatchCandidate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "CatalogMatchCandidate_variant_tenant_fkey" FOREIGN KEY ("organizationId", "catalogVariantId") REFERENCES "ExternalCatalogVariant"("organizationId", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "CatalogMatchCandidate_product_tenant_fkey" FOREIGN KEY ("organizationId", "productItemId") REFERENCES "ProductItem"("organizationId", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "CatalogMatchCandidate_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "CatalogMatchDecision"
  ADD CONSTRAINT "CatalogMatchDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "CatalogMatchDecision_candidate_tenant_fkey" FOREIGN KEY ("organizationId", "candidateId") REFERENCES "CatalogMatchCandidate"("organizationId", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "CatalogMatchDecision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "CatalogImageReference"
  ADD CONSTRAINT "CatalogImageReference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "CatalogImageReference_product_tenant_fkey" FOREIGN KEY ("organizationId", "catalogProductId") REFERENCES "ExternalCatalogProduct"("organizationId", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "CatalogImageReference_variant_tenant_fkey" FOREIGN KEY ("organizationId", "catalogProductId", "catalogVariantId") REFERENCES "ExternalCatalogVariant"("organizationId", "catalogProductId", "id") ON DELETE CASCADE;
ALTER TABLE "InventorySyncPolicy"
  ADD CONSTRAINT "InventorySyncPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventorySyncPolicy_installation_tenant_fkey" FOREIGN KEY ("organizationId", "installationId") REFERENCES "ConnectorInstallation"("organizationId", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventorySyncPolicy_variant_tenant_fkey" FOREIGN KEY ("organizationId", "catalogVariantId") REFERENCES "ExternalCatalogVariant"("organizationId", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventorySyncPolicy_product_tenant_fkey" FOREIGN KEY ("organizationId", "productItemId") REFERENCES "ProductItem"("organizationId", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventorySyncPolicy_location_tenant_fkey" FOREIGN KEY ("organizationId", "locationId") REFERENCES "InventoryLocation"("organizationId", "id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventorySyncPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventorySyncPolicy_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "InventorySyncObservation"
  ADD CONSTRAINT "InventorySyncObservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventorySyncObservation_policy_tenant_fkey" FOREIGN KEY ("organizationId", "policyId") REFERENCES "InventorySyncPolicy"("organizationId", "id") ON DELETE CASCADE;
ALTER TABLE "InventorySyncConflict"
  ADD CONSTRAINT "InventorySyncConflict_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventorySyncConflict_policy_tenant_fkey" FOREIGN KEY ("organizationId", "policyId") REFERENCES "InventorySyncPolicy"("organizationId", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventorySyncConflict_observation_tenant_fkey" FOREIGN KEY ("organizationId", "observationId") REFERENCES "InventorySyncObservation"("organizationId", "id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventorySyncConflict_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL;

CREATE INDEX "ExternalCatalogProduct_org_installation_observed_idx" ON "ExternalCatalogProduct" ("organizationId", "installationId", "lastObservedAt");
CREATE INDEX "ExternalCatalogProduct_org_normalized_name_idx" ON "ExternalCatalogProduct" ("organizationId", "normalizedName");

CREATE INDEX "ExternalCatalogVariant_org_installation_sku_idx" ON "ExternalCatalogVariant" ("organizationId", "installationId", "normalizedSku");
CREATE INDEX "ExternalCatalogVariant_org_gtin_idx" ON "ExternalCatalogVariant" ("organizationId", "normalizedGtin");
CREATE INDEX "ExternalCatalogVariant_org_manufacturer_part_idx" ON "ExternalCatalogVariant" ("organizationId", "normalizedManufacturer", "normalizedManufacturerPartNumber");
CREATE INDEX "ExternalCatalogVariant_org_name_idx" ON "ExternalCatalogVariant" ("organizationId", "normalizedName");

CREATE UNIQUE INDEX "CatalogMatchCandidate_one_confirmed_variant_key" ON "CatalogMatchCandidate" ("catalogVariantId") WHERE "status" = 'CONFIRMED';
CREATE INDEX "CatalogMatchCandidate_org_variant_status_score_idx" ON "CatalogMatchCandidate" ("organizationId", "catalogVariantId", "status", "score" DESC);
CREATE INDEX "CatalogMatchCandidate_org_product_status_idx" ON "CatalogMatchCandidate" ("organizationId", "productItemId", "status");
CREATE INDEX "CatalogMatchDecision_org_candidate_created_idx" ON "CatalogMatchDecision" ("organizationId", "candidateId", "createdAt");

CREATE INDEX "CatalogImageReference_org_status_observed_idx" ON "CatalogImageReference" ("organizationId", "status", "lastObservedAt");
CREATE INDEX "CatalogImageReference_org_url_hash_idx" ON "CatalogImageReference" ("organizationId", "urlHash");

CREATE INDEX "InventorySyncPolicy_org_source_enabled_idx" ON "InventorySyncPolicy" ("organizationId", "sourceOfTruth", "enabled");
CREATE INDEX "InventorySyncPolicy_org_product_location_idx" ON "InventorySyncPolicy" ("organizationId", "productItemId", "locationId");
CREATE INDEX "InventorySyncObservation_org_policy_observed_idx" ON "InventorySyncObservation" ("organizationId", "policyId", "observedAt");
CREATE INDEX "InventorySyncConflict_org_status_created_idx" ON "InventorySyncConflict" ("organizationId", "status", "createdAt");

CREATE OR REPLACE FUNCTION prevent_catalog_decision_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Catalog match decisions are append-only';
END;
$$;
CREATE TRIGGER "CatalogMatchDecision_append_only"
BEFORE UPDATE OR DELETE ON "CatalogMatchDecision"
FOR EACH ROW EXECUTE FUNCTION prevent_catalog_decision_mutation();

CREATE OR REPLACE FUNCTION prevent_inventory_sync_observation_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory sync observations are append-only';
END;
$$;
CREATE TRIGGER "InventorySyncObservation_append_only"
BEFORE UPDATE OR DELETE ON "InventorySyncObservation"
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_sync_observation_mutation();

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "ExternalCatalogProduct", "ExternalCatalogVariant", "CatalogMatchCandidate",
  "CatalogImageReference", "InventorySyncPolicy", "InventorySyncConflict"
TO clearledger_runtime;
GRANT SELECT, INSERT ON "CatalogMatchDecision", "InventorySyncObservation" TO clearledger_runtime;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'ExternalCatalogProduct', 'ExternalCatalogVariant', 'CatalogMatchCandidate',
    'CatalogMatchDecision', 'CatalogImageReference', 'InventorySyncPolicy',
    'InventorySyncObservation', 'InventorySyncConflict'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id()) WITH CHECK ("organizationId" = app_current_organization_id())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;
