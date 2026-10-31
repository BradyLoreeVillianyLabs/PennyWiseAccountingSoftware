DO $$
BEGIN
  IF to_regclass('public."ProductEvent"') IS NOT NULL THEN
    REVOKE INSERT ON TABLE "ProductEvent" FROM clearledger_runtime;
  END IF;
END $$;
