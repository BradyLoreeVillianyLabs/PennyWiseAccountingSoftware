DROP INDEX IF EXISTS "ProductItem_org_active_description_trgm_gist_idx";
DROP INDEX IF EXISTS "ProductItem_org_active_name_trgm_gist_idx";
DROP INDEX IF EXISTS "ProductItem_org_active_sku_trgm_gist_idx";
DROP FUNCTION IF EXISTS catalog_normalize_match_text(TEXT);

-- pg_trgm is owned by the catalog foundation and btree_gist is shared by other
-- constraints, so rollback deliberately leaves both extensions installed.
