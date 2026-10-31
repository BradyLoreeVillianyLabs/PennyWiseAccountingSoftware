CREATE TYPE "InventoryMovementType" AS ENUM (
  'OPENING_QUANTITY', 'PURCHASE_RECEIPT', 'SALE', 'CUSTOMER_RETURN',
  'VENDOR_RETURN', 'INCREASE_ADJUSTMENT', 'DECREASE_ADJUSTMENT',
  'WRITE_OFF', 'TRANSFER_OUT', 'TRANSFER_IN', 'REVERSAL'
);
CREATE TYPE "InventoryAdjustmentKind" AS ENUM (
  'OPENING', 'COUNT_CORRECTION', 'DAMAGE', 'THEFT_LOSS', 'SPOILAGE', 'FOUND_STOCK'
);
CREATE TYPE "InventoryReturnDisposition" AS ENUM ('RESTOCK', 'WRITE_OFF');

ALTER TABLE "ProductItem"
  ADD COLUMN "adjustmentGainAccountId" UUID,
  ADD COLUMN "costOfGoodsSoldAccountId" UUID,
  ADD COLUMN "defaultLocationId" UUID,
  ADD COLUMN "inventoryLossAccountId" UUID,
  ADD COLUMN "preferredVendorId" UUID,
  ADD COLUMN "purchaseClearingAccountId" UUID,
  ADD COLUMN "reorderPointMicros" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "BillLine" ADD COLUMN "productItemId" UUID;

CREATE TABLE "InventoryLocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "address" JSONB,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryBalance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "productItemId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "quantityOnHandMicros" BIGINT NOT NULL DEFAULT 0,
  "valueOnHandMinor" BIGINT NOT NULL DEFAULT 0,
  "averageUnitCostMicros" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "movementType" "InventoryMovementType" NOT NULL,
  "productItemId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "quantityMicros" BIGINT NOT NULL,
  "unitCostMicros" BIGINT NOT NULL,
  "totalValueMinor" BIGINT NOT NULL,
  "eventDate" DATE NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" UUID NOT NULL,
  "sourceLineId" UUID,
  "billLineId" UUID,
  "invoiceLineId" UUID,
  "creditNoteLineId" UUID,
  "vendorCreditLineId" UUID,
  "journalId" UUID,
  "inventoryAssetAccountId" UUID NOT NULL,
  "offsetAccountId" UUID,
  "adjustmentKind" "InventoryAdjustmentKind",
  "returnDisposition" "InventoryReturnDisposition",
  "reason" TEXT,
  "reversalOfMovementId" UUID,
  "configurationSnapshot" JSONB NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryLocation_organizationId_code_key"
  ON "InventoryLocation"("organizationId", "code");
CREATE UNIQUE INDEX "InventoryLocation_organizationId_id_key"
  ON "InventoryLocation"("organizationId", "id");
CREATE UNIQUE INDEX "InventoryLocation_one_default_key"
  ON "InventoryLocation"("organizationId") WHERE "isDefault" AND "isActive";
CREATE INDEX "InventoryLocation_organizationId_isActive_idx"
  ON "InventoryLocation"("organizationId", "isActive");
CREATE UNIQUE INDEX "InventoryBalance_productItemId_locationId_key"
  ON "InventoryBalance"("productItemId", "locationId");
CREATE UNIQUE INDEX "InventoryBalance_organizationId_id_key"
  ON "InventoryBalance"("organizationId", "id");
CREATE INDEX "InventoryBalance_organizationId_locationId_idx"
  ON "InventoryBalance"("organizationId", "locationId");
CREATE UNIQUE INDEX "InventoryMovement_reversalOfMovementId_key"
  ON "InventoryMovement"("reversalOfMovementId");
CREATE UNIQUE INDEX "InventoryMovement_journalId_key"
  ON "InventoryMovement"("journalId");
CREATE UNIQUE INDEX "InventoryMovement_eventId_movementType_locationId_productIt_key"
  ON "InventoryMovement"("eventId", "movementType", "locationId", "productItemId");
