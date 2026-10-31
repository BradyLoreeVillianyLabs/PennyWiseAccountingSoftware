DO $rollback$
BEGIN
  IF to_regprocedure('public.phase12_revoke_organization_sessions(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION phase12_revoke_organization_sessions(UUID) FROM clearledger_runtime;
    DROP FUNCTION phase12_revoke_organization_sessions(UUID);
  END IF;
END;
$rollback$;
