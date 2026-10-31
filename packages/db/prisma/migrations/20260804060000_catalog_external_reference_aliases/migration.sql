ALTER TABLE "ExternalCatalogVariant"
  ADD COLUMN "externalReferenceAliases" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "ExternalCatalogVariant"
  ADD CONSTRAINT "ExternalCatalogVariant_reference_aliases_array_check"
  CHECK (
    jsonb_typeof("externalReferenceAliases") = 'array'
    AND jsonb_array_length("externalReferenceAliases") <= 20
  );
