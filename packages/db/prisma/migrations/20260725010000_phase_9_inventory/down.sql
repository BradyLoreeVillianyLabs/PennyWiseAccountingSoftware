DO $rollback$
BEGIN
  IF to_regclass('public."InventoryMovement"') IS NULL THEN
    RETURN;
  END IF;

  DROP TABLE "InventoryMovement";
DROP TABLE "InventoryBalance";
ALTER TABLE "ProductItem" DROP CONSTRAINT "ProductItem_defaultLocationId_fkey";
DROP TABLE "InventoryLocation";

ALTER TABLE "BillLine" DROP COLUMN "productItemId";
ALTER TABLE "ProductItem"
  DROP COLUMN "adjustmentGainAccountId",
  DROP COLUMN "costOfGoodsSoldAccountId",
  DROP COLUMN "defaultLocationId",
  DROP COLUMN "inventoryLossAccountId",
  DROP COLUMN "preferredVendorId",
  DROP COLUMN "purchaseClearingAccountId",
  DROP COLUMN "reorderPointMicros";

DROP FUNCTION phase9_inventory_location_history_guard();
DROP FUNCTION phase9_validate_inventory_transfer();
DROP FUNCTION phase9_validate_inventory_projection();
DROP FUNCTION phase9_inventory_history_guard();
DROP FUNCTION phase9_inventory_reference_guard();

DROP TYPE "InventoryReturnDisposition";
DROP TYPE "InventoryAdjustmentKind";
DROP TYPE "InventoryMovementType";
DROP TRIGGER IF EXISTS "BillLine_inventory_configuration_trigger" ON "BillLine";
DROP TRIGGER IF EXISTS "ProductItem_inventory_configuration_trigger" ON "ProductItem";
  DROP FUNCTION IF EXISTS phase9_inventory_configuration_guard();
END;
$rollback$;
