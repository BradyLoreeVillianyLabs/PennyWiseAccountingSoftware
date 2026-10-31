DO $$
BEGIN
  IF to_regclass('public."ProductEvent"') IS NOT NULL THEN
    COMMENT ON TABLE "ProductEvent" IS NULL;
  END IF;
END $$;
