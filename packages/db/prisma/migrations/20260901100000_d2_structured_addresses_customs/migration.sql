-- D2: replace customer address JSON blobs with a structured, reviewable model.
-- Legacy values that do not meet the structural contract remain in legacyValue.

CREATE TYPE "CustomerAddressRole" AS ENUM ('BILLING', 'SHIPPING', 'SERVICE');

CREATE TABLE "CustomerAddress" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "customerId" UUID NOT NULL,
  "role" "CustomerAddressRole" NOT NULL,
  "recipientName" VARCHAR(200),
  "organization" VARCHAR(200),
  "line1" VARCHAR(200),
  "line2" VARCHAR(200),
  "city" VARCHAR(120),
  "subdivisionCode" VARCHAR(10),
  "postalCode" VARCHAR(20),
  "countryCode" CHAR(2),
  "phone" VARCHAR(40),
  "email" VARCHAR(320),
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "needsReview" BOOLEAN NOT NULL DEFAULT false,
  "legacyValue" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerAddress_organization_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "CustomerAddress_organization_customer_fkey"
    FOREIGN KEY ("organizationId", "customerId")
    REFERENCES "Customer"("organizationId", "id") ON DELETE CASCADE,
  CONSTRAINT "CustomerAddress_country_code_check"
    CHECK ("countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "CustomerAddress_versioned_fields_check"
    CHECK ("line1" IS NOT NULL OR "needsReview" = true)
);

CREATE UNIQUE INDEX "CustomerAddress_organizationId_id_key"
  ON "CustomerAddress" ("organizationId", "id");
CREATE INDEX "CustomerAddress_organizationId_customerId_role_isDefault_idx"
  ON "CustomerAddress" ("organizationId", "customerId", "role", "isDefault");
CREATE INDEX "CustomerAddress_organizationId_needsReview_idx"
  ON "CustomerAddress" ("organizationId", "needsReview");
CREATE UNIQUE INDEX "CustomerAddress_one_default_per_role_key"
  ON "CustomerAddress" ("organizationId", "customerId", "role")
  WHERE "isDefault" = true;

