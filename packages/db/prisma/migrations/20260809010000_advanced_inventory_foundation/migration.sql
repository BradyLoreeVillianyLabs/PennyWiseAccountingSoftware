-- Advanced inventory foundation: company-aware policy, storage dimensions,
-- reservations, staged transfers, lot/serial traceability, and stocktakes.

CREATE TYPE "InventoryCostingMethod" AS ENUM ('WEIGHTED_AVERAGE', 'FIFO');
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'ALLOCATED', 'FULFILLED', 'CANCELLED');
CREATE TYPE "InventoryTransferStatus" AS ENUM ('DRAFT', 'APPROVED', 'PICKED', 'SHIPPED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');
CREATE TYPE "InventoryCountStatus" AS ENUM ('DRAFT', 'RELEASED', 'COUNTING', 'SUBMITTED', 'PENDING_APPROVAL', 'APPROVED', 'POSTED', 'CANCELLED');
CREATE TYPE "InventorySerialState" AS ENUM ('AVAILABLE', 'RESERVED', 'IN_TRANSIT', 'SOLD', 'DAMAGED', 'EXPIRED', 'QUARANTINED');

ALTER TABLE "ProductItem"
  ADD COLUMN "companyId" UUID,
  ADD COLUMN "safetyStockMicros" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "preferredStockMicros" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "orderMultipleMicros" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "minimumOrderMicros" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "inventoryCostingMethod" "InventoryCostingMethod" NOT NULL DEFAULT 'WEIGHTED_AVERAGE';

ALTER TABLE "InventoryLocation" ADD COLUMN "companyId" UUID;
ALTER TABLE "InventoryBalance" ADD COLUMN "companyId" UUID;
ALTER TABLE "InventoryMovement"
  ADD COLUMN "companyId" UUID,
  ADD COLUMN "binId" UUID,
  ADD COLUMN "statusId" UUID,
  ADD COLUMN "lotId" UUID,
  ADD COLUMN "serialId" UUID,
  ADD COLUMN "reservationId" UUID;

UPDATE "ProductItem" p
   SET "companyId" = c.id
  FROM "Company" c
 WHERE p."companyId" IS NULL
   AND c."organizationId" = p."organizationId"
   AND c."isDefault";
UPDATE "ProductItem" p
   SET "companyId" = c.id
  FROM "Company" c
 WHERE p."companyId" IS NULL
   AND c."organizationId" = p."organizationId"
   AND c.status = 'ACTIVE';
UPDATE "InventoryLocation" l
   SET "companyId" = c.id
  FROM "Company" c
 WHERE l."companyId" IS NULL
   AND c."organizationId" = l."organizationId"
   AND c."isDefault";
UPDATE "InventoryLocation" l
   SET "companyId" = c.id
  FROM "Company" c
 WHERE l."companyId" IS NULL
   AND c."organizationId" = l."organizationId"
   AND c.status = 'ACTIVE';
UPDATE "InventoryBalance" b
   SET "companyId" = p."companyId"
  FROM "ProductItem" p
 WHERE b."companyId" IS NULL AND p.id = b."productItemId";
UPDATE "InventoryMovement" m
   SET "companyId" = p."companyId"
  FROM "ProductItem" p
 WHERE m."companyId" IS NULL AND p.id = m."productItemId";

