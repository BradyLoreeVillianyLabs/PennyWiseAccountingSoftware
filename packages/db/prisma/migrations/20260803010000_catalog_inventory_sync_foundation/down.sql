DROP TABLE IF EXISTS "InventorySyncConflict";
DROP TABLE IF EXISTS "InventorySyncObservation";
DROP TABLE IF EXISTS "InventorySyncPolicy";
DROP TABLE IF EXISTS "CatalogImageReference";
DROP TABLE IF EXISTS "CatalogMatchDecision";
DROP TABLE IF EXISTS "CatalogMatchCandidate";
DROP TABLE IF EXISTS "ExternalCatalogVariant";
DROP TABLE IF EXISTS "ExternalCatalogProduct";

DROP FUNCTION IF EXISTS prevent_inventory_sync_observation_mutation();
DROP FUNCTION IF EXISTS prevent_catalog_decision_mutation();

DROP INDEX IF EXISTS "ProductItem_name_trgm_idx";
DROP INDEX IF EXISTS "ProductItem_org_manufacturer_part_idx";
DROP INDEX IF EXISTS "ProductItem_organizationId_normalizedGtin_idx";
DROP INDEX IF EXISTS "ProductItem_organizationId_normalizedSku_idx";
DROP INDEX IF EXISTS "ProductItem_organizationId_id_key";
DROP TRIGGER IF EXISTS "ProductItem_catalog_identifier_normalization" ON "ProductItem";
DROP FUNCTION IF EXISTS normalize_product_catalog_identifiers();

DO $$
BEGIN
  IF to_regclass('public."ProductItem"') IS NOT NULL THEN
    ALTER TABLE "ProductItem"
      DROP COLUMN IF EXISTS "normalizedManufacturerPartNumber",
      DROP COLUMN IF EXISTS "manufacturerPartNumber",
      DROP COLUMN IF EXISTS "normalizedManufacturer",
      DROP COLUMN IF EXISTS "manufacturer",
      DROP COLUMN IF EXISTS "normalizedGtin",
      DROP COLUMN IF EXISTS "gtin",
      DROP COLUMN IF EXISTS "normalizedSku";
  END IF;
END $$;

DROP FUNCTION IF EXISTS catalog_normalize_identifier(TEXT);
DROP TYPE IF EXISTS "InventorySyncConflictStatus";
DROP TYPE IF EXISTS "InventorySyncSourceOfTruth";
DROP TYPE IF EXISTS "CatalogImageIngestionStatus";
DROP TYPE IF EXISTS "CatalogMatchStatus";
DROP EXTENSION IF EXISTS pg_trgm RESTRICT;
