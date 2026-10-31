DO $$
BEGIN
  IF to_regclass('public."FxRevaluationRun"') IS NOT NULL THEN
    REVOKE SELECT, INSERT, UPDATE ON TABLE "FxRevaluationRun" FROM clearledger_runtime;
  END IF;
END;
$$;