CREATE TABLE "InventoryBin" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "locationId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "pickPriority" INTEGER NOT NULL DEFAULT 0,
  "capacityMicros" BIGINT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventoryBin_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InventoryStatus" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sellable" BOOLEAN NOT NULL DEFAULT true,
  "allocatable" BOOLEAN NOT NULL DEFAULT true,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventoryStatus_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InventoryLot" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "productItemId" UUID NOT NULL,
  "lotNumber" TEXT NOT NULL,
  "receivedAt" DATE,
  "expiryDate" DATE,
  "supplierId" UUID,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InventorySerial" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "productItemId" UUID NOT NULL,
  "serialNumber" TEXT NOT NULL,
  "lotId" UUID,
  "locationId" UUID,
  "binId" UUID,
  "statusId" UUID,
  "state" "InventorySerialState" NOT NULL DEFAULT 'AVAILABLE',
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventorySerial_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InventoryReservation" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "productItemId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "binId" UUID,
  "lotId" UUID,
  "statusId" UUID,
  "quantityMicros" BIGINT NOT NULL,
  "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
  "sourceType" TEXT NOT NULL,
  "sourceId" UUID NOT NULL,
  "sourceLineId" UUID,
  "idempotencyKey" TEXT,
  "expiresAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "releasedAt" TIMESTAMPTZ(6),
  "fulfilledAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InventoryTransfer" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "fromLocationId" UUID NOT NULL,
  "toLocationId" UUID NOT NULL,
  "status" "InventoryTransferStatus" NOT NULL DEFAULT 'DRAFT',
  "transferNumber" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "reason" TEXT,
  "requestedByUserId" UUID NOT NULL,
  "approvedByUserId" UUID,
  "shippedAt" TIMESTAMPTZ(6),
  "receivedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventoryTransfer_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InventoryTransferLine" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "transferId" UUID NOT NULL,
  "productItemId" UUID NOT NULL,
  "quantityMicros" BIGINT NOT NULL,
  "shippedMicros" BIGINT NOT NULL DEFAULT 0,
  "receivedMicros" BIGINT NOT NULL DEFAULT 0,
  "unitValueMinor" BIGINT NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "InventoryTransferLine_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InventoryCount" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "locationId" UUID NOT NULL,
  "status" "InventoryCountStatus" NOT NULL DEFAULT 'DRAFT',
  "countNumber" TEXT NOT NULL,
  "blind" BOOLEAN NOT NULL DEFAULT false,
  "snapshotAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMPTZ(6),
  "submittedAt" TIMESTAMPTZ(6),
  "approvedAt" TIMESTAMPTZ(6),
  "approvedByUserId" UUID,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InventoryCount_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InventoryCountLine" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "companyId" UUID,
  "countId" UUID NOT NULL,
  "productItemId" UUID NOT NULL,
  "expectedMicros" BIGINT NOT NULL,
  "countedMicros" BIGINT,
  "varianceMicros" BIGINT,
  "countedAt" TIMESTAMPTZ(6),
  "countedByUserId" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryBin_locationId_code_key" ON "InventoryBin"("locationId", "code");
CREATE UNIQUE INDEX "InventoryBin_organizationId_id_key" ON "InventoryBin"("organizationId", "id");
CREATE INDEX "InventoryBin_company_location_active_idx" ON "InventoryBin"("organizationId", "companyId", "locationId", "isActive");
CREATE UNIQUE INDEX "InventoryStatus_organizationId_companyId_code_key" ON "InventoryStatus"("organizationId", "companyId", "code");
CREATE UNIQUE INDEX "InventoryStatus_organizationId_id_key" ON "InventoryStatus"("organizationId", "id");
CREATE INDEX "InventoryStatus_company_allocatable_idx" ON "InventoryStatus"("organizationId", "companyId", "allocatable", "sellable");
CREATE UNIQUE INDEX "InventoryLot_productItemId_lotNumber_key" ON "InventoryLot"("productItemId", "lotNumber");
CREATE UNIQUE INDEX "InventoryLot_organizationId_id_key" ON "InventoryLot"("organizationId", "id");
CREATE INDEX "InventoryLot_company_product_expiry_idx" ON "InventoryLot"("organizationId", "companyId", "productItemId", "expiryDate");
CREATE UNIQUE INDEX "InventorySerial_productItemId_serialNumber_key" ON "InventorySerial"("productItemId", "serialNumber");
CREATE UNIQUE INDEX "InventorySerial_organizationId_id_key" ON "InventorySerial"("organizationId", "id");
CREATE INDEX "InventorySerial_company_serial_idx" ON "InventorySerial"("organizationId", "companyId", "serialNumber");
CREATE UNIQUE INDEX "InventoryReservation_source_key" ON "InventoryReservation"("organizationId", "sourceType", "sourceId", "sourceLineId");
CREATE UNIQUE INDEX "InventoryReservation_idempotency_key" ON "InventoryReservation"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "InventoryReservation_organizationId_id_key" ON "InventoryReservation"("organizationId", "id");
CREATE INDEX "InventoryReservation_company_state_idx" ON "InventoryReservation"("organizationId", "companyId", "productItemId", "locationId", "status");
CREATE INDEX "InventoryReservation_expiry_idx" ON "InventoryReservation"("organizationId", "expiresAt", "status");
CREATE UNIQUE INDEX "InventoryTransfer_number_key" ON "InventoryTransfer"("organizationId", "transferNumber");
CREATE UNIQUE INDEX "InventoryTransfer_idempotency_key" ON "InventoryTransfer"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "InventoryTransfer_organizationId_id_key" ON "InventoryTransfer"("organizationId", "id");
CREATE INDEX "InventoryTransfer_company_state_idx" ON "InventoryTransfer"("organizationId", "companyId", "status", "createdAt");
CREATE UNIQUE INDEX "InventoryTransferLine_transfer_product_key" ON "InventoryTransferLine"("transferId", "productItemId");
CREATE UNIQUE INDEX "InventoryTransferLine_organizationId_id_key" ON "InventoryTransferLine"("organizationId", "id");
CREATE INDEX "InventoryTransferLine_product_idx" ON "InventoryTransferLine"("organizationId", "productItemId");
CREATE UNIQUE INDEX "InventoryCount_number_key" ON "InventoryCount"("organizationId", "countNumber");
CREATE UNIQUE INDEX "InventoryCount_organizationId_id_key" ON "InventoryCount"("organizationId", "id");
CREATE INDEX "InventoryCount_company_state_idx" ON "InventoryCount"("organizationId", "companyId", "locationId", "status");
CREATE UNIQUE INDEX "InventoryCountLine_count_product_key" ON "InventoryCountLine"("countId", "productItemId");
CREATE UNIQUE INDEX "InventoryCountLine_organizationId_id_key" ON "InventoryCountLine"("organizationId", "id");
CREATE INDEX "InventoryCountLine_product_idx" ON "InventoryCountLine"("organizationId", "productItemId");
CREATE INDEX "ProductItem_company_active_name_idx" ON "ProductItem"("organizationId", "companyId", "active", "name");