CREATE UNIQUE INDEX "InventoryMovement_organizationId_id_key"
  ON "InventoryMovement"("organizationId", "id");
CREATE INDEX "InventoryMovement_organizationId_productItemId_locationId_e_idx"
  ON "InventoryMovement"("organizationId", "productItemId", "locationId", "eventDate");
CREATE INDEX "InventoryMovement_organizationId_sourceType_sourceId_idx"
  ON "InventoryMovement"("organizationId", "sourceType", "sourceId");
CREATE INDEX "InventoryMovement_organizationId_journalId_idx"
  ON "InventoryMovement"("organizationId", "journalId");
CREATE INDEX "BillLine_organizationId_productItemId_idx"
  ON "BillLine"("organizationId", "productItemId");
CREATE INDEX "ProductItem_organizationId_defaultLocationId_idx"
  ON "ProductItem"("organizationId", "defaultLocationId");
CREATE INDEX "ProductItem_organizationId_preferredVendorId_idx"
  ON "ProductItem"("organizationId", "preferredVendorId");

ALTER TABLE "ProductItem"
  ADD CONSTRAINT "ProductItem_costOfGoodsSoldAccountId_fkey"
    FOREIGN KEY ("costOfGoodsSoldAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ProductItem_purchaseClearingAccountId_fkey"
    FOREIGN KEY ("purchaseClearingAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ProductItem_adjustmentGainAccountId_fkey"
    FOREIGN KEY ("adjustmentGainAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ProductItem_inventoryLossAccountId_fkey"
    FOREIGN KEY ("inventoryLossAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ProductItem_defaultLocationId_fkey"
    FOREIGN KEY ("defaultLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ProductItem_preferredVendorId_fkey"
    FOREIGN KEY ("preferredVendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "ProductItem_reorder_point_check" CHECK ("reorderPointMicros" >= 0);
ALTER TABLE "BillLine"
  ADD CONSTRAINT "BillLine_productItemId_fkey"
    FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT;
ALTER TABLE "InventoryLocation"
  ADD CONSTRAINT "InventoryLocation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventoryLocation_code_check"
    CHECK ("code" ~ '^[A-Za-z0-9._-]{1,40}$'),
  ADD CONSTRAINT "InventoryLocation_state_check"
    CHECK (("isActive" AND "archivedAt" IS NULL) OR (NOT "isActive" AND "archivedAt" IS NOT NULL));
ALTER TABLE "InventoryBalance"
  ADD CONSTRAINT "InventoryBalance_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventoryBalance_productItemId_fkey"
    FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryBalance_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryBalance_nonnegative_check"
    CHECK (
      "quantityOnHandMicros" >= 0
      AND "valueOnHandMinor" >= 0
      AND "averageUnitCostMicros" >= 0
      AND (("quantityOnHandMicros" = 0 AND "valueOnHandMinor" = 0 AND "averageUnitCostMicros" = 0)
        OR "quantityOnHandMicros" > 0)
    );
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "InventoryMovement_productItemId_fkey"
    FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_billLineId_fkey"
    FOREIGN KEY ("billLineId") REFERENCES "BillLine"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_invoiceLineId_fkey"
    FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_creditNoteLineId_fkey"
    FOREIGN KEY ("creditNoteLineId") REFERENCES "CreditNoteLine"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_vendorCreditLineId_fkey"
    FOREIGN KEY ("vendorCreditLineId") REFERENCES "VendorCreditLine"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_journalId_fkey"
    FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_inventoryAssetAccountId_fkey"
    FOREIGN KEY ("inventoryAssetAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_offsetAccountId_fkey"
    FOREIGN KEY ("offsetAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_reversalOfMovementId_fkey"
    FOREIGN KEY ("reversalOfMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "InventoryMovement_amount_check" CHECK (
    "quantityMicros" <> 0
    AND "unitCostMicros" >= 0
    AND abs("quantityMicros") <= 9000000000000000000
    AND abs("totalValueMinor") <= 9000000000000000000
    AND (
      ("movementType" IN (
        'OPENING_QUANTITY', 'PURCHASE_RECEIPT', 'CUSTOMER_RETURN',
        'INCREASE_ADJUSTMENT', 'TRANSFER_IN'
      ) AND "quantityMicros" > 0 AND "totalValueMinor" >= 0)
      OR
      ("movementType" IN (
        'SALE', 'VENDOR_RETURN', 'DECREASE_ADJUSTMENT', 'WRITE_OFF', 'TRANSFER_OUT'
      ) AND "quantityMicros" < 0 AND "totalValueMinor" <= 0)
      OR "movementType" = 'REVERSAL'
    )
  ),
  ADD CONSTRAINT "InventoryMovement_reason_check" CHECK (
    ("movementType" NOT IN ('OPENING_QUANTITY', 'INCREASE_ADJUSTMENT', 'DECREASE_ADJUSTMENT', 'WRITE_OFF', 'REVERSAL'))
    OR nullif(btrim("reason"), '') IS NOT NULL
  );

CREATE OR REPLACE FUNCTION phase9_inventory_reference_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ref_org UUID;
  ref_type "ProductItemType";
  ref_asset UUID;
  ref_status "JournalStatus";
  ref_qty BIGINT;
  ref_value BIGINT;
  ref_product UUID;
  ref_location UUID;
  journal_line_count INTEGER;
  asset_debit NUMERIC;
  asset_credit NUMERIC;
  offset_debit NUMERIC;
  offset_credit NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'InventoryLocation' THEN
    RETURN NEW;
  END IF;
  SELECT "organizationId", "itemType", "inventoryAssetAccountId"
    INTO ref_org, ref_type, ref_asset
  FROM "ProductItem" WHERE "id" = NEW."productItemId";
  IF ref_org IS DISTINCT FROM NEW."organizationId"
    OR ref_type <> 'INVENTORY_PRODUCT' THEN
    RAISE EXCEPTION 'Inventory product tenant or type mismatch';
  END IF;
  SELECT "organizationId" INTO ref_org
  FROM "InventoryLocation" WHERE "id" = NEW."locationId";
  IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'Inventory location tenant mismatch';
  END IF;
  IF TG_TABLE_NAME = 'InventoryBalance' THEN
    RETURN NEW;
  END IF;
  IF NEW."inventoryAssetAccountId" IS DISTINCT FROM ref_asset THEN
    RAISE EXCEPTION 'Inventory movement asset account does not match item configuration';
  END IF;
  SELECT "organizationId" INTO ref_org FROM "Account"
  WHERE "id" = NEW."inventoryAssetAccountId" AND "type" = 'ASSET';
  IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'Inventory movement asset account is invalid';
  END IF;
  IF NEW."offsetAccountId" IS NOT NULL THEN
    SELECT "organizationId" INTO ref_org FROM "Account" WHERE "id" = NEW."offsetAccountId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Inventory movement offset account tenant mismatch';
    END IF;
  END IF;
  IF NEW."journalId" IS NOT NULL THEN
    SELECT "organizationId", "status" INTO ref_org, ref_status
    FROM "Journal" WHERE "id" = NEW."journalId";
    IF ref_org IS DISTINCT FROM NEW."organizationId" OR ref_status <> 'POSTED' THEN
      RAISE EXCEPTION 'Inventory movement journal must be a posted tenant journal';
    END IF;
    SELECT count(*),
      COALESCE(sum("debitMinor") FILTER (WHERE "accountId" = NEW."inventoryAssetAccountId"), 0),
      COALESCE(sum("creditMinor") FILTER (WHERE "accountId" = NEW."inventoryAssetAccountId"), 0),
      COALESCE(sum("debitMinor") FILTER (WHERE "accountId" = NEW."offsetAccountId"), 0),
      COALESCE(sum("creditMinor") FILTER (WHERE "accountId" = NEW."offsetAccountId"), 0)
      INTO journal_line_count, asset_debit, asset_credit, offset_debit, offset_credit
    FROM "JournalLine" WHERE "journalId" = NEW."journalId";
    IF NEW."totalValueMinor" > 0 AND (
      NEW."offsetAccountId" IS NULL OR journal_line_count <> 2
      OR asset_debit <> NEW."totalValueMinor" OR asset_credit <> 0
      OR offset_debit <> 0 OR offset_credit <> NEW."totalValueMinor"
    ) THEN
      RAISE EXCEPTION 'Inbound inventory journal does not match movement value';
    END IF;
    IF NEW."totalValueMinor" < 0 AND (
      NEW."offsetAccountId" IS NULL OR journal_line_count <> 2
      OR asset_debit <> 0 OR asset_credit <> -NEW."totalValueMinor"
      OR offset_debit <> -NEW."totalValueMinor" OR offset_credit <> 0
    ) THEN
      RAISE EXCEPTION 'Outbound inventory journal does not match movement value';
    END IF;
  ELSIF NEW."movementType" NOT IN ('TRANSFER_IN', 'TRANSFER_OUT')
    AND NEW."totalValueMinor" <> 0 THEN
    RAISE EXCEPTION 'Financial inventory movements require a posted journal';
  END IF;
  IF NEW."billLineId" IS NOT NULL THEN
    SELECT "organizationId", "productItemId" INTO ref_org, ref_product
    FROM "BillLine" WHERE "id" = NEW."billLineId";
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR ref_product IS DISTINCT FROM NEW."productItemId" THEN
      RAISE EXCEPTION 'Inventory bill line tenant or product mismatch';
    END IF;
  END IF;
  IF NEW."invoiceLineId" IS NOT NULL THEN
    SELECT "organizationId", "productItemId" INTO ref_org, ref_product
    FROM "InvoiceLine" WHERE "id" = NEW."invoiceLineId";
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR ref_product IS DISTINCT FROM NEW."productItemId" THEN
      RAISE EXCEPTION 'Inventory invoice line tenant or product mismatch';
    END IF;
  END IF;
  IF NEW."creditNoteLineId" IS NOT NULL THEN
    SELECT line."organizationId", invoice_line."productItemId" INTO ref_org, ref_product
    FROM "CreditNoteLine" line
    JOIN "InvoiceLine" invoice_line ON invoice_line."id" = line."invoiceLineId"
    WHERE line."id" = NEW."creditNoteLineId";
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR ref_product IS DISTINCT FROM NEW."productItemId" THEN
      RAISE EXCEPTION 'Inventory credit note line tenant or product mismatch';
    END IF;
  END IF;
  IF NEW."vendorCreditLineId" IS NOT NULL THEN
    SELECT line."organizationId", bill_line."productItemId" INTO ref_org, ref_product
    FROM "VendorCreditLine" line
    JOIN "BillLine" bill_line ON bill_line."id" = line."billLineId"
    WHERE line."id" = NEW."vendorCreditLineId";
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR ref_product IS DISTINCT FROM NEW."productItemId" THEN
      RAISE EXCEPTION 'Inventory vendor credit line tenant or product mismatch';
    END IF;
  END IF;
  IF NEW."movementType" = 'PURCHASE_RECEIPT'
    AND (NEW."billLineId" IS NULL OR NEW."invoiceLineId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Purchase receipts require only a bill-line source';
  ELSIF NEW."movementType" = 'PURCHASE_RECEIPT' AND NOT EXISTS (
    SELECT 1 FROM "BillLine" line
    JOIN "Bill" bill ON bill.id = line."billId"
    WHERE line.id = NEW."billLineId"
      AND bill.status NOT IN ('DRAFT', 'APPROVED', 'VOIDED')
  ) THEN
    RAISE EXCEPTION 'Purchase receipts require a posted bill';
  ELSIF NEW."movementType" = 'SALE' AND NEW."invoiceLineId" IS NULL THEN
    RAISE EXCEPTION 'Inventory sales require an invoice-line source';
  ELSIF NEW."movementType" = 'SALE' AND NOT EXISTS (
    SELECT 1 FROM "InvoiceLine" line
    JOIN "Invoice" invoice ON invoice.id = line."invoiceId"
    WHERE line.id = NEW."invoiceLineId" AND invoice.status = 'POSTED'
      AND NEW."quantityMicros" = -line."quantityMicros"
  ) THEN
    RAISE EXCEPTION 'Inventory sale must exactly deplete a posted invoice line';
  ELSIF NEW."movementType" = 'CUSTOMER_RETURN'
    AND (NEW."creditNoteLineId" IS NULL OR NEW."invoiceLineId" IS NULL) THEN
    RAISE EXCEPTION 'Customer returns require invoice and credit-note lines';
  ELSIF NEW."movementType" = 'CUSTOMER_RETURN' AND NOT EXISTS (
    SELECT 1 FROM "CreditNoteLine" line
    JOIN "CreditNote" credit ON credit.id = line."creditNoteId"
    WHERE line.id = NEW."creditNoteLineId" AND credit.status = 'POSTED'
      AND line."invoiceLineId" = NEW."invoiceLineId"
      AND NEW."quantityMicros" <= line."quantityMicros"
  ) THEN
    RAISE EXCEPTION 'Customer returns require a posted eligible credit line';
  ELSIF NEW."movementType" = 'VENDOR_RETURN'
    AND (NEW."vendorCreditLineId" IS NULL OR NEW."billLineId" IS NULL) THEN
    RAISE EXCEPTION 'Vendor returns require bill and vendor-credit lines';
  ELSIF NEW."movementType" = 'VENDOR_RETURN' AND NOT EXISTS (
    SELECT 1 FROM "VendorCreditLine" line
    JOIN "VendorCredit" credit ON credit.id = line."vendorCreditId"
    WHERE line.id = NEW."vendorCreditLineId"
      AND credit.status IN ('POSTED', 'APPLIED')
      AND line."billLineId" = NEW."billLineId"
  ) THEN
    RAISE EXCEPTION 'Vendor returns require a posted eligible vendor credit line';
  ELSIF NEW."movementType" IN ('TRANSFER_IN', 'TRANSFER_OUT')
    AND (NEW."journalId" IS NOT NULL OR NEW."offsetAccountId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Inventory transfers cannot carry financial postings';
  END IF;
  IF NEW."reversalOfMovementId" IS NOT NULL THEN
    SELECT "organizationId", "productItemId", "locationId", "quantityMicros", "totalValueMinor"
      INTO ref_org, ref_product, ref_location, ref_qty, ref_value
    FROM "InventoryMovement" WHERE "id" = NEW."reversalOfMovementId";
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR ref_product IS DISTINCT FROM NEW."productItemId"
      OR ref_location IS DISTINCT FROM NEW."locationId"
      OR NEW."quantityMicros" <> -ref_qty
      OR NEW."totalValueMinor" <> -ref_value THEN
      RAISE EXCEPTION 'Inventory reversal must exactly invert its source movement';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "FiscalPeriod"
    WHERE "organizationId" = NEW."organizationId"
      AND NEW."eventDate" BETWEEN "startDate" AND "endDate"
      AND "status" = 'OPEN'
  ) THEN
    RAISE EXCEPTION 'Inventory movement date must be in an open fiscal period';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryLocation_reference_trigger"
BEFORE INSERT OR UPDATE ON "InventoryLocation"
FOR EACH ROW EXECUTE FUNCTION phase9_inventory_reference_guard();
CREATE TRIGGER "InventoryBalance_reference_trigger"
BEFORE INSERT OR UPDATE ON "InventoryBalance"
FOR EACH ROW EXECUTE FUNCTION phase9_inventory_reference_guard();
CREATE TRIGGER "InventoryMovement_reference_trigger"
BEFORE INSERT ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION phase9_inventory_reference_guard();

CREATE OR REPLACE FUNCTION phase9_inventory_configuration_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ref_org UUID;
  ref_type "AccountType";
  ref_control BOOLEAN;
  configured_id UUID;
BEGIN
  IF TG_TABLE_NAME = 'BillLine' THEN
    IF NEW."productItemId" IS NULL THEN RETURN NEW; END IF;
    SELECT "organizationId", "purchaseClearingAccountId" INTO ref_org, configured_id
      FROM "ProductItem"
     WHERE id = NEW."productItemId" AND "itemType" = 'INVENTORY_PRODUCT';
    IF ref_org IS DISTINCT FROM NEW."organizationId"
      OR configured_id IS NULL OR NEW."accountId" IS DISTINCT FROM configured_id THEN
      RAISE EXCEPTION 'Inventory bill line tenant, product, or clearing account mismatch';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."itemType" <> 'INVENTORY_PRODUCT' THEN RETURN NEW; END IF;
  IF NEW."inventoryAssetAccountId" IS NULL
    OR NEW."costOfGoodsSoldAccountId" IS NULL
    OR NEW."purchaseClearingAccountId" IS NULL
    OR NEW."adjustmentGainAccountId" IS NULL
    OR NEW."inventoryLossAccountId" IS NULL
    OR NEW."defaultLocationId" IS NULL THEN
    RAISE EXCEPTION 'Inventory product configuration is incomplete';
  END IF;
  FOREACH configured_id IN ARRAY ARRAY[
    NEW."inventoryAssetAccountId", NEW."costOfGoodsSoldAccountId",
    NEW."purchaseClearingAccountId", NEW."adjustmentGainAccountId",
    NEW."inventoryLossAccountId"
  ] LOOP
    SELECT "organizationId", "type", "isControl"
      INTO ref_org, ref_type, ref_control
      FROM "Account" WHERE id = configured_id;
    IF ref_org IS DISTINCT FROM NEW."organizationId" OR ref_control THEN
      RAISE EXCEPTION 'Inventory product account tenant or control status mismatch';
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM "Account"
    WHERE id = NEW."inventoryAssetAccountId" AND "type" = 'ASSET'
  ) OR NOT EXISTS (
    SELECT 1 FROM "Account"
    WHERE id = NEW."purchaseClearingAccountId" AND "type" = 'ASSET'
  ) OR NOT EXISTS (
    SELECT 1 FROM "Account"
    WHERE id = NEW."costOfGoodsSoldAccountId" AND "type" = 'EXPENSE'
  ) OR NOT EXISTS (
    SELECT 1 FROM "Account"
    WHERE id = NEW."inventoryLossAccountId" AND "type" = 'EXPENSE'
  ) OR NOT EXISTS (
    SELECT 1 FROM "Account"
    WHERE id = NEW."adjustmentGainAccountId"
      AND "type" IN ('REVENUE', 'CONTRA_REVENUE')
  ) THEN
    RAISE EXCEPTION 'Inventory product account types are invalid';
  END IF;
  SELECT "organizationId" INTO ref_org FROM "InventoryLocation"
   WHERE id = NEW."defaultLocationId" AND "isActive";
  IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'Inventory product default location tenant mismatch';
  END IF;
  IF NEW."preferredVendorId" IS NOT NULL THEN
    SELECT "organizationId" INTO ref_org FROM "Vendor"
     WHERE id = NEW."preferredVendorId" AND "isActive";
    IF ref_org IS DISTINCT FROM NEW."organizationId" THEN
      RAISE EXCEPTION 'Inventory product preferred vendor tenant mismatch';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProductItem_inventory_configuration_trigger"
BEFORE INSERT OR UPDATE ON "ProductItem"
FOR EACH ROW EXECUTE FUNCTION phase9_inventory_configuration_guard();
CREATE TRIGGER "BillLine_inventory_configuration_trigger"
BEFORE INSERT OR UPDATE ON "BillLine"
FOR EACH ROW EXECUTE FUNCTION phase9_inventory_configuration_guard();

CREATE OR REPLACE FUNCTION phase9_inventory_history_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movement history is append-only';
END;
$$;
CREATE TRIGGER "InventoryMovement_history_trigger"
BEFORE UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION phase9_inventory_history_guard();

CREATE OR REPLACE FUNCTION phase9_validate_inventory_projection()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item_id UUID;
  site_id UUID;
  movement_quantity NUMERIC;
  movement_value NUMERIC;
  balance_quantity BIGINT;
  balance_value BIGINT;
  balance_average BIGINT;
  expected_average NUMERIC;
BEGIN
  item_id := COALESCE(NEW."productItemId", OLD."productItemId");
  site_id := COALESCE(NEW."locationId", OLD."locationId");
  SELECT COALESCE(sum("quantityMicros"), 0), COALESCE(sum("totalValueMinor"), 0)
    INTO movement_quantity, movement_value
  FROM "InventoryMovement"
  WHERE "productItemId" = item_id AND "locationId" = site_id;
  SELECT "quantityOnHandMicros", "valueOnHandMinor", "averageUnitCostMicros"
    INTO balance_quantity, balance_value, balance_average
  FROM "InventoryBalance"
  WHERE "productItemId" = item_id AND "locationId" = site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory movement requires a matching balance projection';
  END IF;
  expected_average := CASE WHEN balance_quantity = 0 THEN 0
    ELSE (balance_value::numeric * 1000000000000 + balance_quantity / 2) / balance_quantity
  END;
  IF movement_quantity <> balance_quantity
    OR movement_value <> balance_value
    OR balance_average <> trunc(expected_average) THEN
    RAISE EXCEPTION 'Inventory balance projection does not reconcile to movements';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "InventoryMovement_projection_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "InventoryMovement"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase9_validate_inventory_projection();
CREATE CONSTRAINT TRIGGER "InventoryBalance_projection_trigger"
AFTER INSERT OR UPDATE OR DELETE ON "InventoryBalance"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase9_validate_inventory_projection();

CREATE OR REPLACE FUNCTION phase9_validate_inventory_transfer()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  out_quantity NUMERIC;
  in_quantity NUMERIC;
  out_value NUMERIC;
  in_value NUMERIC;
  location_count INTEGER;
BEGIN
  IF NEW."movementType" NOT IN ('TRANSFER_IN', 'TRANSFER_OUT') THEN RETURN NULL; END IF;
  SELECT
    COALESCE(sum("quantityMicros") FILTER (WHERE "movementType" = 'TRANSFER_OUT'), 0),
    COALESCE(sum("quantityMicros") FILTER (WHERE "movementType" = 'TRANSFER_IN'), 0),
    COALESCE(sum("totalValueMinor") FILTER (WHERE "movementType" = 'TRANSFER_OUT'), 0),
    COALESCE(sum("totalValueMinor") FILTER (WHERE "movementType" = 'TRANSFER_IN'), 0),
    count(DISTINCT "locationId")
  INTO out_quantity, in_quantity, out_value, in_value, location_count
  FROM "InventoryMovement" WHERE "eventId" = NEW."eventId";
  IF out_quantity + in_quantity <> 0 OR out_value + in_value <> 0 OR location_count <> 2 THEN
    RAISE EXCEPTION 'Inventory transfer movements must be an exact two-location pair';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "InventoryMovement_transfer_trigger"
AFTER INSERT ON "InventoryMovement"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION phase9_validate_inventory_transfer();

CREATE OR REPLACE FUNCTION phase9_inventory_location_history_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Inventory locations cannot be deleted'; END IF;
  IF EXISTS (SELECT 1 FROM "InventoryMovement" WHERE "locationId" = OLD."id")
    AND (NEW."organizationId" <> OLD."organizationId" OR NEW."code" <> OLD."code") THEN
    RAISE EXCEPTION 'Historical inventory location identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "InventoryLocation_history_trigger"
BEFORE UPDATE OR DELETE ON "InventoryLocation"
FOR EACH ROW EXECUTE FUNCTION phase9_inventory_location_history_guard();

GRANT SELECT, INSERT, UPDATE ON "InventoryLocation", "InventoryBalance" TO clearledger_runtime;
GRANT SELECT, INSERT ON "InventoryMovement" TO clearledger_runtime;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['InventoryLocation', 'InventoryBalance', 'InventoryMovement']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING (
        "organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()
      ) WITH CHECK (
        "organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()
      )',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END;
$$;
