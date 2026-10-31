CREATE OR REPLACE FUNCTION prevent_registered_fixed_asset_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'REGISTERED' THEN
    RAISE EXCEPTION 'Registered fixed assets are immutable; create a reviewed correction instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FixedAsset_registered_immutable"
BEFORE UPDATE ON "FixedAsset"
FOR EACH ROW EXECUTE FUNCTION prevent_registered_fixed_asset_update();

-- Fixed assets are lifecycle records. The runtime may cancel drafts but must never delete history.
REVOKE DELETE ON TABLE "FixedAsset" FROM clearledger_runtime;
