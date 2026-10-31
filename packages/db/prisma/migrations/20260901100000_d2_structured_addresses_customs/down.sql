-- Restore the former customer JSON address columns from the default structured rows.
-- Shipping addresses have no equivalent in the former schema and therefore remain
-- represented only while this migration is applied.

ALTER TABLE "Customer"
  ADD COLUMN "billingAddress" JSONB,
  ADD COLUMN "serviceAddress" JSONB;

UPDATE "Customer" AS c
SET "billingAddress" = (
  SELECT CASE
    WHEN address."needsReview" AND address."legacyValue" IS NOT NULL THEN address."legacyValue"
    ELSE jsonb_strip_nulls(jsonb_build_object(
      'recipientName', address."recipientName",
      'organization', address."organization",
      'line1', address."line1",
      'line2', address."line2",
      'city', address."city",
      'province', address."subdivisionCode",
      'postalCode', address."postalCode",
      'country', address."countryCode",
      'phone', address."phone",
      'email', address."email"
    ))
  END AS "value"
  FROM "CustomerAddress" AS address
  WHERE address."organizationId" = c."organizationId"
    AND address."customerId" = c."id"
    AND address."role" = 'BILLING'
  ORDER BY address."isDefault" DESC, address."createdAt" ASC, address."id" ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "CustomerAddress" AS address
  WHERE address."organizationId" = c."organizationId"
    AND address."customerId" = c."id"
    AND address."role" = 'BILLING'
);

UPDATE "Customer" AS c
SET "serviceAddress" = (
  SELECT CASE
    WHEN address."needsReview" AND address."legacyValue" IS NOT NULL THEN address."legacyValue"
    ELSE jsonb_strip_nulls(jsonb_build_object(
      'recipientName', address."recipientName",
      'organization', address."organization",
      'line1', address."line1",
      'line2', address."line2",
      'city', address."city",
      'province', address."subdivisionCode",
      'postalCode', address."postalCode",
      'country', address."countryCode",
      'phone', address."phone",
      'email', address."email"
    ))
  END AS "value"
  FROM "CustomerAddress" AS address
  WHERE address."organizationId" = c."organizationId"
    AND address."customerId" = c."id"
    AND address."role" = 'SERVICE'
  ORDER BY address."isDefault" DESC, address."createdAt" ASC, address."id" ASC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "CustomerAddress" AS address
  WHERE address."organizationId" = c."organizationId"
    AND address."customerId" = c."id"
    AND address."role" = 'SERVICE'
);

DROP TABLE IF EXISTS "CustomerAddress";
DROP TYPE IF EXISTS "CustomerAddressRole";
ALTER TABLE "ProductItem"
  DROP COLUMN "hsTariffCode",
  DROP COLUMN "countryOfOrigin";
