CREATE UNIQUE INDEX "InventoryReservation_source_without_line_key"
  ON "InventoryReservation" ("organizationId", "sourceType", "sourceId")
  WHERE "sourceLineId" IS NULL;
