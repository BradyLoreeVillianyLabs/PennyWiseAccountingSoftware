DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'PosRegister', 'PosDevice', 'PosShift', 'PosSale', 'PosSaleLine',
    'PosTender', 'PosCashEvent'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE %I FROM clearledger_runtime',
        table_name
      );
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS "PosCashEvent_company_guard" ON "PosCashEvent";
DROP TRIGGER IF EXISTS "PosTender_company_guard" ON "PosTender";
DROP TRIGGER IF EXISTS "PosSaleLine_company_guard" ON "PosSaleLine";
DROP TRIGGER IF EXISTS "PosSale_company_guard" ON "PosSale";
DROP TRIGGER IF EXISTS "PosShift_company_guard" ON "PosShift";
DROP TRIGGER IF EXISTS "PosDevice_company_guard" ON "PosDevice";
DROP TRIGGER IF EXISTS "PosRegister_company_guard" ON "PosRegister";
DROP FUNCTION IF EXISTS pos_company_guard();

DROP TABLE IF EXISTS "PosTender";
DROP TABLE IF EXISTS "PosSaleLine";
DROP TABLE IF EXISTS "PosCashEvent";
DROP TABLE IF EXISTS "PosSale";
DROP TABLE IF EXISTS "PosShift";
DROP TABLE IF EXISTS "PosDevice";
DROP TABLE IF EXISTS "PosRegister";

DROP TYPE IF EXISTS "PosCashEventType";
DROP TYPE IF EXISTS "PosTenderStatus";
DROP TYPE IF EXISTS "PosTenderType";
DROP TYPE IF EXISTS "PosSaleStatus";
DROP TYPE IF EXISTS "PosShiftStatus";
DROP TYPE IF EXISTS "PosRegisterStatus";
