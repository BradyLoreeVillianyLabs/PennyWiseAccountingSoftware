-- Roll back only objects introduced by the payroll domain foundation.
-- Relation guards keep this safe to rerun after a complete or partial rollback.

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'PayrollSettings', 'PayrollWorker', 'PayrollWorkerProfile', 'PayrollCompensation',
    'PayrollSchedule', 'PayrollPeriod', 'PayrollCode', 'PayrollPtoBalance', 'PayrollRun',
    'PayrollRunWorker', 'PayrollRunComponent', 'PayrollYtdBalance', 'PayrollPayslipSnapshot',
    'PayrollRemittance', 'PayrollPaymentBatch', 'PayrollPaymentItem', 'PayrollPaymentExport'
  ] LOOP
    IF to_regclass(format('%I', table_name)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', table_name || '_tenant_policy', table_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %I FROM clearledger_runtime', table_name);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  table_names TEXT[] := ARRAY[
    'PayrollWorkerProfile', 'PayrollCompensation', 'PayrollRun', 'PayrollRunWorker',
    'PayrollRunComponent', 'PayrollYtdBalance', 'PayrollPayslipSnapshot',
    'PayrollPaymentBatch', 'PayrollRemittance', 'PayrollSettings', 'PayrollCode'
  ];
  trigger_names TEXT[] := ARRAY[
    'PayrollWorkerProfile_validate', 'PayrollCompensation_validate', 'PayrollRun_validate',
    'PayrollRunWorker_immutable', 'PayrollRunComponent_immutable',
    'PayrollYtdBalance_immutable', 'PayrollPayslipSnapshot_immutable',
    'PayrollPaymentBatch_validate', 'PayrollRemittance_validate',
    'PayrollSettings_account_mapping', 'PayrollCode_account_mapping'
  ];
  item_index INTEGER;
BEGIN
  FOR item_index IN 1..array_length(table_names, 1) LOOP
    IF to_regclass(format('%I', table_names[item_index])) IS NOT NULL THEN
      EXECUTE format(
        'DROP TRIGGER IF EXISTS %I ON %I',
        trigger_names[item_index],
        table_names[item_index]
      );
    END IF;
  END LOOP;
END $$;

-- Children are removed before their referenced parents; CASCADE is deliberately avoided.
DROP TABLE IF EXISTS "PayrollPaymentExport";
DROP TABLE IF EXISTS "PayrollPaymentItem";
DROP TABLE IF EXISTS "PayrollPayslipSnapshot";
DROP TABLE IF EXISTS "PayrollYtdBalance";
DROP TABLE IF EXISTS "PayrollRunComponent";
DROP TABLE IF EXISTS "PayrollRemittance";
DROP TABLE IF EXISTS "PayrollPaymentBatch";
DROP TABLE IF EXISTS "PayrollRunWorker";
DROP TABLE IF EXISTS "PayrollRun";
DROP TABLE IF EXISTS "PayrollPtoBalance";
DROP TABLE IF EXISTS "PayrollWorkerProfile";
DROP TABLE IF EXISTS "PayrollCompensation";
DROP TABLE IF EXISTS "PayrollPeriod";
DROP TABLE IF EXISTS "PayrollSchedule";
DROP TABLE IF EXISTS "PayrollCode";
DROP TABLE IF EXISTS "PayrollSettings";
DROP TABLE IF EXISTS "PayrollWorker";

DROP FUNCTION IF EXISTS validate_payroll_account_mapping();
DROP FUNCTION IF EXISTS validate_payroll_domain_write();

