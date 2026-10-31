-- CreateEnum
CREATE TYPE "PayrollWorkerKind" AS ENUM ('EMPLOYEE', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "PayrollWorkerStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PayrollCompensationKind" AS ENUM ('HOURLY', 'SALARY', 'FIXED');

-- CreateEnum
CREATE TYPE "PayrollFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PayrollCodeKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION');

-- CreateEnum
CREATE TYPE "PayrollRunKind" AS ENUM ('REGULAR', 'OFF_CYCLE', 'CORRECTION', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'CALCULATED', 'REVIEWED', 'APPROVED', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollPaymentBatchStatus" AS ENUM ('DRAFT', 'EXPORTED', 'CONFIRMED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PayrollRemittanceStatus" AS ENUM ('OPEN', 'PAID', 'VOIDED');

-- CreateTable
CREATE TABLE "PayrollSettings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "defaultExpenseAccountId" UUID NOT NULL,
    "defaultLiabilityAccountId" UUID NOT NULL,
    "netPayClearingAccountId" UUID NOT NULL,
    "calculationRulePackId" TEXT NOT NULL,
    "calculationRulePackVersion" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollWorker" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workerNumber" TEXT NOT NULL,
    "kind" "PayrollWorkerKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "governmentIdCiphertext" TEXT,
    "governmentIdKeyVersion" TEXT,
    "governmentIdLastFour" VARCHAR(4),
    "bankAccountCiphertext" TEXT,
    "bankAccountKeyVersion" TEXT,
    "bankAccountLastFour" VARCHAR(4),
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollWorkerProfile" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "status" "PayrollWorkerStatus" NOT NULL DEFAULT 'ACTIVE',
    "jurisdictionCode" TEXT NOT NULL,
    "taxAttributes" JSONB NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollWorkerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCompensation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "kind" "PayrollCompensationKind" NOT NULL,
    "rateMinor" BIGINT NOT NULL,
    "hoursPerPeriodMicros" BIGINT,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSchedule" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "PayrollFrequency" NOT NULL,
    "anchorPayDate" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "payDate" DATE NOT NULL,
    "sequence" INTEGER NOT NULL,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollCode" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PayrollCodeKind" NOT NULL,
    "statutoryAttributes" JSONB NOT NULL,
    "expenseAccountId" UUID,
    "liabilityAccountId" UUID,
    "remittanceAuthority" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPtoBalance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "policyCode" TEXT NOT NULL,
    "balanceMicros" BIGINT NOT NULL,
    "asOfDate" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPtoBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runNumber" TEXT NOT NULL,
    "kind" "PayrollRunKind" NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduleId" UUID,
    "periodId" UUID,
    "correctionOfRunId" UUID,
    "currency" CHAR(3) NOT NULL DEFAULT 'CAD',
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "payDate" DATE NOT NULL,
    "rulePackId" TEXT,
    "rulePackVersion" TEXT,
    "rulePackSourceHash" CHAR(64),
    "calculatedAt" TIMESTAMPTZ(6),
    "reviewedByUserId" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "approvedByUserId" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "postedByUserId" UUID,
    "postedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancellationReason" TEXT,
    "journalId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" UUID NOT NULL,
    "updatedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRunWorker" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "workerSnapshot" JSONB NOT NULL,
    "compensationSnapshot" JSONB NOT NULL,
    "calculationInput" JSONB NOT NULL,
    "calculationExplanation" JSONB,
    "grossPayMinor" BIGINT NOT NULL DEFAULT 0,
    "employeeDeductionsMinor" BIGINT NOT NULL DEFAULT 0,
    "employerContributionsMinor" BIGINT NOT NULL DEFAULT 0,
    "netPayMinor" BIGINT NOT NULL DEFAULT 0,
    "priorRunVarianceFlags" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRunWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRunComponent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runWorkerId" UUID NOT NULL,
    "codeId" UUID NOT NULL,
    "codeSnapshot" JSONB NOT NULL,
    "kind" "PayrollCodeKind" NOT NULL,
    "employeeAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "employerAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "subjectWagesMinor" BIGINT NOT NULL DEFAULT 0,
    "explanation" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollRunComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollYtdBalance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workerId" UUID NOT NULL,
    "runWorkerId" UUID NOT NULL,
    "codeId" UUID NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "employeeAmountMinor" BIGINT NOT NULL,
    "employerAmountMinor" BIGINT NOT NULL,
    "subjectWagesMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollYtdBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayslipSnapshot" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runWorkerId" UUID NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "storageKey" TEXT,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayslipSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRemittance" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "authorityCode" TEXT NOT NULL,
    "liabilityAccountId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "PayrollRemittanceStatus" NOT NULL DEFAULT 'OPEN',
    "paidAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRemittance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPaymentBatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "status" "PayrollPaymentBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentDate" DATE NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "confirmedByUserId" UUID,
    "confirmedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPaymentItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "runWorkerId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "bankAccountMask" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPaymentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPaymentExport" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "contentHash" CHAR(64) NOT NULL,
    "encryptedStorageKey" TEXT NOT NULL,
    "exportedByUserId" UUID NOT NULL,
    "exportedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPaymentExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSettings_organizationId_key" ON "PayrollSettings"("organizationId");

-- CreateIndex
CREATE INDEX "PayrollSettings_organizationId_version_idx" ON "PayrollSettings"("organizationId", "version");

-- CreateIndex
CREATE INDEX "PayrollWorker_organizationId_kind_displayName_idx" ON "PayrollWorker"("organizationId", "kind", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollWorker_organizationId_workerNumber_key" ON "PayrollWorker"("organizationId", "workerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollWorker_organizationId_id_key" ON "PayrollWorker"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollWorkerProfile_organizationId_workerId_effectiveFrom__idx" ON "PayrollWorkerProfile"("organizationId", "workerId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollWorkerProfile_organizationId_workerId_effectiveFrom_key" ON "PayrollWorkerProfile"("organizationId", "workerId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollWorkerProfile_organizationId_id_key" ON "PayrollWorkerProfile"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollCompensation_organizationId_workerId_effectiveFrom_e_idx" ON "PayrollCompensation"("organizationId", "workerId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCompensation_organizationId_workerId_effectiveFrom_key" ON "PayrollCompensation"("organizationId", "workerId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCompensation_organizationId_id_key" ON "PayrollCompensation"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollSchedule_organizationId_active_frequency_idx" ON "PayrollSchedule"("organizationId", "active", "frequency");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSchedule_organizationId_code_key" ON "PayrollSchedule"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSchedule_organizationId_id_key" ON "PayrollSchedule"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollPeriod_organizationId_payDate_idx" ON "PayrollPeriod"("organizationId", "payDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_organizationId_scheduleId_sequence_key" ON "PayrollPeriod"("organizationId", "scheduleId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_organizationId_scheduleId_periodStart_periodE_key" ON "PayrollPeriod"("organizationId", "scheduleId", "periodStart", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_organizationId_id_key" ON "PayrollPeriod"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollCode_organizationId_kind_active_idx" ON "PayrollCode"("organizationId", "kind", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCode_organizationId_code_key" ON "PayrollCode"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollCode_organizationId_id_key" ON "PayrollCode"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollPtoBalance_organizationId_workerId_asOfDate_idx" ON "PayrollPtoBalance"("organizationId", "workerId", "asOfDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPtoBalance_organizationId_workerId_policyCode_key" ON "PayrollPtoBalance"("organizationId", "workerId", "policyCode");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPtoBalance_organizationId_id_key" ON "PayrollPtoBalance"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_journalId_key" ON "PayrollRun"("journalId");

-- CreateIndex
CREATE INDEX "PayrollRun_organizationId_status_payDate_idx" ON "PayrollRun"("organizationId", "status", "payDate");

-- CreateIndex
CREATE INDEX "PayrollRun_organizationId_correctionOfRunId_idx" ON "PayrollRun"("organizationId", "correctionOfRunId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_organizationId_runNumber_key" ON "PayrollRun"("organizationId", "runNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_organizationId_id_key" ON "PayrollRun"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_organizationId_journalId_key" ON "PayrollRun"("organizationId", "journalId");

-- CreateIndex
CREATE INDEX "PayrollRunWorker_organizationId_workerId_createdAt_idx" ON "PayrollRunWorker"("organizationId", "workerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunWorker_organizationId_runId_workerId_key" ON "PayrollRunWorker"("organizationId", "runId", "workerId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunWorker_organizationId_id_key" ON "PayrollRunWorker"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollRunComponent_organizationId_codeId_idx" ON "PayrollRunComponent"("organizationId", "codeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunComponent_organizationId_runWorkerId_codeId_key" ON "PayrollRunComponent"("organizationId", "runWorkerId", "codeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRunComponent_organizationId_id_key" ON "PayrollRunComponent"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollYtdBalance_organizationId_workerId_taxYear_codeId_idx" ON "PayrollYtdBalance"("organizationId", "workerId", "taxYear", "codeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollYtdBalance_organizationId_runWorkerId_codeId_key" ON "PayrollYtdBalance"("organizationId", "runWorkerId", "codeId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollYtdBalance_organizationId_id_key" ON "PayrollYtdBalance"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayslipSnapshot_runWorkerId_key" ON "PayrollPayslipSnapshot"("runWorkerId");

-- CreateIndex
CREATE INDEX "PayrollPayslipSnapshot_organizationId_createdAt_idx" ON "PayrollPayslipSnapshot"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayslipSnapshot_organizationId_id_key" ON "PayrollPayslipSnapshot"("organizationId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPayslipSnapshot_organizationId_runWorkerId_key" ON "PayrollPayslipSnapshot"("organizationId", "runWorkerId");

-- CreateIndex
CREATE INDEX "PayrollRemittance_organizationId_status_dueDate_idx" ON "PayrollRemittance"("organizationId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRemittance_organizationId_runId_authorityCode_liabil_key" ON "PayrollRemittance"("organizationId", "runId", "authorityCode", "liabilityAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRemittance_organizationId_id_key" ON "PayrollRemittance"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollPaymentBatch_organizationId_runId_status_idx" ON "PayrollPaymentBatch"("organizationId", "runId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPaymentBatch_organizationId_batchNumber_key" ON "PayrollPaymentBatch"("organizationId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPaymentBatch_organizationId_id_key" ON "PayrollPaymentBatch"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollPaymentItem_organizationId_runWorkerId_idx" ON "PayrollPaymentItem"("organizationId", "runWorkerId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPaymentItem_organizationId_batchId_runWorkerId_key" ON "PayrollPaymentItem"("organizationId", "batchId", "runWorkerId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPaymentItem_organizationId_id_key" ON "PayrollPaymentItem"("organizationId", "id");

-- CreateIndex
CREATE INDEX "PayrollPaymentExport_organizationId_exportedAt_idx" ON "PayrollPaymentExport"("organizationId", "exportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPaymentExport_organizationId_batchId_sequence_key" ON "PayrollPaymentExport"("organizationId", "batchId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPaymentExport_organizationId_id_key" ON "PayrollPaymentExport"("organizationId", "id");

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_organizationId_defaultExpenseAccountId_fkey" FOREIGN KEY ("organizationId", "defaultExpenseAccountId") REFERENCES "Account"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_organizationId_defaultLiabilityAccountId_fkey" FOREIGN KEY ("organizationId", "defaultLiabilityAccountId") REFERENCES "Account"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_organizationId_netPayClearingAccountId_fkey" FOREIGN KEY ("organizationId", "netPayClearingAccountId") REFERENCES "Account"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollWorker" ADD CONSTRAINT "PayrollWorker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollWorkerProfile" ADD CONSTRAINT "PayrollWorkerProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollWorkerProfile" ADD CONSTRAINT "PayrollWorkerProfile_organizationId_workerId_fkey" FOREIGN KEY ("organizationId", "workerId") REFERENCES "PayrollWorker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompensation" ADD CONSTRAINT "PayrollCompensation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCompensation" ADD CONSTRAINT "PayrollCompensation_organizationId_workerId_fkey" FOREIGN KEY ("organizationId", "workerId") REFERENCES "PayrollWorker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollSchedule" ADD CONSTRAINT "PayrollSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_organizationId_scheduleId_fkey" FOREIGN KEY ("organizationId", "scheduleId") REFERENCES "PayrollSchedule"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCode" ADD CONSTRAINT "PayrollCode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCode" ADD CONSTRAINT "PayrollCode_organizationId_expenseAccountId_fkey" FOREIGN KEY ("organizationId", "expenseAccountId") REFERENCES "Account"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollCode" ADD CONSTRAINT "PayrollCode_organizationId_liabilityAccountId_fkey" FOREIGN KEY ("organizationId", "liabilityAccountId") REFERENCES "Account"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPtoBalance" ADD CONSTRAINT "PayrollPtoBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPtoBalance" ADD CONSTRAINT "PayrollPtoBalance_organizationId_workerId_fkey" FOREIGN KEY ("organizationId", "workerId") REFERENCES "PayrollWorker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_scheduleId_fkey" FOREIGN KEY ("organizationId", "scheduleId") REFERENCES "PayrollSchedule"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_periodId_fkey" FOREIGN KEY ("organizationId", "periodId") REFERENCES "PayrollPeriod"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_correctionOfRunId_fkey" FOREIGN KEY ("organizationId", "correctionOfRunId") REFERENCES "PayrollRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_organizationId_journalId_fkey" FOREIGN KEY ("organizationId", "journalId") REFERENCES "Journal"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunWorker" ADD CONSTRAINT "PayrollRunWorker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunWorker" ADD CONSTRAINT "PayrollRunWorker_organizationId_runId_fkey" FOREIGN KEY ("organizationId", "runId") REFERENCES "PayrollRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunWorker" ADD CONSTRAINT "PayrollRunWorker_organizationId_workerId_fkey" FOREIGN KEY ("organizationId", "workerId") REFERENCES "PayrollWorker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunComponent" ADD CONSTRAINT "PayrollRunComponent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunComponent" ADD CONSTRAINT "PayrollRunComponent_organizationId_runWorkerId_fkey" FOREIGN KEY ("organizationId", "runWorkerId") REFERENCES "PayrollRunWorker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRunComponent" ADD CONSTRAINT "PayrollRunComponent_organizationId_codeId_fkey" FOREIGN KEY ("organizationId", "codeId") REFERENCES "PayrollCode"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollYtdBalance" ADD CONSTRAINT "PayrollYtdBalance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollYtdBalance" ADD CONSTRAINT "PayrollYtdBalance_organizationId_workerId_fkey" FOREIGN KEY ("organizationId", "workerId") REFERENCES "PayrollWorker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollYtdBalance" ADD CONSTRAINT "PayrollYtdBalance_organizationId_runWorkerId_fkey" FOREIGN KEY ("organizationId", "runWorkerId") REFERENCES "PayrollRunWorker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollYtdBalance" ADD CONSTRAINT "PayrollYtdBalance_organizationId_codeId_fkey" FOREIGN KEY ("organizationId", "codeId") REFERENCES "PayrollCode"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayslipSnapshot" ADD CONSTRAINT "PayrollPayslipSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayslipSnapshot" ADD CONSTRAINT "PayrollPayslipSnapshot_organizationId_runWorkerId_fkey" FOREIGN KEY ("organizationId", "runWorkerId") REFERENCES "PayrollRunWorker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRemittance" ADD CONSTRAINT "PayrollRemittance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRemittance" ADD CONSTRAINT "PayrollRemittance_organizationId_runId_fkey" FOREIGN KEY ("organizationId", "runId") REFERENCES "PayrollRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRemittance" ADD CONSTRAINT "PayrollRemittance_organizationId_liabilityAccountId_fkey" FOREIGN KEY ("organizationId", "liabilityAccountId") REFERENCES "Account"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentBatch" ADD CONSTRAINT "PayrollPaymentBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentBatch" ADD CONSTRAINT "PayrollPaymentBatch_organizationId_runId_fkey" FOREIGN KEY ("organizationId", "runId") REFERENCES "PayrollRun"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentItem" ADD CONSTRAINT "PayrollPaymentItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentItem" ADD CONSTRAINT "PayrollPaymentItem_organizationId_batchId_fkey" FOREIGN KEY ("organizationId", "batchId") REFERENCES "PayrollPaymentBatch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentItem" ADD CONSTRAINT "PayrollPaymentItem_organizationId_runWorkerId_fkey" FOREIGN KEY ("organizationId", "runWorkerId") REFERENCES "PayrollRunWorker"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentExport" ADD CONSTRAINT "PayrollPaymentExport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPaymentExport" ADD CONSTRAINT "PayrollPaymentExport_organizationId_batchId_fkey" FOREIGN KEY ("organizationId", "batchId") REFERENCES "PayrollPaymentBatch"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayrollSettings"
  ADD CONSTRAINT "PayrollSettings_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "PayrollSettings_rule_pack_check" CHECK (btrim("calculationRulePackId") <> '' AND btrim("calculationRulePackVersion") <> '');
ALTER TABLE "PayrollWorker"
  ADD CONSTRAINT "PayrollWorker_number_check" CHECK (btrim("workerNumber") <> ''),
  ADD CONSTRAINT "PayrollWorker_name_check" CHECK (btrim("displayName") <> ''),
  ADD CONSTRAINT "PayrollWorker_government_envelope_check" CHECK (("governmentIdCiphertext" IS NULL) = ("governmentIdKeyVersion" IS NULL)),
  ADD CONSTRAINT "PayrollWorker_bank_envelope_check" CHECK (("bankAccountCiphertext" IS NULL) = ("bankAccountKeyVersion" IS NULL)),
  ADD CONSTRAINT "PayrollWorker_government_mask_check" CHECK ("governmentIdLastFour" IS NULL OR "governmentIdLastFour" ~ '^[0-9]{4}$'),
  ADD CONSTRAINT "PayrollWorker_bank_mask_check" CHECK ("bankAccountLastFour" IS NULL OR "bankAccountLastFour" ~ '^[0-9]{4}$');
ALTER TABLE "PayrollWorkerProfile"
  ADD CONSTRAINT "PayrollWorkerProfile_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "PayrollWorkerProfile_tax_attributes_check" CHECK (jsonb_typeof("taxAttributes") = 'object');
ALTER TABLE "PayrollCompensation"
  ADD CONSTRAINT "PayrollCompensation_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "PayrollCompensation_rate_check" CHECK ("rateMinor" >= 0),
  ADD CONSTRAINT "PayrollCompensation_hours_check" CHECK ("hoursPerPeriodMicros" IS NULL OR "hoursPerPeriodMicros" >= 0);
ALTER TABLE "PayrollSchedule" ADD CONSTRAINT "PayrollSchedule_version_check" CHECK ("version" > 0);
ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_dates_check" CHECK ("periodEnd" >= "periodStart" AND "payDate" >= "periodEnd" AND "sequence" > 0);
ALTER TABLE "PayrollCode"
  ADD CONSTRAINT "PayrollCode_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "PayrollCode_attributes_check" CHECK (jsonb_typeof("statutoryAttributes") = 'object'),
  ADD CONSTRAINT "PayrollCode_accounts_check" CHECK (
    ("kind" = 'EARNING' AND "expenseAccountId" IS NOT NULL)
    OR ("kind" = 'DEDUCTION' AND "liabilityAccountId" IS NOT NULL)
    OR ("kind" = 'EMPLOYER_CONTRIBUTION' AND "expenseAccountId" IS NOT NULL AND "liabilityAccountId" IS NOT NULL)
  );
ALTER TABLE "PayrollPtoBalance"
  ADD CONSTRAINT "PayrollPtoBalance_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "PayrollPtoBalance_policy_check" CHECK (btrim("policyCode") <> '');
ALTER TABLE "PayrollRun"
  ADD CONSTRAINT "PayrollRun_dates_check" CHECK ("periodEnd" >= "periodStart" AND "payDate" >= "periodEnd"),
  ADD CONSTRAINT "PayrollRun_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "PayrollRun_rule_pack_check" CHECK (
    ("rulePackId" IS NULL AND "rulePackVersion" IS NULL AND "rulePackSourceHash" IS NULL AND "calculatedAt" IS NULL)
    OR ("rulePackId" IS NOT NULL AND "rulePackVersion" IS NOT NULL AND "rulePackSourceHash" IS NOT NULL AND "calculatedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "PayrollRun_linked_correction_check" CHECK (("kind" IN ('CORRECTION', 'REVERSAL')) = ("correctionOfRunId" IS NOT NULL)),
  ADD CONSTRAINT "PayrollRun_review_check" CHECK (("reviewedAt" IS NULL) = ("reviewedByUserId" IS NULL)),
  ADD CONSTRAINT "PayrollRun_approval_check" CHECK (("approvedAt" IS NULL) = ("approvedByUserId" IS NULL)),
  ADD CONSTRAINT "PayrollRun_posting_check" CHECK (("postedAt" IS NULL AND "postedByUserId" IS NULL AND "journalId" IS NULL) OR ("postedAt" IS NOT NULL AND "postedByUserId" IS NOT NULL AND "journalId" IS NOT NULL)),
  ADD CONSTRAINT "PayrollRun_status_evidence_check" CHECK (
    ("status" = 'DRAFT' AND "calculatedAt" IS NULL)
    OR ("status" = 'CALCULATED' AND "calculatedAt" IS NOT NULL AND "reviewedAt" IS NULL)
    OR ("status" = 'REVIEWED' AND "reviewedAt" IS NOT NULL AND "approvedAt" IS NULL)
    OR ("status" = 'APPROVED' AND "approvedAt" IS NOT NULL AND "postedAt" IS NULL)
    OR ("status" = 'POSTED' AND "postedAt" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND btrim(coalesce("cancellationReason", '')) <> '')
  );
ALTER TABLE "PayrollRunWorker"
  ADD CONSTRAINT "PayrollRunWorker_totals_check" CHECK ("grossPayMinor" - "employeeDeductionsMinor" = "netPayMinor"),
  ADD CONSTRAINT "PayrollRunWorker_worker_snapshot_check" CHECK (jsonb_typeof("workerSnapshot") = 'object'),
  ADD CONSTRAINT "PayrollRunWorker_compensation_snapshot_check" CHECK (jsonb_typeof("compensationSnapshot") = 'object'),
  ADD CONSTRAINT "PayrollRunWorker_input_check" CHECK (jsonb_typeof("calculationInput") = 'object');
ALTER TABLE "PayrollRunComponent"
  ADD CONSTRAINT "PayrollRunComponent_code_snapshot_check" CHECK (jsonb_typeof("codeSnapshot") = 'object'),
  ADD CONSTRAINT "PayrollRunComponent_explanation_check" CHECK (jsonb_typeof("explanation") = 'object');
ALTER TABLE "PayrollYtdBalance" ADD CONSTRAINT "PayrollYtdBalance_year_check" CHECK ("taxYear" BETWEEN 1900 AND 9999);
ALTER TABLE "PayrollPayslipSnapshot" ADD CONSTRAINT "PayrollPayslipSnapshot_metadata_check" CHECK (jsonb_typeof("metadata") = 'object');
ALTER TABLE "PayrollRemittance" ADD CONSTRAINT "PayrollRemittance_amount_check" CHECK ("amountMinor" <> 0);
ALTER TABLE "PayrollPaymentBatch" ADD CONSTRAINT "PayrollPaymentBatch_total_check" CHECK ("totalMinor" >= 0);
ALTER TABLE "PayrollPaymentItem" ADD CONSTRAINT "PayrollPaymentItem_amount_check" CHECK ("amountMinor" >= 0);

CREATE OR REPLACE FUNCTION validate_payroll_domain_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE parent_status "PayrollRunStatus";
DECLARE original_status "PayrollRunStatus";
DECLARE period_schedule UUID;
BEGIN
  IF TG_TABLE_NAME IN ('PayrollWorkerProfile', 'PayrollCompensation') THEN
    IF TG_TABLE_NAME = 'PayrollWorkerProfile' AND EXISTS (
      SELECT 1 FROM "PayrollWorkerProfile" p
      WHERE p."organizationId" = NEW."organizationId" AND p."workerId" = NEW."workerId"
        AND p."id" <> NEW."id"
        AND daterange(p."effectiveFrom", p."effectiveTo", '[]') && daterange(NEW."effectiveFrom", NEW."effectiveTo", '[]')
    ) THEN RAISE EXCEPTION 'Payroll worker profile effective dates overlap'; END IF;
    IF TG_TABLE_NAME = 'PayrollCompensation' AND EXISTS (
      SELECT 1 FROM "PayrollCompensation" c
      WHERE c."organizationId" = NEW."organizationId" AND c."workerId" = NEW."workerId"
        AND c."id" <> NEW."id"
        AND daterange(c."effectiveFrom", c."effectiveTo", '[]') && daterange(NEW."effectiveFrom", NEW."effectiveTo", '[]')
    ) THEN RAISE EXCEPTION 'Payroll compensation effective dates overlap'; END IF;
  ELSIF TG_TABLE_NAME = 'PayrollRun' THEN
    IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."status" = 'POSTED' THEN
      RAISE EXCEPTION 'Posted payroll runs are immutable';
    END IF;
    IF TG_OP <> 'DELETE' AND NEW."periodId" IS NOT NULL THEN
      SELECT "scheduleId" INTO period_schedule FROM "PayrollPeriod"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."periodId";
      IF NEW."scheduleId" IS NULL OR period_schedule IS DISTINCT FROM NEW."scheduleId" THEN
        RAISE EXCEPTION 'Payroll run period must belong to its schedule';
      END IF;
    END IF;
    IF TG_OP <> 'DELETE' AND NEW."correctionOfRunId" IS NOT NULL THEN
      SELECT "status" INTO original_status FROM "PayrollRun"
      WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."correctionOfRunId";
      IF original_status IS DISTINCT FROM 'POSTED' THEN
        RAISE EXCEPTION 'Payroll correction or reversal requires a posted original run';
      END IF;
    END IF;
  ELSE
    IF TG_TABLE_NAME IN ('PayrollRunWorker', 'PayrollRunComponent', 'PayrollYtdBalance', 'PayrollPayslipSnapshot') THEN
      IF TG_TABLE_NAME = 'PayrollRunWorker' THEN
        SELECT "status" INTO parent_status FROM "PayrollRun" WHERE "organizationId" = COALESCE(NEW."organizationId", OLD."organizationId") AND "id" = COALESCE(NEW."runId", OLD."runId");
      ELSE
        SELECT r."status" INTO parent_status
        FROM "PayrollRun" r JOIN "PayrollRunWorker" rw ON rw."organizationId" = r."organizationId" AND rw."runId" = r."id"
        WHERE rw."organizationId" = COALESCE(NEW."organizationId", OLD."organizationId") AND rw."id" = COALESCE(NEW."runWorkerId", OLD."runWorkerId");
      END IF;
      IF parent_status = 'POSTED' THEN RAISE EXCEPTION 'Posted payroll calculation records are immutable'; END IF;
    ELSIF TG_TABLE_NAME IN ('PayrollPaymentBatch', 'PayrollRemittance') AND TG_OP = 'INSERT' THEN
      SELECT "status" INTO parent_status FROM "PayrollRun" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."runId";
      IF parent_status IS DISTINCT FROM 'POSTED' THEN RAISE EXCEPTION 'Payroll payment and remittance records require a posted run'; END IF;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "PayrollWorkerProfile_validate" BEFORE INSERT OR UPDATE ON "PayrollWorkerProfile" FOR EACH ROW EXECUTE FUNCTION validate_payroll_domain_write();
CREATE TRIGGER "PayrollCompensation_validate" BEFORE INSERT OR UPDATE ON "PayrollCompensation" FOR EACH ROW EXECUTE FUNCTION validate_payroll_domain_write();
CREATE TRIGGER "PayrollRun_validate" BEFORE INSERT OR UPDATE OR DELETE ON "PayrollRun" FOR EACH ROW EXECUTE FUNCTION validate_payroll_domain_write();
CREATE TRIGGER "PayrollRunWorker_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "PayrollRunWorker" FOR EACH ROW EXECUTE FUNCTION validate_payroll_domain_write();
CREATE TRIGGER "PayrollRunComponent_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "PayrollRunComponent" FOR EACH ROW EXECUTE FUNCTION validate_payroll_domain_write();
CREATE TRIGGER "PayrollYtdBalance_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "PayrollYtdBalance" FOR EACH ROW EXECUTE FUNCTION validate_payroll_domain_write();
CREATE TRIGGER "PayrollPayslipSnapshot_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "PayrollPayslipSnapshot" FOR EACH ROW EXECUTE FUNCTION validate_payroll_domain_write();
CREATE TRIGGER "PayrollPaymentBatch_validate" BEFORE INSERT ON "PayrollPaymentBatch" FOR EACH ROW EXECUTE FUNCTION validate_payroll_domain_write();
CREATE TRIGGER "PayrollRemittance_validate" BEFORE INSERT ON "PayrollRemittance" FOR EACH ROW EXECUTE FUNCTION validate_payroll_domain_write();

CREATE OR REPLACE FUNCTION validate_payroll_account_mapping()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'PayrollSettings' THEN
    IF NOT EXISTS (SELECT 1 FROM "Account" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."defaultExpenseAccountId" AND "type" = 'EXPENSE' AND NOT "isArchived") THEN RAISE EXCEPTION 'Payroll default expense account must be an active tenant expense account'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "Account" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."defaultLiabilityAccountId" AND "type" = 'LIABILITY' AND NOT "isArchived") THEN RAISE EXCEPTION 'Payroll default liability account must be an active tenant liability account'; END IF;
    IF NOT EXISTS (SELECT 1 FROM "Account" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."netPayClearingAccountId" AND "type" = 'LIABILITY' AND NOT "isArchived") THEN RAISE EXCEPTION 'Payroll net pay clearing account must be an active tenant liability account'; END IF;
  ELSE
    IF NEW."expenseAccountId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Account" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."expenseAccountId" AND "type" = 'EXPENSE' AND NOT "isArchived") THEN RAISE EXCEPTION 'Payroll code expense account must be an active tenant expense account'; END IF;
    IF NEW."liabilityAccountId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Account" WHERE "organizationId" = NEW."organizationId" AND "id" = NEW."liabilityAccountId" AND "type" = 'LIABILITY' AND NOT "isArchived") THEN RAISE EXCEPTION 'Payroll code liability account must be an active tenant liability account'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PayrollSettings_account_mapping" BEFORE INSERT OR UPDATE ON "PayrollSettings" FOR EACH ROW EXECUTE FUNCTION validate_payroll_account_mapping();
CREATE TRIGGER "PayrollCode_account_mapping" BEFORE INSERT OR UPDATE ON "PayrollCode" FOR EACH ROW EXECUTE FUNCTION validate_payroll_account_mapping();

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "PayrollSettings", "PayrollWorker", "PayrollWorkerProfile", "PayrollCompensation",
  "PayrollSchedule", "PayrollPeriod", "PayrollCode", "PayrollPtoBalance", "PayrollRun",
  "PayrollRunWorker", "PayrollRunComponent", "PayrollYtdBalance", "PayrollPayslipSnapshot",
  "PayrollRemittance", "PayrollPaymentBatch", "PayrollPaymentItem", "PayrollPaymentExport"
TO clearledger_runtime;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'PayrollSettings', 'PayrollWorker', 'PayrollWorkerProfile', 'PayrollCompensation',
    'PayrollSchedule', 'PayrollPeriod', 'PayrollCode', 'PayrollPtoBalance', 'PayrollRun',
    'PayrollRunWorker', 'PayrollRunComponent', 'PayrollYtdBalance', 'PayrollPayslipSnapshot',
    'PayrollRemittance', 'PayrollPaymentBatch', 'PayrollPaymentItem', 'PayrollPaymentExport'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO clearledger_runtime USING ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access()) WITH CHECK ("organizationId" = app_current_organization_id() AND app_actor_has_tenant_access())',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;
