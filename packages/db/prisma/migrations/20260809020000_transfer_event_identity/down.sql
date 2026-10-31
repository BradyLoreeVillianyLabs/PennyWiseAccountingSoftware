DROP INDEX IF EXISTS "InventoryTransferLine_organizationId_eventId_idx";
DO $$
BEGIN
  IF to_regclass('public."InventoryTransferLine"') IS NOT NULL THEN
    ALTER TABLE "InventoryTransferLine" DROP COLUMN IF EXISTS "eventId";
  END IF;
END $$;