UPDATE "InventoryTransferLine" l
   SET "companyId" = t."companyId"
  FROM "InventoryTransfer" t
 WHERE l."transferId" = t.id;
UPDATE "InventoryCountLine" l
   SET "companyId" = c."companyId"
  FROM "InventoryCount" c
 WHERE l."countId" = c.id;

ALTER TABLE "ProductItem" ADD CONSTRAINT "ProductItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryLocation" ADD CONSTRAINT "InventoryLocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryBin" ADD CONSTRAINT "InventoryBin_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryBin_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryBin_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryStatus" ADD CONSTRAINT "InventoryStatus_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryStatus_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryLot" ADD CONSTRAINT "InventoryLot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryLot_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryLot_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventorySerial" ADD CONSTRAINT "InventorySerial_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventorySerial_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventorySerial_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventorySerial_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventorySerial_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventorySerial_binId_fkey" FOREIGN KEY ("binId") REFERENCES "InventoryBin"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventorySerial_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "InventoryStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryReservation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryReservation_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryReservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryReservation_binId_fkey" FOREIGN KEY ("binId") REFERENCES "InventoryBin"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryReservation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryReservation_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "InventoryStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryTransfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryTransfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryTransferLine" ADD CONSTRAINT "InventoryTransferLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryTransferLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "InventoryTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryTransferLine_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryCount" ADD CONSTRAINT "InventoryCount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryCount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryCountLine_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "InventoryCount"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryCountLine_productItemId_fkey" FOREIGN KEY ("productItemId") REFERENCES "ProductItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_binId_fkey" FOREIGN KEY ("binId") REFERENCES "InventoryBin"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovement_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "InventoryStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovement_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovement_serialId_fkey" FOREIGN KEY ("serialId") REFERENCES "InventorySerial"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "InventoryMovement_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "InventoryReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryBin" ADD CONSTRAINT "InventoryBin_quantity_check" CHECK ("capacityMicros" IS NULL OR "capacityMicros" >= 0);
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_quantity_check" CHECK ("quantityMicros" > 0);
ALTER TABLE "InventoryTransfer" ADD CONSTRAINT "InventoryTransfer_locations_check" CHECK ("fromLocationId" <> "toLocationId");
ALTER TABLE "InventoryTransferLine" ADD CONSTRAINT "InventoryTransferLine_quantity_check" CHECK ("quantityMicros" > 0 AND "shippedMicros" >= 0 AND "receivedMicros" >= 0 AND "shippedMicros" <= "quantityMicros" AND "receivedMicros" <= "shippedMicros");
ALTER TABLE "InventoryCountLine" ADD CONSTRAINT "InventoryCountLine_count_check" CHECK ("expectedMicros" >= 0 AND ("countedMicros" IS NULL OR "countedMicros" >= 0));