ALTER TABLE "CustomerAddress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CustomerAddress" FORCE ROW LEVEL SECURITY;
CREATE POLICY "CustomerAddress_tenant_policy" ON "CustomerAddress"
  FOR ALL TO clearledger_runtime
  USING (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  )
  WITH CHECK (
    "organizationId" = app_current_organization_id()
    AND app_actor_has_tenant_access()
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON "CustomerAddress" TO clearledger_runtime;

ALTER TABLE "ProductItem"
  ADD COLUMN "hsTariffCode" VARCHAR(20),
  ADD COLUMN "countryOfOrigin" CHAR(2);

-- Backfill the two former address roles. The source JSON is retained only when
-- the row cannot be converted confidently; no source value is guessed away.
INSERT INTO "CustomerAddress" (
  "organizationId", "customerId", "role", "recipientName", "organization",
  "line1", "line2", "city", "subdivisionCode", "postalCode", "countryCode",
  "phone", "email", "isDefault", "needsReview", "legacyValue"
)
SELECT
  c."organizationId",
  c."id",
  source."role"::"CustomerAddressRole",
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'recipientName') = 'string'
    THEN NULLIF(btrim(source."value"->>'recipientName'), '') END,
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'organization') = 'string'
    THEN NULLIF(btrim(source."value"->>'organization'), '') END,
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'line1') = 'string'
    THEN NULLIF(btrim(source."value"->>'line1'), '') END,
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'line2') = 'string'
    THEN NULLIF(btrim(source."value"->>'line2'), '') END,
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'city') = 'string'
    THEN NULLIF(btrim(source."value"->>'city'), '') END,
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'province') = 'string'
    THEN CASE
      WHEN upper(NULLIF(btrim(COALESCE(source."value"->>'country', source."value"->>'countryCode')), '')) IN ('CA', 'US')
        AND btrim(source."value"->>'province') !~ '-'
      THEN upper(COALESCE(source."value"->>'country', source."value"->>'countryCode')) || '-' || upper(btrim(source."value"->>'province'))
      ELSE upper(NULLIF(btrim(source."value"->>'province'), ''))
    END
    WHEN jsonb_typeof(source."value") = 'object'
      AND jsonb_typeof(source."value"->'subdivisionCode') = 'string'
    THEN upper(NULLIF(btrim(source."value"->>'subdivisionCode'), ''))
  END,
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'postalCode') = 'string'
    THEN upper(NULLIF(btrim(source."value"->>'postalCode'), '')) END,
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND COALESCE(source."value"->>'country', source."value"->>'countryCode') IS NOT NULL
    THEN upper(NULLIF(btrim(COALESCE(source."value"->>'country', source."value"->>'countryCode')), '')) END,
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'phone') = 'string'
    THEN NULLIF(btrim(source."value"->>'phone'), '') END,
  CASE WHEN jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'email') = 'string'
    THEN NULLIF(btrim(source."value"->>'email'), '') END,
  true,
  NOT (
    jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'line1') = 'string'
    AND NULLIF(btrim(source."value"->>'line1'), '') IS NOT NULL
    AND jsonb_typeof(source."value"->'city') = 'string'
    AND NULLIF(btrim(source."value"->>'city'), '') IS NOT NULL
    AND jsonb_typeof(source."value"->'postalCode') = 'string'
    AND NULLIF(btrim(source."value"->>'postalCode'), '') IS NOT NULL
    AND upper(NULLIF(btrim(COALESCE(source."value"->>'country', source."value"->>'countryCode')), '')) ~ '^[A-Z]{2}$'
    AND (
      upper(NULLIF(btrim(COALESCE(source."value"->>'country', source."value"->>'countryCode')), '')) NOT IN ('CA', 'US')
      OR (
        jsonb_typeof(COALESCE(source."value"->'province', source."value"->'subdivisionCode')) = 'string'
        AND upper(NULLIF(btrim(COALESCE(source."value"->>'province', source."value"->>'subdivisionCode')), '')) ~ '^(?:(?:CA|US)-[A-Z0-9]{2,3}|[A-Z0-9]{2,3})$'
        AND (
          (upper(COALESCE(source."value"->>'country', source."value"->>'countryCode')) = 'CA'
            AND upper(source."value"->>'postalCode') ~ '^[A-Z][0-9][A-Z][ -]?[0-9][A-Z][0-9]$')
          OR
          (upper(COALESCE(source."value"->>'country', source."value"->>'countryCode')) = 'US'
            AND upper(source."value"->>'postalCode') ~ '^[0-9]{5}(-[0-9]{4})?$')
        )
      )
    )
  ),
  CASE WHEN NOT (
    jsonb_typeof(source."value") = 'object'
    AND jsonb_typeof(source."value"->'line1') = 'string'
    AND NULLIF(btrim(source."value"->>'line1'), '') IS NOT NULL
    AND jsonb_typeof(source."value"->'city') = 'string'
    AND NULLIF(btrim(source."value"->>'city'), '') IS NOT NULL
    AND jsonb_typeof(source."value"->'postalCode') = 'string'
    AND NULLIF(btrim(source."value"->>'postalCode'), '') IS NOT NULL
    AND upper(NULLIF(btrim(COALESCE(source."value"->>'country', source."value"->>'countryCode')), '')) ~ '^[A-Z]{2}$'
    AND (
      upper(NULLIF(btrim(COALESCE(source."value"->>'country', source."value"->>'countryCode')), '')) NOT IN ('CA', 'US')
      OR (
        jsonb_typeof(COALESCE(source."value"->'province', source."value"->'subdivisionCode')) = 'string'
        AND upper(NULLIF(btrim(COALESCE(source."value"->>'province', source."value"->>'subdivisionCode')), '')) ~ '^(?:(?:CA|US)-[A-Z0-9]{2,3}|[A-Z0-9]{2,3})$'
        AND (
          (upper(COALESCE(source."value"->>'country', source."value"->>'countryCode')) = 'CA'
            AND upper(source."value"->>'postalCode') ~ '^[A-Z][0-9][A-Z][ -]?[0-9][A-Z][0-9]$')
          OR
          (upper(COALESCE(source."value"->>'country', source."value"->>'countryCode')) = 'US'
            AND upper(source."value"->>'postalCode') ~ '^[0-9]{5}(-[0-9]{4})?$')
        )
      )
    )
  ) THEN source."value" END
FROM "Customer" AS c
CROSS JOIN LATERAL (
  VALUES
    ('BILLING', c."billingAddress"),
    ('SERVICE', c."serviceAddress")
) AS source("role", "value")
WHERE source."value" IS NOT NULL;

ALTER TABLE "Customer"
  DROP COLUMN "billingAddress",
  DROP COLUMN "serviceAddress";
