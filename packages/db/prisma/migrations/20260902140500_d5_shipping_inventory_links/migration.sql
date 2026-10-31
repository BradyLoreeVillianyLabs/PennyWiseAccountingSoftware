-- Link each shipment to the inventory movements that relieved its stock.
CREATE TABLE "ShipmentInventoryMovement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "shipmentId" UUID NOT NULL,
  "inventoryMovementId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShipmentInventoryMovement_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "ShipmentInventoryMovement" ADD CONSTRAINT "ShipmentInventoryMovement_organization_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE;
ALTER TABLE "ShipmentInventoryMovement" ADD CONSTRAINT "ShipmentInventoryMovement_shipment_fkey"
  FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE;
ALTER TABLE "ShipmentInventoryMovement" ADD CONSTRAINT "ShipmentInventoryMovement_inventoryMovement_fkey"
  FOREIGN KEY ("inventoryMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "ShipmentInventoryMovement_shipmentId_inventoryMovementId_key"
  ON "ShipmentInventoryMovement"("shipmentId", "inventoryMovementId");
CREATE UNIQUE INDEX "ShipmentInventoryMovement_organizationId_id_key"
  ON "ShipmentInventoryMovement"("organizationId", "id");
CREATE INDEX "ShipmentInventoryMovement_organizationId_inventoryMovementId_idx"
  ON "ShipmentInventoryMovement"("organizationId", "inventoryMovementId");
ALTER TABLE "ShipmentInventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShipmentInventoryMovement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ShipmentInventoryMovement_tenant_policy" ON "ShipmentInventoryMovement" FOR ALL TO clearledger_runtime
  USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())
  WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access());
GRANT SELECT, INSERT ON "ShipmentInventoryMovement" TO clearledger_runtime;
