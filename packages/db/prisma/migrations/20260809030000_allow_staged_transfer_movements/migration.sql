CREATE OR REPLACE FUNCTION phase9_validate_inventory_transfer()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  out_quantity NUMERIC;
  in_quantity NUMERIC;
  out_value NUMERIC;
  in_value NUMERIC;
  location_count INTEGER;
  staged_transfer BOOLEAN;
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
  IF out_quantity + in_quantity = 0 AND out_value + in_value = 0 AND location_count = 2 THEN
    RETURN NULL;
  END IF;
  SELECT EXISTS (
    SELECT 1
      FROM "InventoryTransfer" t
      JOIN "InventoryTransferLine" l ON l."transferId" = t.id AND l.id = NEW."sourceLineId"
     WHERE t.id = NEW."sourceId"
       AND t."organizationId" = NEW."organizationId"
       AND t.status IN ('DRAFT', 'APPROVED', 'PICKED', 'SHIPPED', 'PARTIALLY_RECEIVED', 'RECEIVED')
  ) INTO staged_transfer;
  IF NEW."sourceType" = 'inventory_transfer' AND NEW."sourceLineId" IS NOT NULL AND staged_transfer THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'Inventory transfer movements must be an exact two-location pair';
END;
$$;
