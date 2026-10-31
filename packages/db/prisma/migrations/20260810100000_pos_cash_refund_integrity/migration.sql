-- A cash refund belongs to the drawer that physically paid it out, not to the
-- historical drawer that accepted the original sale. Keep that relationship as
-- durable evidence and reject any late/direct cash event against a closed shift.
ALTER TABLE "PosReturn" ADD COLUMN "refundShiftId" UUID;
CREATE INDEX "PosReturn_organizationId_refundShiftId_idx"
  ON "PosReturn"("organizationId", "refundShiftId");
ALTER TABLE "PosReturn"
  ADD CONSTRAINT "PosReturn_refundShiftId_fkey"
  FOREIGN KEY ("refundShiftId") REFERENCES "PosShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION pos_return_company_guard() RETURNS trigger AS $$
DECLARE
  sale_company UUID;
  sale_cash_account UUID;
  refund_company UUID;
  refund_cash_account UUID;
BEGIN
  SELECT sale."companyId", register."cashAccountId"
    INTO sale_company, sale_cash_account
    FROM "PosSale" sale
    JOIN "PosRegister" register ON register."id" = sale."registerId"
   WHERE sale."id" = NEW."saleId";
  IF sale_company IS NULL OR sale_company IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'POS return company mismatch';
  END IF;

  IF NEW."refundShiftId" IS NOT NULL THEN
    SELECT shift."companyId", register."cashAccountId"
      INTO refund_company, refund_cash_account
      FROM "PosShift" shift
      JOIN "PosRegister" register ON register."id" = shift."registerId"
     WHERE shift."id" = NEW."refundShiftId";
    IF refund_company IS NULL
       OR refund_company IS DISTINCT FROM NEW."companyId"
       OR refund_cash_account IS DISTINCT FROM sale_cash_account THEN
      RAISE EXCEPTION 'POS refund shift must use the original sale cash account';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pos_cash_event_open_shift_guard() RETURNS trigger AS $$
DECLARE shift_status "PosShiftStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'POS cash events are append-only';
  END IF;
  SELECT "status" INTO shift_status FROM "PosShift" WHERE "id" = NEW."shiftId";
  IF shift_status IS DISTINCT FROM 'OPEN' THEN
    RAISE EXCEPTION 'POS cash events require an open shift';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PosCashEvent_open_shift_append_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "PosCashEvent"
  FOR EACH ROW EXECUTE FUNCTION pos_cash_event_open_shift_guard();
