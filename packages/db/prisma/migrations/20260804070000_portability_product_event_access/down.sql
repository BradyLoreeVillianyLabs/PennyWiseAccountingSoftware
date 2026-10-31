DO $$
BEGIN
  IF to_regclass('public."ProductEvent"') IS NOT NULL THEN
    REVOKE SELECT ON TABLE "ProductEvent" FROM clearledger_runtime;
  END IF;
END $$;