CREATE OR REPLACE FUNCTION advanced_inventory_company_guard() RETURNS trigger AS $$
DECLARE ref_org UUID; ref_company UUID;
BEGIN
  IF NEW."companyId" IS NULL THEN RETURN NEW; END IF;
  SELECT "organizationId" INTO ref_org FROM "Company" WHERE id = NEW."companyId";
  IF ref_org IS NULL OR ref_org <> NEW."organizationId" THEN
    RAISE EXCEPTION 'advanced inventory company mismatch';
  END IF;
  IF TG_TABLE_NAME = 'InventoryBalance' THEN
    SELECT "companyId" INTO ref_company FROM "ProductItem" WHERE id = NEW."productItemId";
    IF ref_company IS NOT NULL AND ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'inventory balance product company mismatch'; END IF;
    SELECT "companyId" INTO ref_company FROM "InventoryLocation" WHERE id = NEW."locationId";
    IF ref_company IS NOT NULL AND ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'inventory balance location company mismatch'; END IF;
  ELSIF TG_TABLE_NAME = 'InventoryMovement' THEN
    SELECT "companyId" INTO ref_company FROM "ProductItem" WHERE id = NEW."productItemId";
    IF ref_company IS NOT NULL AND ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'inventory movement product company mismatch'; END IF;
    SELECT "companyId" INTO ref_company FROM "InventoryLocation" WHERE id = NEW."locationId";
    IF ref_company IS NOT NULL AND ref_company IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'inventory movement location company mismatch'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ProductItem_company_guard" BEFORE INSERT OR UPDATE ON "ProductItem" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventoryLocation_company_guard" BEFORE INSERT OR UPDATE ON "InventoryLocation" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventoryBalance_company_guard" BEFORE INSERT OR UPDATE ON "InventoryBalance" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventoryMovement_company_guard" BEFORE INSERT OR UPDATE ON "InventoryMovement" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventoryBin_company_guard" BEFORE INSERT OR UPDATE ON "InventoryBin" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventoryStatus_company_guard" BEFORE INSERT OR UPDATE ON "InventoryStatus" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventoryLot_company_guard" BEFORE INSERT OR UPDATE ON "InventoryLot" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventorySerial_company_guard" BEFORE INSERT OR UPDATE ON "InventorySerial" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventoryReservation_company_guard" BEFORE INSERT OR UPDATE ON "InventoryReservation" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventoryTransfer_company_guard" BEFORE INSERT OR UPDATE ON "InventoryTransfer" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();
CREATE TRIGGER "InventoryCount_company_guard" BEFORE INSERT OR UPDATE ON "InventoryCount" FOR EACH ROW EXECUTE FUNCTION advanced_inventory_company_guard();

ALTER TABLE "ProductItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryBalance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryBin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryStatus" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryLot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventorySerial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryTransferLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryCount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryCountLine" ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['ProductItem','InventoryLocation','InventoryBalance','InventoryMovement','InventoryBin','InventoryStatus','InventoryLot','InventorySerial','InventoryReservation','InventoryTransfer','InventoryTransferLine','InventoryCount','InventoryCountLine'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON "%s"', t || '_tenant_policy', t);
    EXECUTE format('CREATE POLICY %I ON "%s" FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access() AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id())) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access() AND (app_current_company_id() IS NULL OR "companyId" = app_current_company_id()))', t || '_tenant_policy', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON "ProductItem","InventoryLocation","InventoryBalance","InventoryBin","InventoryStatus","InventoryLot","InventorySerial","InventoryReservation","InventoryTransfer","InventoryTransferLine","InventoryCount","InventoryCountLine" TO clearledger_runtime;
GRANT SELECT, INSERT ON "InventoryMovement" TO clearledger_runtime;
