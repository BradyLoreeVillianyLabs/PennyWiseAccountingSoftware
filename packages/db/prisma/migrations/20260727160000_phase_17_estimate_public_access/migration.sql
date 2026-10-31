CREATE OR REPLACE FUNCTION phase17_public_estimate_access(target_org UUID, target_estimate UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
  SELECT current_setting('app.access_mode', true) = 'public_invoice'
    AND current_setting('app.public_invoice_token_hash', true) <> ''
    AND EXISTS (
      SELECT 1
      FROM public."EstimatePublicLink" link
      WHERE link."organizationId" = target_org
        AND link."estimateId" = target_estimate
        AND link."tokenHash" = current_setting('app.public_invoice_token_hash', true)
        AND link."revokedAt" IS NULL
        AND (link."expiresAt" IS NULL OR link."expiresAt" > CURRENT_TIMESTAMP)
    )
$$;
REVOKE ALL ON FUNCTION phase17_public_estimate_access(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION phase17_public_estimate_access(UUID, UUID) TO clearledger_runtime;

CREATE POLICY "EstimatePublicLink_public_policy" ON "EstimatePublicLink"
  FOR ALL TO clearledger_runtime
  USING (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND "tokenHash" = current_setting('app.public_invoice_token_hash', true)
  )
  WITH CHECK (
    current_setting('app.access_mode', true) = 'public_invoice'
    AND "tokenHash" = current_setting('app.public_invoice_token_hash', true)
  );

CREATE POLICY "Estimate_public_policy" ON "Estimate"
  FOR SELECT TO clearledger_runtime
  USING (phase17_public_estimate_access("organizationId", "id"));

CREATE POLICY "Estimate_public_update_policy" ON "Estimate"
  FOR UPDATE TO clearledger_runtime
  USING (phase17_public_estimate_access("organizationId", "id"))
  WITH CHECK (phase17_public_estimate_access("organizationId", "id"));

CREATE POLICY "EstimateLine_public_policy" ON "EstimateLine"
  FOR SELECT TO clearledger_runtime
  USING (phase17_public_estimate_access("organizationId", "estimateId"));
