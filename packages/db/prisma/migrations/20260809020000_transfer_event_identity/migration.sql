ALTER TABLE "InventoryTransferLine"
  ADD COLUMN "eventId" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX "InventoryTransferLine_organizationId_eventId_idx"
  ON "InventoryTransferLine" ("organizationId", "eventId");
