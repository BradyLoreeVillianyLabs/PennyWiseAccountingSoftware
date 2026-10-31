-- Source-neutral, tenant-predicated nearest-candidate retrieval for catalog matching.
-- Final basis-point scoring remains in the application and never auto-confirms a match.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION catalog_normalize_match_text(value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(
    left(
      btrim(regexp_replace(lower(left(value, 4000)), '[^[:alnum:]]+', ' ', 'g')),
      4000
    ),
    ''
  )
$$;

CREATE INDEX "ProductItem_org_active_sku_trgm_gist_idx"
  ON "ProductItem" USING gist
  ("organizationId", "normalizedSku" gist_trgm_ops)
  WHERE "active" = true AND "normalizedSku" IS NOT NULL;

CREATE INDEX "ProductItem_org_active_name_trgm_gist_idx"
  ON "ProductItem" USING gist
  ("organizationId", catalog_normalize_match_text("name") gist_trgm_ops)
  WHERE "active" = true;

CREATE INDEX "ProductItem_org_active_description_trgm_gist_idx"
  ON "ProductItem" USING gist
  ("organizationId", catalog_normalize_match_text("description") gist_trgm_ops)
  WHERE "active" = true AND catalog_normalize_match_text("description") IS NOT NULL;
