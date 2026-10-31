CREATE OR REPLACE FUNCTION phase12_revoke_organization_sessions(p_organization_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  revoked_count INTEGER;
BEGIN
  IF p_organization_id IS DISTINCT FROM public.app_current_organization_id()
    OR public.app_current_actor_user_id() IS NULL
    OR current_setting('app.access_mode', true) <> 'membership'
    OR NOT EXISTS (
      SELECT 1
        FROM public."Membership"
       WHERE "organizationId" = p_organization_id
         AND "userId" = public.app_current_actor_user_id()
         AND role = 'OWNER'
         AND status = 'ACTIVE'
    )
    OR NOT EXISTS (
      SELECT 1
        FROM public."OrganizationClosureRequest"
       WHERE "organizationId" = p_organization_id
         AND status = 'RETENTION_SCHEDULED'
    )
  THEN
    RAISE EXCEPTION 'Organization session revocation is not authorized';
  END IF;

  UPDATE public."Session"
     SET "revokedAt" = CURRENT_TIMESTAMP,
         "revocationReason" = 'ORGANIZATION_CLOSURE'
   WHERE "activeOrganizationId" = p_organization_id
     AND "revokedAt" IS NULL;
  GET DIAGNOSTICS revoked_count = ROW_COUNT;
  RETURN revoked_count;
END;
$$;

REVOKE ALL ON FUNCTION phase12_revoke_organization_sessions(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION phase12_revoke_organization_sessions(UUID) TO clearledger_runtime;
