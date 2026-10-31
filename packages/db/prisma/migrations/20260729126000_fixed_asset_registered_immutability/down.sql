DO $rollback$
BEGIN
  IF to_regclass('public."FixedAsset"') IS NULL THEN
    RETURN;
  END IF;

  GRANT DELETE ON TABLE "FixedAsset" TO clearledger_runtime;

  DROP TRIGGER IF EXISTS "FixedAsset_registered_immutable" ON "FixedAsset";
  DROP FUNCTION IF EXISTS prevent_registered_fixed_asset_update();
END;
$rollback$;
