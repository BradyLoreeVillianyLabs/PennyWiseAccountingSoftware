DO $$
BEGIN
  IF to_regclass('public."ExternalCatalogVariant"') IS NOT NULL THEN
    ALTER TABLE "ExternalCatalogVariant"
      DROP CONSTRAINT IF EXISTS "ExternalCatalogVariant_reference_aliases_array_check";
    ALTER TABLE "ExternalCatalogVariant"
      DROP COLUMN IF EXISTS "externalReferenceAliases";
  END IF;
END $$;
