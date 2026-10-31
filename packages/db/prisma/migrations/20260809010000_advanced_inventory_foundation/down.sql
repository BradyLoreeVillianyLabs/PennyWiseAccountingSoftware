-- Reverse the advanced inventory layer before phase 9 removes its base tables.
-- Keep the order dependency-safe so this file can run in a disposable rollback
-- verification database as well as during an operational rollback.

DROP TRIGGER IF EXISTS "ProductItem_company_guard" ON "ProductItem";
DROP TRIGGER IF EXISTS "InventoryLocation_company_guard" ON "InventoryLocation";
DROP TRIGGER IF EXISTS "InventoryBalance_company_guard" ON "InventoryBalance";
DROP TRIGGER IF EXISTS "InventoryMovement_company_guard" ON "InventoryMovement";
DROP TRIGGER IF EXISTS "InventoryBin_company_guard" ON "InventoryBin";
DROP TRIGGER IF EXISTS "InventoryStatus_company_guard" ON "InventoryStatus";
DROP TRIGGER IF EXISTS "InventoryLot_company_guard" ON "InventoryLot";
DROP TRIGGER IF EXISTS "InventorySerial_company_guard" ON "InventorySerial";
DROP TRIGGER IF EXISTS "InventoryReservation_company_guard" ON "InventoryReservation";
DROP TRIGGER IF EXISTS "InventoryTransfer_company_guard" ON "InventoryTransfer";
DROP TRIGGER IF EXISTS "InventoryCount_company_guard" ON "InventoryCount";
DROP FUNCTION IF EXISTS advanced_inventory_company_guard();

DROP POLICY IF EXISTS "InventoryBin_tenant_policy" ON "InventoryBin";
DROP POLICY IF EXISTS "InventoryStatus_tenant_policy" ON "InventoryStatus";
DROP POLICY IF EXISTS "InventoryLot_tenant_policy" ON "InventoryLot";
DROP POLICY IF EXISTS "InventorySerial_tenant_policy" ON "InventorySerial";
DROP POLICY IF EXISTS "InventoryReservation_tenant_policy" ON "InventoryReservation";
DROP POLICY IF EXISTS "InventoryTransfer_tenant_policy" ON "InventoryTransfer";
DROP POLICY IF EXISTS "InventoryTransferLine_tenant_policy" ON "InventoryTransferLine";
DROP POLICY IF EXISTS "InventoryCount_tenant_policy" ON "InventoryCount";
DROP POLICY IF EXISTS "InventoryCountLine_tenant_policy" ON "InventoryCountLine";
DROP POLICY IF EXISTS "ProductItem_tenant_policy" ON "ProductItem";

DO $$
BEGIN
  IF to_regclass('public."ProductItem"') IS NOT NULL THEN
    ALTER TABLE "ProductItem"
      DROP CONSTRAINT IF EXISTS "ProductItem_companyId_fkey";
  END IF;
  IF to_regclass('public."InventoryMovement"') IS NOT NULL THEN
    ALTER TABLE "InventoryMovement"
      DROP CONSTRAINT IF EXISTS "InventoryMovement_binId_fkey",
      DROP CONSTRAINT IF EXISTS "InventoryMovement_statusId_fkey",
      DROP CONSTRAINT IF EXISTS "InventoryMovement_lotId_fkey",
      DROP CONSTRAINT IF EXISTS "InventoryMovement_serialId_fkey",
      DROP CONSTRAINT IF EXISTS "InventoryMovement_reservationId_fkey";
  END IF;
END $$;

DROP TABLE IF EXISTS "InventoryCountLine";
DROP TABLE IF EXISTS "InventoryTransferLine";
DROP TABLE IF EXISTS "InventorySerial";
DROP TABLE IF EXISTS "InventoryReservation";
DROP TABLE IF EXISTS "InventoryCount";
DROP TABLE IF EXISTS "InventoryTransfer";
DROP TABLE IF EXISTS "InventoryBin";
DROP TABLE IF EXISTS "InventoryLot";
DROP TABLE IF EXISTS "InventoryStatus";

DROP INDEX IF EXISTS "ProductItem_company_active_name_idx";
DO $$
BEGIN
  IF to_regclass('public."ProductItem"') IS NOT NULL THEN
    ALTER TABLE "ProductItem"
      DROP COLUMN IF EXISTS "companyId",
      DROP COLUMN IF EXISTS "safetyStockMicros",
      DROP COLUMN IF EXISTS "preferredStockMicros",
      DROP COLUMN IF EXISTS "leadTimeDays",
      DROP COLUMN IF EXISTS "orderMultipleMicros",
      DROP COLUMN IF EXISTS "minimumOrderMicros",
      DROP COLUMN IF EXISTS "inventoryCostingMethod";
  END IF;
END $$;

DROP TYPE IF EXISTS "InventorySerialState";
DROP TYPE IF EXISTS "InventoryCountStatus";
DROP TYPE IF EXISTS "InventoryTransferStatus";
DROP TYPE IF EXISTS "InventoryReservationStatus";
DROP TYPE IF EXISTS "InventoryCostingMethod";
