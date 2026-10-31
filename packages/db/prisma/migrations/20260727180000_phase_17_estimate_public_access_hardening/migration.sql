DROP POLICY IF EXISTS "EstimatePublicLink_public_policy" ON "EstimatePublicLink";

CREATE POLICY "EstimatePublicLink_public_select_policy" ON "EstimatePublicLink"
  FOR SELECT TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND "tokenHash" = current_setting('app.public_invoice_token_hash', true)
  );

CREATE POLICY "EstimatePublicLink_public_update_policy" ON "EstimatePublicLink"
  FOR UPDATE TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND "tokenHash" = current_setting('app.public_invoice_token_hash', true)
  )
  WITH CHECK (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND "tokenHash" = current_setting('app.public_invoice_token_hash', true)
  );