-- Each index is table-owned and is removed with its table. These idempotent drops
-- also cover a partially applied migration whose relation cleanup was completed.
DROP INDEX IF EXISTS "PayrollSettings_organizationId_key";
DROP INDEX IF EXISTS "PayrollSettings_organizationId_version_idx";
DROP INDEX IF EXISTS "PayrollWorker_organizationId_kind_displayName_idx";
DROP INDEX IF EXISTS "PayrollWorker_organizationId_workerNumber_key";
DROP INDEX IF EXISTS "PayrollWorker_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollWorkerProfile_organizationId_workerId_effectiveFrom__idx";
DROP INDEX IF EXISTS "PayrollWorkerProfile_organizationId_workerId_effectiveFrom_key";
DROP INDEX IF EXISTS "PayrollWorkerProfile_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollCompensation_organizationId_workerId_effectiveFrom_e_idx";
DROP INDEX IF EXISTS "PayrollCompensation_organizationId_workerId_effectiveFrom_key";
DROP INDEX IF EXISTS "PayrollCompensation_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollSchedule_organizationId_active_frequency_idx";
DROP INDEX IF EXISTS "PayrollSchedule_organizationId_code_key";
DROP INDEX IF EXISTS "PayrollSchedule_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollPeriod_organizationId_payDate_idx";
DROP INDEX IF EXISTS "PayrollPeriod_organizationId_scheduleId_sequence_key";
DROP INDEX IF EXISTS "PayrollPeriod_organizationId_scheduleId_periodStart_periodE_key";
DROP INDEX IF EXISTS "PayrollPeriod_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollCode_organizationId_kind_active_idx";
DROP INDEX IF EXISTS "PayrollCode_organizationId_code_key";
DROP INDEX IF EXISTS "PayrollCode_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollPtoBalance_organizationId_workerId_asOfDate_idx";
DROP INDEX IF EXISTS "PayrollPtoBalance_organizationId_workerId_policyCode_key";
DROP INDEX IF EXISTS "PayrollPtoBalance_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollRun_journalId_key";
DROP INDEX IF EXISTS "PayrollRun_organizationId_status_payDate_idx";
DROP INDEX IF EXISTS "PayrollRun_organizationId_correctionOfRunId_idx";
DROP INDEX IF EXISTS "PayrollRun_organizationId_runNumber_key";
DROP INDEX IF EXISTS "PayrollRun_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollRun_organizationId_journalId_key";
DROP INDEX IF EXISTS "PayrollRunWorker_organizationId_workerId_createdAt_idx";
DROP INDEX IF EXISTS "PayrollRunWorker_organizationId_runId_workerId_key";
DROP INDEX IF EXISTS "PayrollRunWorker_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollRunComponent_organizationId_codeId_idx";
DROP INDEX IF EXISTS "PayrollRunComponent_organizationId_runWorkerId_codeId_key";
DROP INDEX IF EXISTS "PayrollRunComponent_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollYtdBalance_organizationId_workerId_taxYear_codeId_idx";
DROP INDEX IF EXISTS "PayrollYtdBalance_organizationId_runWorkerId_codeId_key";
DROP INDEX IF EXISTS "PayrollYtdBalance_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollPayslipSnapshot_runWorkerId_key";
DROP INDEX IF EXISTS "PayrollPayslipSnapshot_organizationId_createdAt_idx";
DROP INDEX IF EXISTS "PayrollPayslipSnapshot_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollPayslipSnapshot_organizationId_runWorkerId_key";
DROP INDEX IF EXISTS "PayrollRemittance_organizationId_status_dueDate_idx";
DROP INDEX IF EXISTS "PayrollRemittance_organizationId_runId_authorityCode_liabil_key";
DROP INDEX IF EXISTS "PayrollRemittance_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollPaymentBatch_organizationId_runId_status_idx";
DROP INDEX IF EXISTS "PayrollPaymentBatch_organizationId_batchNumber_key";
DROP INDEX IF EXISTS "PayrollPaymentBatch_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollPaymentItem_organizationId_runWorkerId_idx";
DROP INDEX IF EXISTS "PayrollPaymentItem_organizationId_batchId_runWorkerId_key";
DROP INDEX IF EXISTS "PayrollPaymentItem_organizationId_id_key";
DROP INDEX IF EXISTS "PayrollPaymentExport_organizationId_exportedAt_idx";
DROP INDEX IF EXISTS "PayrollPaymentExport_organizationId_batchId_sequence_key";
DROP INDEX IF EXISTS "PayrollPaymentExport_organizationId_id_key";

DROP TYPE IF EXISTS "PayrollRemittanceStatus";
DROP TYPE IF EXISTS "PayrollPaymentBatchStatus";
DROP TYPE IF EXISTS "PayrollRunStatus";
DROP TYPE IF EXISTS "PayrollRunKind";
DROP TYPE IF EXISTS "PayrollCodeKind";
DROP TYPE IF EXISTS "PayrollFrequency";
DROP TYPE IF EXISTS "PayrollCompensationKind";
DROP TYPE IF EXISTS "PayrollWorkerStatus";
DROP TYPE IF EXISTS "PayrollWorkerKind";
