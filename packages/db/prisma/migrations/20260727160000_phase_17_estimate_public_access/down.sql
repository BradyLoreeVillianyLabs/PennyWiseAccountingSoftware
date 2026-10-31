DROP POLICY IF EXISTS "EstimateLine_public_policy" ON "EstimateLine";
DROP POLICY IF EXISTS "Estimate_public_update_policy" ON "Estimate";
DROP POLICY IF EXISTS "Estimate_public_policy" ON "Estimate";
DROP POLICY IF EXISTS "EstimatePublicLink_public_policy" ON "EstimatePublicLink";
DROP FUNCTION IF EXISTS phase17_public_estimate_access(UUID, UUID);
