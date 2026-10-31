import { createHash } from "node:crypto";
import {
  Prisma,
  RuntimePrisma,
  withTenantTransaction,
  type PayrollCodeKind,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { runIdempotent } from "./idempotency-service.js";
import { JournalService } from "./journal-service.js";
import {
  PayrollStatutoryCalculator,
  PayrollStatutoryDiagnosticError,
  type PayrollStatutoryCalculationInput
} from "./payroll-statutory-service.js";
import { payrollProviderGates } from "./payroll-provider-gates.js";

type Tx = Prisma.TransactionClient;
type StatutoryOverrides = Omit<
  PayrollStatutoryCalculationInput,
  "jurisdiction" | "payDate" | "payFrequency" | "grossPayMinor" | "ytd"
>;
type StatutoryClaimCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
type StatutoryUsFilingStatus =
  | "SINGLE_OR_MARRIED_FILING_SEPARATELY"
  | "MARRIED_FILING_JOINTLY"
  | "HEAD_OF_HOUSEHOLD";

export interface EncryptedIdentifierEnvelopeInput {
  readonly ciphertext: string;
  readonly keyVersion: string;
  readonly lastFour: string;
}

export interface PayrollSettingsInput {
  readonly defaultExpenseAccountId: string;
  readonly defaultLiabilityAccountId: string;
  readonly netPayClearingAccountId: string;
  readonly calculationRulePackId: string;
  readonly calculationRulePackVersion: string;
}

export interface PayrollWorkerInput {
  readonly workerNumber: string;
  readonly kind: "EMPLOYEE" | "CONTRACTOR";
  readonly displayName: string;
  readonly governmentId?: EncryptedIdentifierEnvelopeInput | null | undefined;
  readonly bankAccount?: EncryptedIdentifierEnvelopeInput | null | undefined;
  readonly profile: {
    readonly effectiveFrom: string;
    readonly effectiveTo?: string | null | undefined;
    readonly status?: "ACTIVE" | "ON_LEAVE" | "TERMINATED" | undefined;
    readonly jurisdictionCode: string;
    readonly taxAttributes: Prisma.InputJsonObject;
  };
  readonly compensation: {
    readonly effectiveFrom: string;
    readonly effectiveTo?: string | null | undefined;
    readonly kind: "HOURLY" | "SALARY" | "FIXED";
    readonly rateMinor: string;
    readonly hoursPerPeriodMicros?: string | null | undefined;
  };
}

export interface PayrollCodeInput {
  readonly code: string;
  readonly name: string;
  readonly kind: "EARNING" | "DEDUCTION" | "EMPLOYER_CONTRIBUTION";
  readonly statutoryAttributes: Prisma.InputJsonObject;
  readonly expenseAccountId?: string | null | undefined;
  readonly liabilityAccountId?: string | null | undefined;
  readonly remittanceAuthority?: string | null | undefined;
}

export interface PayrollScheduleInput {
  readonly code: string;
  readonly name: string;
  readonly frequency: "WEEKLY" | "BIWEEKLY" | "SEMIMONTHLY" | "MONTHLY";
  readonly anchorPayDate: string;
  /**
   * Creates reviewable drafts from explicitly maintained payroll periods. It
   * never calculates, approves, posts, pays, or files a payroll run.
   */
  readonly automaticDraftsEnabled?: boolean | undefined;
  /** Number of days before an explicit pay date that a draft may be prepared. */
  readonly draftLeadDays?: number | undefined;
}

export interface PayrollPeriodInput {
  readonly scheduleId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly payDate: string;
  readonly sequence: number;
}

export interface PayrollScheduleAutomationInput {
  readonly version: number;
  readonly automaticDraftsEnabled: boolean;
  readonly draftLeadDays: number;
}

export interface ScheduledPayrollDraftInput {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly payDate: string;
  /** Optional when a new period can safely receive the next sequence number. */
  readonly sequence?: number | undefined;
}

export interface PayrollRunInput {
  readonly runNumber: string;
  readonly kind: "REGULAR" | "OFF_CYCLE" | "CORRECTION";
  readonly scheduleId?: string | null | undefined;
  readonly periodId?: string | null | undefined;
  readonly correctionOfRunId?: string | null | undefined;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly payDate: string;
  readonly workers: readonly {
    readonly workerId: string;
    readonly grossPayMinor: string;
    readonly statutory?: StatutoryOverrides | undefined;
  }[];
}

interface StoredCalculationInput {
  readonly grossPayMinor: string;
  readonly statutory: Prisma.JsonObject;
}

interface StoredWorkerSnapshot {
  readonly workerNumber: string;
  readonly kind: string;
  readonly displayName: string;
  readonly governmentIdMask: string | null;
  readonly bankAccountMask: string | null;
  readonly jurisdictionCode: string;
  readonly profileEffectiveFrom: string;
}

/**
 * Tenant-scoped payroll aggregate. Controllers intentionally stay thin: every
 * state transition, calculation snapshot, audit event and journal post is
 * committed here inside one database transaction.
 */
export class PayrollService {
  private readonly authorization: AuthorizationService;
  private readonly journals: JournalService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly statutory: Pick<
      PayrollStatutoryCalculator,
      "calculate"
    > = new PayrollStatutoryCalculator()
  ) {
    this.authorization = new AuthorizationService(prisma);
    this.journals = new JournalService(prisma);
  }

  public async configure(context: OrganizationContext, input: PayrollSettingsInput) {
    await this.authorization.assert(context, "payroll:configure", "PayrollSettings");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const organization = await tx.organization.findFirst({
        where: { id: context.organizationId },
        select: { currency: true }
      });
      if (!organization)
        throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
      const defaultExpenseAccountId = requiredText(
        input.defaultExpenseAccountId,
        "default payroll expense account"
      );
      const defaultLiabilityAccountId = requiredText(
        input.defaultLiabilityAccountId,
        "default payroll liability account"
      );
      const netPayClearingAccountId = requiredText(
        input.netPayClearingAccountId,
        "net pay clearing account"
      );
      if (defaultLiabilityAccountId === netPayClearingAccountId)
        throw new AppError(
          "PAYROLL_CLEARING_ACCOUNT_DUPLICATE",
          "Use a separate liability account for net pay clearing so employee payables and tax remittances remain reviewable.",
          422
        );
      const selectedAccounts = await tx.account.findMany({
        where: {
          organizationId: context.organizationId,
          isArchived: false,
          id: {
            in: [defaultExpenseAccountId, defaultLiabilityAccountId, netPayClearingAccountId]
          }
        },
        select: { id: true, type: true, name: true, code: true }
      });
      const accountsById = new Map(selectedAccounts.map((account) => [account.id, account]));
      const requirePayrollAccount = (
        accountId: string,
        label: string,
        allowedTypes: readonly string[]
      ) => {
        const account = accountsById.get(accountId);
        if (!account)
          throw new AppError(
            "PAYROLL_LEDGER_ACCOUNT_NOT_FOUND",
            `${label} must be an active account in this organization.`,
            422,
            { accountId, label }
          );
        if (!allowedTypes.includes(account.type))
          throw new AppError(
            "PAYROLL_LEDGER_ACCOUNT_TYPE_INVALID",
            `${label} must use ${allowedTypes.join(" or ")} account type${allowedTypes.length === 1 ? "" : "s"}.`,
            422,
            {
              accountId,
              accountCode: account.code,
              accountName: account.name,
              actualType: account.type,
              allowedTypes
            }
          );
      };
      requirePayrollAccount(defaultExpenseAccountId, "Payroll expense", ["EXPENSE"]);
      requirePayrollAccount(defaultLiabilityAccountId, "Payroll remittance liability", [
        "LIABILITY"
      ]);
      requirePayrollAccount(netPayClearingAccountId, "Net pay clearing", ["LIABILITY"]);
      const row = await tx.payrollSettings.upsert({
        where: { organizationId: context.organizationId },
        create: {
          organizationId: context.organizationId,
          currency: organization.currency,
          defaultExpenseAccountId,
          defaultLiabilityAccountId,
          netPayClearingAccountId,
          calculationRulePackId: requiredText(input.calculationRulePackId, "rule pack id"),
          calculationRulePackVersion: requiredText(
            input.calculationRulePackVersion,
            "rule pack version"
          ),
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        },
        update: {
          defaultExpenseAccountId,
          defaultLiabilityAccountId,
          netPayClearingAccountId,
          calculationRulePackId: requiredText(input.calculationRulePackId, "rule pack id"),
          calculationRulePackVersion: requiredText(
            input.calculationRulePackVersion,
            "rule pack version"
          ),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      await audit(tx, context, "PAYROLL_SETTINGS_CONFIGURED", "PayrollSettings", row.id, {
        version: row.version,
        currency: row.currency
      });
      return payrollSettingsDto(row);
    });
  }

  public async createCode(
    context: OrganizationContext,
    input: PayrollCodeInput,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "payroll:configure", "PayrollCode");
    return runIdempotent(
      this.prisma,
      context,
      "payroll-code.create",
      idempotencyKey,
      input,
      async (tx) => {
        const row = await tx.payrollCode.create({
          data: {
            organizationId: context.organizationId,
            code: normalizedCode(input.code),
            name: requiredText(input.name, "payroll code name"),
            kind: input.kind,
            statutoryAttributes: input.statutoryAttributes,
            expenseAccountId: input.expenseAccountId ?? null,
            liabilityAccountId: input.liabilityAccountId ?? null,
            remittanceAuthority: nullableText(input.remittanceAuthority),
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await audit(tx, context, "PAYROLL_CODE_CREATED", "PayrollCode", row.id, {
          code: row.code,
          kind: row.kind
        });
        return { statusCode: 201, body: { payrollCode: payrollCodeDto(row) }, resourceId: row.id };
      }
    );
  }

  /**
   * Creates only the statutory code mappings required by the released CA-AB
   * regular-payroll path. Existing mappings are deliberately left untouched:
   * an accountant may have assigned different ledger accounts or authorities.
   */
  public async ensureCaAbBaseCodes(context: OrganizationContext, idempotencyKey?: string) {
    await this.authorization.assert(context, "payroll:configure", "PayrollCode");
    return runIdempotent(
      this.prisma,
      context,
      "payroll-code.ensure-ca-ab-base-set",
      idempotencyKey,
      { jurisdiction: "CA-AB", version: "2026.2" },
      async (tx) => {
        const settings = await tx.payrollSettings.findFirst({
          where: { organizationId: context.organizationId }
        });
        if (!settings)
          throw new AppError(
            "PAYROLL_NOT_CONFIGURED",
            "Configure payroll ledger accounts before creating the CA-AB base code set.",
            409
          );
        const codeSet = caAbBaseCodeSet(settings, context.user.id);
        const result = await tx.payrollCode.createMany({
          data: codeSet.map((code) => ({ organizationId: context.organizationId, ...code })),
          skipDuplicates: true
        });
        const [activeCodeCount, requiredCodes] = await Promise.all([
          tx.payrollCode.count({
            where: { organizationId: context.organizationId, active: true }
          }),
          tx.payrollCode.findMany({
            where: {
              organizationId: context.organizationId,
              active: true,
              code: { in: CA_AB_BASE_CODE_REQUIREMENTS.map((requirement) => requirement.code) }
            },
            select: { code: true, kind: true }
          })
        ]);
        const readiness = caAbBaseCodeReadiness(requiredCodes);
        await audit(
          tx,
          context,
          "PAYROLL_CA_AB_BASE_CODES_ENSURED",
          "PayrollCodeSet",
          settings.id,
          {
            created: result.count,
            activeCodeCount,
            ready: readiness.ready,
            missing: readiness.missing,
            invalid: readiness.invalid,
            jurisdiction: "CA-AB",
            existingMappingsPreserved: true
          }
        );
        return {
          statusCode: 201,
          body: {
            payrollCodeSet: {
              jurisdiction: "CA-AB",
              created: result.count,
              activeCodeCount,
              readiness,
              existingMappingsPreserved: true
            }
          },
          resourceId: settings.id
        };
      }
    );
  }

  public async createWorker(
    context: OrganizationContext,
    input: PayrollWorkerInput,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "payroll:manage", "PayrollWorker");
    const government = validateEnvelope(input.governmentId, "government identifier");
    const bank = validateEnvelope(input.bankAccount, "bank account");
    return runIdempotent(
      this.prisma,
      context,
      "payroll-worker.create",
      idempotencyKey,
      input,
      async (tx) => {
        const organization = await tx.organization.findFirst({
          where: { id: context.organizationId },
          select: { currency: true }
        });
        if (!organization)
          throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
        const worker = await tx.payrollWorker.create({
          data: {
            organizationId: context.organizationId,
            workerNumber: requiredText(input.workerNumber, "worker number"),
            kind: input.kind,
            displayName: requiredText(input.displayName, "worker display name"),
            governmentIdCiphertext: government?.ciphertext ?? null,
            governmentIdKeyVersion: government?.keyVersion ?? null,
            governmentIdLastFour: government?.lastFour ?? null,
            bankAccountCiphertext: bank?.ciphertext ?? null,
            bankAccountKeyVersion: bank?.keyVersion ?? null,
            bankAccountLastFour: bank?.lastFour ?? null,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await tx.payrollWorkerProfile.create({
          data: {
            organizationId: context.organizationId,
            workerId: worker.id,
            effectiveFrom: parseDate(input.profile.effectiveFrom, "profile effectiveFrom"),
            effectiveTo: optionalDate(input.profile.effectiveTo, "profile effectiveTo"),
            status: input.profile.status ?? "ACTIVE",
            jurisdictionCode: normalizedCode(input.profile.jurisdictionCode),
            taxAttributes: input.profile.taxAttributes,
            createdByUserId: context.user.id
          }
        });
        await tx.payrollCompensation.create({
          data: {
            organizationId: context.organizationId,
            workerId: worker.id,
            effectiveFrom: parseDate(
              input.compensation.effectiveFrom,
              "compensation effectiveFrom"
            ),
            effectiveTo: optionalDate(input.compensation.effectiveTo, "compensation effectiveTo"),
            kind: input.compensation.kind,
            rateMinor: parseBigInt(input.compensation.rateMinor, "rateMinor", false),
            hoursPerPeriodMicros:
              input.compensation.hoursPerPeriodMicros == null
                ? null
                : parseBigInt(
                    input.compensation.hoursPerPeriodMicros,
                    "hoursPerPeriodMicros",
                    false
                  ),
            currency: organization.currency,
            createdByUserId: context.user.id
          }
        });
        await audit(tx, context, "PAYROLL_WORKER_CREATED", "PayrollWorker", worker.id, {
          workerNumber: worker.workerNumber,
          kind: worker.kind,
          governmentIdStored: government !== null,
          bankAccountStored: bank !== null
        });
        return {
          statusCode: 201,
          body: { payrollWorker: payrollWorkerDto(worker) },
          resourceId: worker.id
        };
      }
    );
  }

  public async listWorkers(context: OrganizationContext) {
    await this.authorization.assert(context, "payroll:read", "PayrollWorker");
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.payrollWorker.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ displayName: "asc" }, { workerNumber: "asc" }],
        take: 500
      })
    );
    return rows.map(payrollWorkerDto);
  }

  /**
   * Returns a compact, non-sensitive payroll control surface. It intentionally
   * describes what the installation can do now rather than implying that tax
   * filing, direct deposit, or every jurisdiction is already enabled.
   */
  public async overview(context: OrganizationContext) {
    await this.authorization.assert(context, "payroll:read", "Payroll");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const [
        settings,
        workers,
        schedules,
        periods,
        runs,
        remittances,
        paymentBatches,
        codeCount,
        requiredCodes
      ] = await Promise.all([
        tx.payrollSettings.findFirst({ where: { organizationId: context.organizationId } }),
        tx.payrollWorker.findMany({
          where: { organizationId: context.organizationId },
          orderBy: [{ displayName: "asc" }, { workerNumber: "asc" }],
          take: 500
        }),
        tx.payrollSchedule.findMany({
          where: { organizationId: context.organizationId },
          orderBy: [{ active: "desc" }, { anchorPayDate: "asc" }, { code: "asc" }],
          take: 100
        }),
        tx.payrollPeriod.findMany({
          where: { organizationId: context.organizationId },
          include: { schedule: { select: { id: true, code: true, name: true, frequency: true } } },
          orderBy: [{ payDate: "desc" }, { sequence: "desc" }],
          take: 100
        }),
        tx.payrollRun.findMany({
          where: { organizationId: context.organizationId },
          include: {
            schedule: { select: { id: true, code: true, name: true, frequency: true } },
            _count: { select: { workers: true, remittances: true, paymentBatches: true } }
          },
          orderBy: [{ payDate: "desc" }, { createdAt: "desc" }],
          take: 100
        }),
        tx.payrollRemittance.findMany({
          where: { organizationId: context.organizationId, status: "OPEN" },
          include: { run: { select: { id: true, runNumber: true, currency: true } } },
          orderBy: [{ dueDate: "asc" }, { authorityCode: "asc" }],
          take: 100
        }),
        tx.payrollPaymentBatch.findMany({
          where: { organizationId: context.organizationId },
          include: { run: { select: { id: true, runNumber: true, currency: true } } },
          orderBy: [{ paymentDate: "desc" }, { createdAt: "desc" }],
          take: 100
        }),
        tx.payrollCode.count({ where: { organizationId: context.organizationId, active: true } }),
        tx.payrollCode.findMany({
          where: {
            organizationId: context.organizationId,
            active: true,
            code: { in: CA_AB_BASE_CODE_REQUIREMENTS.map((requirement) => requirement.code) }
          },
          select: { code: true, kind: true }
        })
      ]);
      return {
        settings: settings ? payrollSettingsDto(settings) : null,
        workers: workers.map(payrollWorkerDto),
        schedules: schedules.map(payrollScheduleDto),
        periods: periods.map((period) => ({
          ...payrollPeriodDto(period),
          schedule: period.schedule
        })),
        runs: runs.map(payrollRunSummaryDto),
        openRemittances: remittances.map((remittance) => ({
          id: remittance.id,
          authorityCode: remittance.authorityCode,
          amountMinor: remittance.amountMinor.toString(),
          dueDate: dateOnly(remittance.dueDate),
          status: remittance.status,
          run: remittance.run
        })),
        paymentBatches: paymentBatches.map((batch) => ({
          ...paymentBatchDto(batch),
          run: batch.run
        })),
        activePayrollCodeCount: codeCount,
        caAbBaseCodes: caAbBaseCodeReadiness(requiredCodes),
        capabilities: payrollCapabilities()
      };
    });
  }

  public async updateScheduleAutomation(
    context: OrganizationContext,
    scheduleId: string,
    input: PayrollScheduleAutomationInput
  ) {
    await this.authorization.assert(context, "payroll:configure", "PayrollSchedule", scheduleId);
    const leadDays = draftLeadDays(input.draftLeadDays);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const changed = await tx.payrollSchedule.updateMany({
        where: {
          id: scheduleId,
          organizationId: context.organizationId,
          version: input.version
        },
        data: {
          automaticDraftsEnabled: input.automaticDraftsEnabled,
          draftLeadDays: leadDays,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "STALE_PAYROLL_SCHEDULE",
          "Payroll schedule changed or is no longer available.",
          409
        );
      const schedule = await tx.payrollSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
      await audit(
        tx,
        context,
        "PAYROLL_SCHEDULE_AUTOMATION_UPDATED",
        "PayrollSchedule",
        schedule.id,
        {
          automaticDraftsEnabled: schedule.automaticDraftsEnabled,
          draftLeadDays: schedule.draftLeadDays,
          version: schedule.version
        }
      );
      return payrollScheduleDto(schedule);
    });
  }

  /**
   * Builds a DRAFT regular pay run from explicitly supplied period dates and
   * effective worker compensation. Payroll calendars are never guessed. A
   * person must still calculate, review, approve, post, and fund the result.
   */
  public async generateScheduledDraft(
    context: OrganizationContext,
    scheduleId: string,
    input: ScheduledPayrollDraftInput,
    idempotencyKey?: string,
    automationInvocation = false
  ) {
    if (automationInvocation) await this.assertScheduledDraftAutomation(context, scheduleId);
    else await this.authorization.assert(context, "payroll:manage", "PayrollSchedule", scheduleId);
    return runIdempotent(
      this.prisma,
      context,
      "payroll-schedule.generate-draft",
      idempotencyKey,
      { scheduleId, ...input },
      async (tx) => {
        const settings = await tx.payrollSettings.findFirst({
          where: { organizationId: context.organizationId }
        });
        if (!settings)
          throw new AppError(
            "PAYROLL_NOT_CONFIGURED",
            "Configure payroll ledger accounts before preparing a scheduled draft.",
            409
          );
        const schedule = await tx.payrollSchedule.findFirst({
          where: { id: scheduleId, organizationId: context.organizationId, active: true }
        });
        if (!schedule)
          throw new AppError(
            "PAYROLL_SCHEDULE_NOT_FOUND",
            "Active payroll schedule was not found.",
            404
          );
        const periodStart = parseDate(input.periodStart, "periodStart");
        const periodEnd = parseDate(input.periodEnd, "periodEnd");
        const payDate = parseDate(input.payDate, "payDate");
        if (periodEnd < periodStart)
          throw new AppError(
            "PAYROLL_PERIOD_RANGE_INVALID",
            "Payroll period end must not be earlier than its start.",
            422
          );
        const existingPeriod = await tx.payrollPeriod.findFirst({
          where: {
            organizationId: context.organizationId,
            scheduleId: schedule.id,
            periodStart,
            periodEnd
          }
        });
        if (existingPeriod && dateOnly(existingPeriod.payDate) !== dateOnly(payDate))
          throw new AppError(
            "PAYROLL_PERIOD_CONFLICT",
            "The existing payroll period has a different pay date.",
            409
          );
        const latestSequence = await tx.payrollPeriod.aggregate({
          where: { organizationId: context.organizationId, scheduleId: schedule.id },
          _max: { sequence: true }
        });
        const sequence = input.sequence ?? (latestSequence._max.sequence ?? 0) + 1;
        if (!Number.isInteger(sequence) || sequence < 1)
          throw new AppError(
            "PAYROLL_PERIOD_SEQUENCE_INVALID",
            "Payroll period sequence must be a positive whole number.",
            422
          );
        const period =
          existingPeriod ??
          (await tx.payrollPeriod.create({
            data: {
              organizationId: context.organizationId,
              scheduleId: schedule.id,
              periodStart,
              periodEnd,
              payDate,
              sequence
            }
          }));
        const existingRun = await tx.payrollRun.findFirst({
          where: {
            organizationId: context.organizationId,
            scheduleId: schedule.id,
            periodId: period.id
          }
        });
        if (existingRun)
          return {
            statusCode: 200,
            body: { payrollRun: await runDto(tx, existingRun.id, context.organizationId) },
            resourceId: existingRun.id
          };

        const workers = await tx.payrollWorker.findMany({
          where: { organizationId: context.organizationId },
          orderBy: [{ displayName: "asc" }, { workerNumber: "asc" }],
          take: 500
        });
        const selectedWorkers: Array<{
          readonly effective: Awaited<ReturnType<typeof effectiveWorker>>;
          readonly grossPayMinor: bigint;
          readonly statutory: Prisma.InputJsonValue;
        }> = [];
        for (const worker of workers) {
          let effective: Awaited<ReturnType<typeof effectiveWorker>>;
          try {
            effective = await effectiveWorker(tx, context.organizationId, worker.id, payDate);
          } catch (error) {
            if (error instanceof AppError && error.code === "PAYROLL_WORKER_NOT_ACTIVE") continue;
            throw error;
          }
          if (effective.profile.jurisdictionCode !== "CA-AB")
            throw new AppError(
              "PAYROLL_AUTOMATION_JURISDICTION_NOT_RELEASED",
              "Scheduled drafts currently require every included worker to use the released CA-AB rule pack. U.S. and other jurisdiction packs remain validation-only until their full state/provincial, filing, and payment controls are released.",
              422,
              {
                workerNumber: effective.worker.workerNumber,
                jurisdictionCode: effective.profile.jurisdictionCode
              }
            );
          selectedWorkers.push({
            effective,
            grossPayMinor: scheduledGrossPay(effective.compensation, schedule.frequency),
            statutory: payrollProfileStatutoryInput(effective.profile.taxAttributes)
          });
        }
        if (!selectedWorkers.length)
          throw new AppError(
            "PAYROLL_AUTOMATION_NO_ACTIVE_WORKERS",
            "No active workers have an effective payroll profile for this pay date.",
            409
          );
        const runNumber = scheduledRunNumber(schedule.code, payDate, period.sequence);
        const duplicateRunNumber = await tx.payrollRun.findFirst({
          where: { organizationId: context.organizationId, runNumber }
        });
        if (duplicateRunNumber)
          throw new AppError(
            "PAYROLL_RUN_NUMBER_CONFLICT",
            "A payroll run already uses this scheduled run number.",
            409
          );
        const run = await tx.payrollRun.create({
          data: {
            organizationId: context.organizationId,
            runNumber,
            kind: "REGULAR",
            scheduleId: schedule.id,
            periodId: period.id,
            currency: settings.currency,
            periodStart,
            periodEnd,
            payDate,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        for (const worker of selectedWorkers) {
          const { effective, grossPayMinor, statutory } = worker;
          await tx.payrollRunWorker.create({
            data: {
              organizationId: context.organizationId,
              runId: run.id,
              workerId: effective.worker.id,
              workerSnapshot: {
                workerNumber: effective.worker.workerNumber,
                kind: effective.worker.kind,
                displayName: effective.worker.displayName,
                governmentIdMask: mask(effective.worker.governmentIdLastFour),
                bankAccountMask: mask(effective.worker.bankAccountLastFour),
                jurisdictionCode: effective.profile.jurisdictionCode,
                profileEffectiveFrom: dateOnly(effective.profile.effectiveFrom)
              },
              compensationSnapshot: {
                kind: effective.compensation.kind,
                rateMinor: effective.compensation.rateMinor.toString(),
                hoursPerPeriodMicros:
                  effective.compensation.hoursPerPeriodMicros?.toString() ?? null,
                currency: effective.compensation.currency,
                effectiveFrom: dateOnly(effective.compensation.effectiveFrom)
              },
              calculationInput: {
                grossPayMinor: grossPayMinor.toString(),
                statutory
              }
            }
          });
        }
        await audit(tx, context, "PAYROLL_SCHEDULED_DRAFT_CREATED", "PayrollRun", run.id, {
          scheduleId: schedule.id,
          periodId: period.id,
          runNumber: run.runNumber,
          workerCount: selectedWorkers.length,
          automaticPosting: false,
          automaticPayments: false,
          automaticFiling: false
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "payroll.run.draft.created",
            aggregateType: "PayrollRun",
            aggregateId: run.id,
            payload: {
              payrollRunId: run.id,
              scheduleId: schedule.id,
              periodId: period.id,
              payDate: dateOnly(payDate)
            }
          }
        });
        return {
          statusCode: 201,
          body: { payrollRun: await runDto(tx, run.id, context.organizationId) },
          resourceId: run.id
        };
      }
    );
  }

  /** Runs enabled schedules against their explicit period records. Intended for
   * a tightly-scoped scheduler credential; it still only produces DRAFT runs. */
  public async generateDueScheduledDrafts(context: OrganizationContext, asOfDate: string) {
    await this.assertScheduledDraftAutomation(context);
    const asOf = parseDate(asOfDate, "asOfDate");
    const horizon = addDays(asOf, 31);
    const candidates = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.payrollPeriod.findMany({
        where: {
          organizationId: context.organizationId,
          payDate: { lte: horizon },
          schedule: { active: true, automaticDraftsEnabled: true }
        },
        include: { schedule: true, runs: { select: { id: true }, take: 1 } },
        orderBy: [{ payDate: "asc" }, { sequence: "asc" }],
        take: 200
      })
    );
    const result = {
      asOfDate: dateOnly(asOf),
      checked: candidates.length,
      created: [] as string[],
      alreadyPrepared: [] as string[],
      notDue: [] as string[],
      blocked: [] as Array<{ scheduleId: string; periodId: string; code: string; message: string }>
    };
    for (const period of candidates) {
      if (period.runs.length) {
        result.alreadyPrepared.push(period.id);
        continue;
      }
      if (period.payDate > addDays(asOf, period.schedule.draftLeadDays)) {
        result.notDue.push(period.id);
        continue;
      }
      try {
        const generated = await this.generateScheduledDraft(
          context,
          period.scheduleId,
          {
            periodStart: dateOnly(period.periodStart),
            periodEnd: dateOnly(period.periodEnd),
            payDate: dateOnly(period.payDate),
            sequence: period.sequence
          },
          `payroll-automatic-draft:${period.scheduleId}:${period.id}`,
          true
        );
        if (generated.replayed || generated.statusCode === 200)
          result.alreadyPrepared.push(period.id);
        else {
          result.created.push(period.id);
          await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
            tx.payrollSchedule.update({
              where: { id: period.scheduleId },
              data: { lastAutomaticDraftAt: new Date(), updatedByUserId: context.user.id }
            })
          );
        }
      } catch (error) {
        if (error instanceof AppError)
          result.blocked.push({
            scheduleId: period.scheduleId,
            periodId: period.id,
            code: error.code,
            message: error.message
          });
        else throw error;
      }
    }
    return result;
  }

  private async assertScheduledDraftAutomation(context: OrganizationContext, scheduleId?: string) {
    // A person using the UI already has the ordinary payroll-management permission.
    // A stored API credential must instead carry the narrow automation-only scope,
    // which is deliberately insufficient for calculation, review, approval, posting,
    // payment exports, or filing.
    await this.authorization.assert(
      context,
      context.apiCredentialScopes ? "payroll:automation" : "payroll:manage",
      "PayrollSchedule",
      scheduleId ?? null
    );
  }

  public async createSchedule(
    context: OrganizationContext,
    input: PayrollScheduleInput,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "payroll:configure", "PayrollSchedule");
    return runIdempotent(
      this.prisma,
      context,
      "payroll-schedule.create",
      idempotencyKey,
      input,
      async (tx) => {
        const row = await tx.payrollSchedule.create({
          data: {
            organizationId: context.organizationId,
            code: normalizedCode(input.code),
            name: requiredText(input.name, "schedule name"),
            frequency: input.frequency,
            anchorPayDate: parseDate(input.anchorPayDate, "anchorPayDate"),
            automaticDraftsEnabled: input.automaticDraftsEnabled ?? false,
            draftLeadDays: draftLeadDays(input.draftLeadDays),
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await audit(tx, context, "PAYROLL_SCHEDULE_CREATED", "PayrollSchedule", row.id, {
          code: row.code,
          frequency: row.frequency,
          automaticDraftsEnabled: row.automaticDraftsEnabled,
          draftLeadDays: row.draftLeadDays
        });
        return {
          statusCode: 201,
          body: { payrollSchedule: payrollScheduleDto(row) },
          resourceId: row.id
        };
      }
    );
  }

  public async createPeriod(context: OrganizationContext, input: PayrollPeriodInput) {
    await this.authorization.assert(context, "payroll:configure", "PayrollPeriod");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const schedule = await tx.payrollSchedule.findFirst({
        where: { id: input.scheduleId, organizationId: context.organizationId, active: true }
      });
      if (!schedule)
        throw new AppError(
          "PAYROLL_SCHEDULE_NOT_FOUND",
          "Active payroll schedule was not found.",
          404
        );
      const row = await tx.payrollPeriod.create({
        data: {
          organizationId: context.organizationId,
          scheduleId: schedule.id,
          periodStart: parseDate(input.periodStart, "periodStart"),
          periodEnd: parseDate(input.periodEnd, "periodEnd"),
          payDate: parseDate(input.payDate, "payDate"),
          sequence: input.sequence
        }
      });
      await audit(tx, context, "PAYROLL_PERIOD_CREATED", "PayrollPeriod", row.id, {
        scheduleId: schedule.id,
        sequence: row.sequence
      });
      return payrollPeriodDto(row);
    });
  }

  public async createRun(
    context: OrganizationContext,
    input: PayrollRunInput,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "payroll:manage", "PayrollRun");
    if (input.workers.length === 0)
      throw new AppError("PAYROLL_RUN_EMPTY", "A payroll run requires at least one worker.", 422);
    if (new Set(input.workers.map((worker) => worker.workerId)).size !== input.workers.length)
      throw new AppError(
        "PAYROLL_RUN_DUPLICATE_WORKER",
        "A worker can appear only once in a payroll run.",
        422
      );
    return runIdempotent(
      this.prisma,
      context,
      "payroll-run.create",
      idempotencyKey,
      input,
      async (tx) => {
        const settings = await tx.payrollSettings.findFirst({
          where: { organizationId: context.organizationId }
        });
        if (!settings)
          throw new AppError(
            "PAYROLL_NOT_CONFIGURED",
            "Configure payroll ledger accounts first.",
            409
          );
        const periodStart = parseDate(input.periodStart, "periodStart");
        const periodEnd = parseDate(input.periodEnd, "periodEnd");
        const payDate = parseDate(input.payDate, "payDate");
        const schedule = input.scheduleId
          ? await tx.payrollSchedule.findFirst({
              where: { id: input.scheduleId, organizationId: context.organizationId, active: true }
            })
          : null;
        if (input.scheduleId && !schedule)
          throw new AppError(
            "PAYROLL_SCHEDULE_NOT_FOUND",
            "Active payroll schedule was not found.",
            404
          );
        if (input.kind === "REGULAR" && !schedule)
          throw new AppError(
            "PAYROLL_SCHEDULE_REQUIRED",
            "Regular payroll runs require an active schedule.",
            422
          );
        if (input.kind === "CORRECTION")
          await requirePostedOriginal(tx, context.organizationId, input.correctionOfRunId);
        if (input.kind !== "CORRECTION" && input.correctionOfRunId)
          throw new AppError(
            "PAYROLL_CORRECTION_LINK_INVALID",
            "Only correction runs may link an original run.",
            422
          );

        const run = await tx.payrollRun.create({
          data: {
            organizationId: context.organizationId,
            runNumber: requiredText(input.runNumber, "run number"),
            kind: input.kind,
            scheduleId: schedule?.id ?? null,
            periodId: input.periodId ?? null,
            correctionOfRunId: input.correctionOfRunId ?? null,
            currency: settings.currency,
            periodStart,
            periodEnd,
            payDate,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        for (const inputWorker of input.workers) {
          const effective = await effectiveWorker(
            tx,
            context.organizationId,
            inputWorker.workerId,
            payDate
          );
          const gross = parseBigInt(
            inputWorker.grossPayMinor,
            "grossPayMinor",
            input.kind === "CORRECTION"
          );
          await tx.payrollRunWorker.create({
            data: {
              organizationId: context.organizationId,
              runId: run.id,
              workerId: effective.worker.id,
              workerSnapshot: {
                workerNumber: effective.worker.workerNumber,
                kind: effective.worker.kind,
                displayName: effective.worker.displayName,
                governmentIdMask: mask(effective.worker.governmentIdLastFour),
                bankAccountMask: mask(effective.worker.bankAccountLastFour),
                jurisdictionCode: effective.profile.jurisdictionCode,
                profileEffectiveFrom: dateOnly(effective.profile.effectiveFrom)
              },
              compensationSnapshot: {
                kind: effective.compensation.kind,
                rateMinor: effective.compensation.rateMinor.toString(),
                hoursPerPeriodMicros:
                  effective.compensation.hoursPerPeriodMicros?.toString() ?? null,
                currency: effective.compensation.currency,
                effectiveFrom: dateOnly(effective.compensation.effectiveFrom)
              },
              calculationInput: {
                grossPayMinor: gross.toString(),
                statutory: jsonSafe(inputWorker.statutory ?? {})
              }
            }
          });
        }
        await audit(tx, context, "PAYROLL_RUN_CREATED", "PayrollRun", run.id, {
          runNumber: run.runNumber,
          kind: run.kind,
          workerCount: input.workers.length,
          correctionOfRunId: run.correctionOfRunId
        });
        return {
          statusCode: 201,
          body: { payrollRun: await runDto(tx, run.id, context.organizationId) },
          resourceId: run.id
        };
      }
    );
  }

  public async calculate(context: OrganizationContext, runId: string) {
    await this.authorization.assert(context, "payroll:manage", "PayrollRun", runId);
    return withTenantTransaction(
      this.prisma,
      dbContext(context),
      async (tx) => {
        await lockRun(tx, runId, context.organizationId);
        const run = await tx.payrollRun.findFirst({
          where: { id: runId, organizationId: context.organizationId },
          include: { schedule: true, workers: true }
        });
        if (!run) throw new AppError("PAYROLL_RUN_NOT_FOUND", "Payroll run was not found.", 404);
        if (run.status !== "DRAFT" && run.status !== "CALCULATED")
          throw new AppError(
            "PAYROLL_RUN_NOT_EDITABLE",
            "Only a draft or calculated run can be recalculated.",
            409
          );
        if (run.kind !== "REGULAR")
          throw new AppError(
            "PAYROLL_STATUTORY_RUN_KIND_UNSUPPORTED",
            "Statutory calculation is currently released only for regular periodic payroll; off-cycle and correction drafts require a reviewed specialized rule pack.",
            422
          );
        const frequency = run.schedule?.frequency ?? "BIWEEKLY";
        const packIdentities: Array<{ id: string; version: string; sourceHash: string }> = [];
        for (const runWorker of run.workers) {
          await tx.payrollYtdBalance.deleteMany({
            where: { organizationId: context.organizationId, runWorkerId: runWorker.id }
          });
          await tx.payrollRunComponent.deleteMany({
            where: { organizationId: context.organizationId, runWorkerId: runWorker.id }
          });
          const snapshot = workerSnapshot(runWorker.workerSnapshot);
          if (snapshot.jurisdictionCode !== "CA-AB")
            throw new AppError(
              "PAYROLL_JURISDICTION_NOT_RELEASED",
              "Native posting is currently released only for complete CA-AB regular payroll calculations.",
              422,
              { jurisdictionCode: snapshot.jurisdictionCode }
            );
          const calculationInput = storedInput(runWorker.calculationInput);
          const gross = parseBigInt(calculationInput.grossPayMinor, "grossPayMinor", false);
          const ytd = await statutoryYtd(
            tx,
            context.organizationId,
            runWorker.workerId,
            run.payDate
          );
          let result;
          try {
            result = this.statutory.calculate({
              ...statutoryOverridesFromStored(calculationInput.statutory),
              jurisdiction: snapshot.jurisdictionCode,
              payDate: dateOnly(run.payDate),
              payFrequency: frequency,
              grossPayMinor: gross,
              ytd
            });
          } catch (error) {
            if (error instanceof PayrollStatutoryDiagnosticError)
              throw new AppError(
                error.code,
                error.message,
                422,
                jsonSafe(error.diagnostic) as Record<string, unknown>
              );
            throw error;
          }
          const codes = await tx.payrollCode.findMany({
            where: {
              organizationId: context.organizationId,
              code: { in: result.components.map((component) => component.code) },
              active: true
            }
          });
          const byCode = new Map(codes.map((code) => [code.code, code]));
          for (const component of result.components) {
            const code = byCode.get(component.code);
            if (!code || code.kind !== component.category)
              throw new AppError(
                "PAYROLL_CODE_MAPPING_MISSING",
                `Active ${component.category} payroll code ${component.code} is required.`,
                409,
                {
                  code: component.code,
                  category: component.category
                }
              );
            await tx.payrollRunComponent.create({
              data: {
                organizationId: context.organizationId,
                runWorkerId: runWorker.id,
                codeId: code.id,
                codeSnapshot: { code: code.code, name: code.name, version: code.version },
                kind: component.category,
                employeeAmountMinor: component.employeeAmountMinor,
                employerAmountMinor: component.employerAmountMinor,
                subjectWagesMinor: component.subjectWagesMinor,
                explanation: component.explanation
              }
            });
            const previous = await previousYtdForCode(
              tx,
              context.organizationId,
              runWorker.workerId,
              code.id,
              run.payDate
            );
            await tx.payrollYtdBalance.create({
              data: {
                organizationId: context.organizationId,
                workerId: runWorker.workerId,
                runWorkerId: runWorker.id,
                codeId: code.id,
                taxYear: run.payDate.getUTCFullYear(),
                employeeAmountMinor: previous.employee + component.employeeAmountMinor,
                employerAmountMinor: previous.employer + component.employerAmountMinor,
                subjectWagesMinor: previous.subject + component.subjectWagesMinor
              }
            });
          }
          const variance = await priorVarianceFlags(
            tx,
            context.organizationId,
            runWorker.workerId,
            run.id,
            result.totals
          );
          await tx.payrollRunWorker.update({
            where: { id: runWorker.id },
            data: {
              calculationExplanation: jsonSafe({
                rulePack: result.rulePack,
                detail: result.explanation
              }),
              grossPayMinor: result.totals.grossPayMinor,
              employeeDeductionsMinor: result.totals.employeeDeductionsMinor,
              employerContributionsMinor: result.totals.employerContributionsMinor,
              netPayMinor: result.totals.netPayMinor,
              priorRunVarianceFlags: variance
            }
          });
          packIdentities.push(result.rulePack);
        }
        const pack = aggregateRulePack(packIdentities);
        await tx.payrollRun.update({
          where: { id: run.id },
          data: {
            status: "CALCULATED",
            rulePackId: pack.id,
            rulePackVersion: pack.version,
            rulePackSourceHash: pack.sourceHash,
            calculatedAt: new Date(),
            reviewedByUserId: null,
            reviewedAt: null,
            approvedByUserId: null,
            approvedAt: null,
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        await audit(tx, context, "PAYROLL_RUN_CALCULATED", "PayrollRun", run.id, {
          workerCount: run.workers.length,
          rulePackId: pack.id,
          rulePackVersion: pack.version,
          rulePackSourceHash: pack.sourceHash
        });
        return runDto(tx, run.id, context.organizationId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  public async review(context: OrganizationContext, runId: string, version: number) {
    await this.authorization.assert(context, "payroll:review", "PayrollRun", runId);
    return this.transition(
      context,
      runId,
      version,
      "CALCULATED",
      "REVIEWED",
      "PAYROLL_RUN_REVIEWED"
    );
  }

  public async approve(context: OrganizationContext, runId: string, version: number) {
    await this.authorization.assert(context, "payroll:approve", "PayrollRun", runId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.payrollRun.findFirst({
        where: { id: runId, organizationId: context.organizationId }
      });
      if (!current || current.status !== "REVIEWED" || current.version !== version)
        throw new AppError(
          "STALE_PAYROLL_RUN",
          "Only the current reviewed payroll run can be approved.",
          409
        );
      if (current.reviewedByUserId === context.user.id)
        throw new AppError(
          "PAYROLL_APPROVER_SEPARATION_REQUIRED",
          "The reviewer and approver must be different users.",
          409
        );
      await tx.payrollRun.update({
        where: { id: current.id },
        data: {
          status: "APPROVED",
          approvedByUserId: context.user.id,
          approvedAt: new Date(),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      await audit(tx, context, "PAYROLL_RUN_APPROVED", "PayrollRun", runId, {
        reviewedByUserId: current.reviewedByUserId
      });
      return runDto(tx, runId, context.organizationId);
    });
  }

  public async post(
    context: OrganizationContext,
    runId: string,
    version: number,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "payroll:post", "PayrollRun", runId);
    return runIdempotent(
      this.prisma,
      context,
      "payroll-run.post",
      idempotencyKey,
      { runId, version },
      async (tx) => {
        await lockRun(tx, runId, context.organizationId);
        const run = await tx.payrollRun.findFirst({
          where: { id: runId, organizationId: context.organizationId },
          include: {
            workers: { include: { components: { include: { code: true } }, worker: true } }
          }
        });
        if (!run || run.status !== "APPROVED" || run.version !== version)
          throw new AppError(
            "STALE_PAYROLL_RUN",
            "Only the current approved payroll run can be posted.",
            409
          );
        const settings = await tx.payrollSettings.findFirst({
          where: { organizationId: context.organizationId }
        });
        if (!settings)
          throw new AppError(
            "PAYROLL_NOT_CONFIGURED",
            "Configure payroll ledger accounts first.",
            409
          );
        const lines = postingLines(run.workers, settings);
        const journal = await this.journals.postJournalInTransaction(
          tx,
          context,
          {
            description: `Payroll ${run.runNumber}`,
            effectiveDate: dateOnly(run.payDate),
            sourceType: "payroll_run",
            sourceId: run.id,
            postingKey: `payroll:${run.id}`,
            allowControlAccountPosting: true,
            lines
          },
          true
        );
        for (const worker of run.workers) {
          const metadata = {
            runId: run.id,
            runNumber: run.runNumber,
            runWorkerId: worker.id,
            workerNumber: worker.worker.workerNumber,
            workerDisplayName: worker.worker.displayName,
            governmentIdMask: mask(worker.worker.governmentIdLastFour),
            bankAccountMask: mask(worker.worker.bankAccountLastFour),
            grossPayMinor: worker.grossPayMinor.toString(),
            employeeDeductionsMinor: worker.employeeDeductionsMinor.toString(),
            employerContributionsMinor: worker.employerContributionsMinor.toString(),
            netPayMinor: worker.netPayMinor.toString(),
            currency: run.currency,
            payDate: dateOnly(run.payDate),
            rulePack: {
              id: run.rulePackId,
              version: run.rulePackVersion,
              sourceHash: run.rulePackSourceHash
            }
          };
          await tx.payrollPayslipSnapshot.create({
            data: {
              organizationId: context.organizationId,
              runWorkerId: worker.id,
              templateVersion: "payroll-payslip-v1",
              contentHash: sha256(stableJson(metadata)),
              metadata
            }
          });
        }
        await tx.payrollRun.update({
          where: { id: run.id },
          data: {
            status: "POSTED",
            journalId: journal.id,
            postedByUserId: context.user.id,
            postedAt: new Date(),
            updatedByUserId: context.user.id,
            version: { increment: 1 }
          }
        });
        for (const remittance of remittanceTotals(run.workers)) {
          if (remittance.amountMinor === 0n) continue;
          await tx.payrollRemittance.create({
            data: {
              organizationId: context.organizationId,
              runId: run.id,
              authorityCode: remittance.authorityCode,
              liabilityAccountId: remittance.liabilityAccountId,
              amountMinor: remittance.amountMinor,
              dueDate: run.payDate
            }
          });
        }
        await audit(tx, context, "PAYROLL_RUN_POSTED", "PayrollRun", run.id, {
          journalId: journal.id,
          postingKey: `payroll:${run.id}`,
          bankAccountCredited: false,
          netPayClearingAccountId: settings.netPayClearingAccountId
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "payroll.run.posted",
            aggregateType: "PayrollRun",
            aggregateId: run.id,
            payload: { payrollRunId: run.id, journalId: journal.id, payDate: dateOnly(run.payDate) }
          }
        });
        return {
          statusCode: 200,
          body: { payrollRun: await runDto(tx, run.id, context.organizationId) },
          resourceId: run.id
        };
      }
    );
  }

  public async createPaymentBatch(
    context: OrganizationContext,
    runId: string,
    input: { readonly batchNumber: string; readonly paymentDate: string },
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "payroll:payments", "PayrollPaymentBatch", runId);
    return runIdempotent(
      this.prisma,
      context,
      "payroll-payment-batch.create",
      idempotencyKey,
      { runId, ...input },
      async (tx) => {
        const run = await tx.payrollRun.findFirst({
          where: { id: runId, organizationId: context.organizationId, status: "POSTED" },
          include: { workers: { include: { worker: true } } }
        });
        if (!run)
          throw new AppError(
            "POSTED_PAYROLL_RUN_NOT_FOUND",
            "Posted payroll run was not found.",
            404
          );
        if (run.workers.some((worker) => worker.netPayMinor < 0n))
          throw new AppError(
            "PAYROLL_NEGATIVE_NET_NOT_PAYABLE",
            "Negative net corrections cannot be included in a payment batch.",
            409
          );
        const total = run.workers.reduce((sum, worker) => sum + worker.netPayMinor, 0n);
        const batch = await tx.payrollPaymentBatch.create({
          data: {
            organizationId: context.organizationId,
            runId: run.id,
            batchNumber: requiredText(input.batchNumber, "batch number"),
            paymentDate: parseDate(input.paymentDate, "paymentDate"),
            totalMinor: total,
            createdByUserId: context.user.id,
            items: {
              create: run.workers.map((worker) => ({
                runWorkerId: worker.id,
                amountMinor: worker.netPayMinor,
                bankAccountMask: mask(worker.worker.bankAccountLastFour)
              }))
            }
          }
        });
        await audit(tx, context, "PAYROLL_PAYMENT_BATCH_CREATED", "PayrollPaymentBatch", batch.id, {
          payrollRunId: run.id,
          itemCount: run.workers.length,
          totalMinor: total.toString(),
          accountingEntryCreated: false
        });
        return {
          statusCode: 201,
          body: { payrollPaymentBatch: paymentBatchDto(batch) },
          resourceId: batch.id
        };
      }
    );
  }

  public async recordPaymentExport(
    context: OrganizationContext,
    batchId: string,
    input: {
      readonly format: string;
      readonly contentHash: string;
      readonly encryptedStorageKey: string;
    }
  ) {
    await this.authorization.assert(context, "payroll:payments", "PayrollPaymentBatch", batchId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const batch = await tx.payrollPaymentBatch.findFirst({
        where: {
          id: batchId,
          organizationId: context.organizationId,
          status: { in: ["DRAFT", "EXPORTED"] }
        }
      });
      if (!batch)
        throw new AppError(
          "PAYROLL_PAYMENT_BATCH_NOT_FOUND",
          "Editable payroll payment batch was not found.",
          404
        );
      if (!/^[a-f0-9]{64}$/i.test(input.contentHash))
        throw new AppError(
          "PAYROLL_EXPORT_HASH_INVALID",
          "Payment export contentHash must be a SHA-256 hex digest.",
          422
        );
      const sequence =
        (await tx.payrollPaymentExport.count({
          where: { organizationId: context.organizationId, batchId }
        })) + 1;
      const record = await tx.payrollPaymentExport.create({
        data: {
          organizationId: context.organizationId,
          batchId,
          format: requiredText(input.format, "export format"),
          sequence,
          contentHash: input.contentHash.toLowerCase(),
          encryptedStorageKey: requiredText(input.encryptedStorageKey, "encrypted storage key"),
          exportedByUserId: context.user.id
        }
      });
      await tx.payrollPaymentBatch.update({ where: { id: batchId }, data: { status: "EXPORTED" } });
      await audit(
        tx,
        context,
        "PAYROLL_PAYMENT_EXPORT_RECORDED",
        "PayrollPaymentExport",
        record.id,
        {
          payrollPaymentBatchId: batchId,
          format: record.format,
          sequence,
          contentHash: record.contentHash,
          accountingEntryCreated: false
        }
      );
      return {
        id: record.id,
        batchId,
        format: record.format,
        sequence,
        contentHash: record.contentHash,
        exportedAt: serializeDate(record.exportedAt)
      };
    });
  }

  public async getRun(context: OrganizationContext, runId: string) {
    await this.authorization.assert(context, "payroll:read", "PayrollRun", runId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const dto = await runDto(tx, runId, context.organizationId);
      if (!dto) throw new AppError("PAYROLL_RUN_NOT_FOUND", "Payroll run was not found.", 404);
      return dto;
    });
  }

  private async transition(
    context: OrganizationContext,
    runId: string,
    version: number,
    from: "CALCULATED",
    to: "REVIEWED",
    action: string
  ) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const changed = await tx.payrollRun.updateMany({
        where: { id: runId, organizationId: context.organizationId, status: from, version },
        data: {
          status: to,
          reviewedByUserId: context.user.id,
          reviewedAt: new Date(),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "STALE_PAYROLL_RUN",
          "Payroll run changed or is not ready for review.",
          409
        );
      await audit(tx, context, action, "PayrollRun", runId, {});
      return runDto(tx, runId, context.organizationId);
    });
  }
}

function postingLines(
  workers: readonly {
    readonly netPayMinor: bigint;
    readonly components: readonly {
      readonly kind: PayrollCodeKind;
      readonly employeeAmountMinor: bigint;
      readonly employerAmountMinor: bigint;
      readonly code: {
        readonly code: string;
        readonly expenseAccountId: string | null;
        readonly liabilityAccountId: string | null;
      };
    }[];
  }[],
  settings: {
    readonly defaultExpenseAccountId: string;
    readonly defaultLiabilityAccountId: string;
    readonly netPayClearingAccountId: string;
  }
) {
  const signed = new Map<string, { amount: bigint; descriptions: Set<string> }>();
  const add = (accountId: string, amount: bigint, description: string) => {
    const current = signed.get(accountId) ?? { amount: 0n, descriptions: new Set<string>() };
    current.amount += amount;
    current.descriptions.add(description);
    signed.set(accountId, current);
  };
  for (const worker of workers) {
    for (const component of worker.components) {
      if (component.kind === "EARNING")
        add(
          component.code.expenseAccountId ?? settings.defaultExpenseAccountId,
          component.employeeAmountMinor,
          component.code.code
        );
      else if (component.kind === "DEDUCTION")
        add(
          component.code.liabilityAccountId ?? settings.defaultLiabilityAccountId,
          -component.employeeAmountMinor,
          component.code.code
        );
      else {
        add(
          component.code.expenseAccountId ?? settings.defaultExpenseAccountId,
          component.employerAmountMinor,
          component.code.code
        );
        add(
          component.code.liabilityAccountId ?? settings.defaultLiabilityAccountId,
          -component.employerAmountMinor,
          component.code.code
        );
      }
    }
    add(settings.netPayClearingAccountId, -worker.netPayMinor, "NET_PAY_CLEARING");
  }
  const lines = [...signed.entries()]
    .filter(([, value]) => value.amount !== 0n)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([accountId, value]) => ({
      accountId,
      description: [...value.descriptions].sort().join(", "),
      debitMinor: (value.amount > 0n ? value.amount : 0n).toString(),
      creditMinor: (value.amount < 0n ? -value.amount : 0n).toString()
    }));
  const debits = lines.reduce((sum, line) => sum + BigInt(line.debitMinor), 0n);
  const credits = lines.reduce((sum, line) => sum + BigInt(line.creditMinor), 0n);
  if (lines.length < 2 || debits !== credits || debits === 0n)
    throw new AppError(
      "PAYROLL_JOURNAL_UNBALANCED",
      "Payroll posting must produce a non-zero balanced journal.",
      422,
      {
        debits: debits.toString(),
        credits: credits.toString()
      }
    );
  return lines;
}

function remittanceTotals(
  workers: readonly {
    readonly components: readonly {
      readonly kind: PayrollCodeKind;
      readonly employeeAmountMinor: bigint;
      readonly employerAmountMinor: bigint;
      readonly code: {
        readonly liabilityAccountId: string | null;
        readonly remittanceAuthority: string | null;
      };
    }[];
  }[]
) {
  const totals = new Map<
    string,
    { authorityCode: string; liabilityAccountId: string; amountMinor: bigint }
  >();
  for (const worker of workers)
    for (const component of worker.components) {
      if (
        component.kind === "EARNING" ||
        !component.code.liabilityAccountId ||
        !component.code.remittanceAuthority
      )
        continue;
      const amount =
        component.kind === "DEDUCTION"
          ? component.employeeAmountMinor
          : component.employerAmountMinor;
      const key = `${component.code.remittanceAuthority}\0${component.code.liabilityAccountId}`;
      const current = totals.get(key) ?? {
        authorityCode: component.code.remittanceAuthority,
        liabilityAccountId: component.code.liabilityAccountId,
        amountMinor: 0n
      };
      current.amountMinor += amount;
      totals.set(key, current);
    }
  return [...totals.values()];
}

async function effectiveWorker(
  tx: Tx,
  organizationId: string,
  workerId: string,
  effectiveDate: Date
) {
  const worker = await tx.payrollWorker.findFirst({ where: { id: workerId, organizationId } });
  if (!worker) throw new AppError("PAYROLL_WORKER_NOT_FOUND", "Payroll worker was not found.", 404);
  const profile = await tx.payrollWorkerProfile.findFirst({
    where: {
      organizationId,
      workerId,
      effectiveFrom: { lte: effectiveDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }]
    },
    orderBy: { effectiveFrom: "desc" }
  });
  const compensation = await tx.payrollCompensation.findFirst({
    where: {
      organizationId,
      workerId,
      effectiveFrom: { lte: effectiveDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveDate } }]
    },
    orderBy: { effectiveFrom: "desc" }
  });
  if (!profile || profile.status !== "ACTIVE")
    throw new AppError(
      "PAYROLL_WORKER_NOT_ACTIVE",
      "Worker has no active profile for the pay date.",
      409
    );
  if (!compensation)
    throw new AppError(
      "PAYROLL_COMPENSATION_MISSING",
      "Worker has no compensation effective on the pay date.",
      409
    );
  return { worker, profile, compensation };
}

async function statutoryYtd(tx: Tx, organizationId: string, workerId: string, payDate: Date) {
  const start = new Date(Date.UTC(payDate.getUTCFullYear(), 0, 1));
  const components = await tx.payrollRunComponent.findMany({
    where: {
      organizationId,
      runWorker: { workerId, run: { status: "POSTED", payDate: { gte: start, lt: payDate } } }
    },
    include: { code: { select: { code: true } } }
  });
  const employee = (codes: readonly string[]) =>
    components
      .filter((row) => codes.includes(row.code.code))
      .reduce((sum, row) => sum + row.employeeAmountMinor, 0n);
  const employer = (codes: readonly string[]) =>
    components
      .filter((row) => codes.includes(row.code.code))
      .reduce((sum, row) => sum + row.employerAmountMinor, 0n);
  const subject = (codes: readonly string[]) =>
    components
      .filter((row) => codes.includes(row.code.code))
      .reduce((sum, row) => sum + row.subjectWagesMinor, 0n);
  return {
    pensionableWagesMinor: subject(["GROSS_PAY"]),
    pensionPlanContributionMinor: employee(["CA_CPP_EMPLOYEE", "CA_QPP_EMPLOYEE"]),
    pensionPlanSecondContributionMinor: employee(["CA_CPP2_EMPLOYEE", "CA_QPP2_EMPLOYEE"]),
    eiEmployeeContributionMinor: employee(["CA_EI_EMPLOYEE"]),
    eiEmployerContributionMinor: employer(["CA_EI_EMPLOYER"]),
    qpipEmployeeContributionMinor: employee(["CA_QPIP_EMPLOYEE"]),
    qpipEmployerContributionMinor: employer(["CA_QPIP_EMPLOYER"]),
    socialSecurityWagesMinor: subject(["US_SOCIAL_SECURITY_EMPLOYEE"]),
    medicareWagesMinor: subject(["US_MEDICARE_EMPLOYEE"]),
    futaWagesMinor: subject(["US_FUTA_EMPLOYER"])
  };
}

async function previousYtdForCode(
  tx: Tx,
  organizationId: string,
  workerId: string,
  codeId: string,
  payDate: Date
) {
  const start = new Date(Date.UTC(payDate.getUTCFullYear(), 0, 1));
  const aggregate = await tx.payrollRunComponent.aggregate({
    where: {
      organizationId,
      codeId,
      runWorker: { workerId, run: { status: "POSTED", payDate: { gte: start, lt: payDate } } }
    },
    _sum: { employeeAmountMinor: true, employerAmountMinor: true, subjectWagesMinor: true }
  });
  return {
    employee: aggregate._sum.employeeAmountMinor ?? 0n,
    employer: aggregate._sum.employerAmountMinor ?? 0n,
    subject: aggregate._sum.subjectWagesMinor ?? 0n
  };
}

async function priorVarianceFlags(
  tx: Tx,
  organizationId: string,
  workerId: string,
  excludedRunId: string,
  current: {
    readonly grossPayMinor: bigint;
    readonly employeeDeductionsMinor: bigint;
    readonly netPayMinor: bigint;
  }
) {
  const previous = await tx.payrollRunWorker.findFirst({
    where: {
      organizationId,
      workerId,
      runId: { not: excludedRunId },
      run: { status: "POSTED", kind: "REGULAR" }
    },
    orderBy: { createdAt: "desc" }
  });
  if (!previous) return [];
  const flags: string[] = [];
  if (materialVariance(previous.grossPayMinor, current.grossPayMinor))
    flags.push("GROSS_PAY_CHANGE_OVER_20_PERCENT");
  if (materialVariance(previous.employeeDeductionsMinor, current.employeeDeductionsMinor))
    flags.push("DEDUCTION_CHANGE_OVER_20_PERCENT");
  if (materialVariance(previous.netPayMinor, current.netPayMinor))
    flags.push("NET_PAY_CHANGE_OVER_20_PERCENT");
  return flags;
}

function materialVariance(previous: bigint, current: bigint): boolean {
  if (previous === 0n) return current !== 0n;
  const delta = current >= previous ? current - previous : previous - current;
  return delta * 100n > (previous < 0n ? -previous : previous) * 20n;
}

async function requirePostedOriginal(
  tx: Tx,
  organizationId: string,
  originalId: string | null | undefined
) {
  if (!originalId)
    throw new AppError(
      "PAYROLL_CORRECTION_LINK_REQUIRED",
      "Correction payroll requires a posted original run.",
      422
    );
  const original = await tx.payrollRun.findFirst({
    where: { id: originalId, organizationId, status: "POSTED" }
  });
  if (!original)
    throw new AppError(
      "PAYROLL_ORIGINAL_NOT_POSTED",
      "Correction payroll requires a posted original run.",
      409
    );
}

async function lockRun(tx: Tx, runId: string, organizationId: string) {
  const rows = await tx.$queryRaw<readonly { id: string }[]>(
    RuntimePrisma.sql`SELECT "id" FROM "PayrollRun" WHERE "id" = ${runId}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`
  );
  if (rows.length === 0)
    throw new AppError("PAYROLL_RUN_NOT_FOUND", "Payroll run was not found.", 404);
}

async function runDto(tx: Tx, id: string, organizationId: string) {
  const row = await tx.payrollRun.findFirst({
    where: { id, organizationId },
    include: {
      workers: {
        include: {
          components: {
            include: { code: { select: { code: true, name: true } } },
            orderBy: { createdAt: "asc" }
          },
          payslipSnapshot: true
        },
        orderBy: { createdAt: "asc" }
      },
      remittances: { orderBy: [{ dueDate: "asc" }, { authorityCode: "asc" }] }
    }
  });
  if (!row) return null;
  return {
    id: row.id,
    runNumber: row.runNumber,
    kind: row.kind,
    status: row.status,
    scheduleId: row.scheduleId,
    periodId: row.periodId,
    correctionOfRunId: row.correctionOfRunId,
    currency: row.currency,
    periodStart: dateOnly(row.periodStart),
    periodEnd: dateOnly(row.periodEnd),
    payDate: dateOnly(row.payDate),
    rulePack: row.rulePackId
      ? { id: row.rulePackId, version: row.rulePackVersion, sourceHash: row.rulePackSourceHash }
      : null,
    version: row.version,
    journalId: row.journalId,
    calculatedAt: row.calculatedAt ? serializeDate(row.calculatedAt) : null,
    reviewedAt: row.reviewedAt ? serializeDate(row.reviewedAt) : null,
    approvedAt: row.approvedAt ? serializeDate(row.approvedAt) : null,
    postedAt: row.postedAt ? serializeDate(row.postedAt) : null,
    workers: row.workers.map((worker) => ({
      id: worker.id,
      workerId: worker.workerId,
      worker: workerSnapshot(worker.workerSnapshot),
      draftGrossPayMinor:
        row.status === "DRAFT" ? storedInput(worker.calculationInput).grossPayMinor : null,
      grossPayMinor: worker.grossPayMinor.toString(),
      employeeDeductionsMinor: worker.employeeDeductionsMinor.toString(),
      employerContributionsMinor: worker.employerContributionsMinor.toString(),
      netPayMinor: worker.netPayMinor.toString(),
      priorRunVarianceFlags: worker.priorRunVarianceFlags ?? [],
      calculationExplanation: worker.calculationExplanation,
      components: worker.components.map((component) => ({
        id: component.id,
        code: component.code.code,
        name: component.code.name,
        kind: component.kind,
        employeeAmountMinor: component.employeeAmountMinor.toString(),
        employerAmountMinor: component.employerAmountMinor.toString(),
        subjectWagesMinor: component.subjectWagesMinor.toString(),
        explanation: component.explanation
      })),
      payslip: worker.payslipSnapshot
        ? {
            id: worker.payslipSnapshot.id,
            templateVersion: worker.payslipSnapshot.templateVersion,
            contentHash: worker.payslipSnapshot.contentHash,
            createdAt: serializeDate(worker.payslipSnapshot.createdAt)
          }
        : null
    })),
    remittances: row.remittances.map((remittance) => ({
      id: remittance.id,
      authorityCode: remittance.authorityCode,
      liabilityAccountId: remittance.liabilityAccountId,
      amountMinor: remittance.amountMinor.toString(),
      dueDate: dateOnly(remittance.dueDate),
      status: remittance.status
    }))
  };
}

function payrollWorkerDto(row: {
  readonly id: string;
  readonly workerNumber: string;
  readonly kind: string;
  readonly displayName: string;
  readonly governmentIdLastFour: string | null;
  readonly bankAccountLastFour: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}) {
  return {
    id: row.id,
    workerNumber: row.workerNumber,
    kind: row.kind,
    displayName: row.displayName,
    governmentIdMask: mask(row.governmentIdLastFour),
    bankAccountMask: mask(row.bankAccountLastFour),
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt)
  };
}

function payrollSettingsDto(row: {
  readonly id: string;
  readonly currency: string;
  readonly defaultExpenseAccountId: string;
  readonly defaultLiabilityAccountId: string;
  readonly netPayClearingAccountId: string;
  readonly calculationRulePackId: string;
  readonly calculationRulePackVersion: string;
  readonly version: number;
}) {
  return { ...row };
}

function payrollCodeDto(row: {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly statutoryAttributes: Prisma.JsonValue;
  readonly expenseAccountId: string | null;
  readonly liabilityAccountId: string | null;
  readonly remittanceAuthority: string | null;
  readonly active: boolean;
  readonly version: number;
}) {
  return { ...row };
}

function payrollScheduleDto(row: {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly frequency: string;
  readonly anchorPayDate: Date;
  readonly active: boolean;
  readonly automaticDraftsEnabled: boolean;
  readonly draftLeadDays: number;
  readonly lastAutomaticDraftAt: Date | null;
  readonly version: number;
}) {
  return {
    ...row,
    anchorPayDate: dateOnly(row.anchorPayDate),
    lastAutomaticDraftAt: row.lastAutomaticDraftAt ? serializeDate(row.lastAutomaticDraftAt) : null
  };
}

function payrollPeriodDto(row: {
  readonly id: string;
  readonly scheduleId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly payDate: Date;
  readonly sequence: number;
}) {
  return {
    ...row,
    periodStart: dateOnly(row.periodStart),
    periodEnd: dateOnly(row.periodEnd),
    payDate: dateOnly(row.payDate)
  };
}

function paymentBatchDto(row: {
  readonly id: string;
  readonly runId: string;
  readonly batchNumber: string;
  readonly status: string;
  readonly paymentDate: Date;
  readonly totalMinor: bigint;
  readonly createdAt: Date;
}) {
  return {
    id: row.id,
    runId: row.runId,
    batchNumber: row.batchNumber,
    status: row.status,
    paymentDate: dateOnly(row.paymentDate),
    totalMinor: row.totalMinor.toString(),
    createdAt: serializeDate(row.createdAt)
  };
}

function payrollRunSummaryDto(row: {
  readonly id: string;
  readonly runNumber: string;
  readonly kind: string;
  readonly status: string;
  readonly currency: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly payDate: Date;
  readonly version: number;
  readonly journalId: string | null;
  readonly createdAt: Date;
  readonly schedule: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly frequency: string;
  } | null;
  readonly _count: {
    readonly workers: number;
    readonly remittances: number;
    readonly paymentBatches: number;
  };
}) {
  return {
    id: row.id,
    runNumber: row.runNumber,
    kind: row.kind,
    status: row.status,
    currency: row.currency,
    periodStart: dateOnly(row.periodStart),
    periodEnd: dateOnly(row.periodEnd),
    payDate: dateOnly(row.payDate),
    version: row.version,
    journalId: row.journalId,
    createdAt: serializeDate(row.createdAt),
    schedule: row.schedule,
    workerCount: row._count.workers,
    remittanceCount: row._count.remittances,
    paymentBatchCount: row._count.paymentBatches
  };
}

function payrollCapabilities() {
  return {
    scheduledDrafts: {
      enabled: true,
      description:
        "Enabled schedules create DRAFT runs only from explicit payroll periods and effective compensation."
    },
    automaticCalculation: {
      enabled: false,
      description: "A person must calculate and review each draft before it can advance."
    },
    automaticPosting: {
      enabled: false,
      description: "Posting always requires the configured approval and posting permissions."
    },
    directDeposit: {
      enabled: false,
      description:
        "Payment batches are controlled exports; provider onboarding, authorization, and bank acceptance are required before funds movement."
    },
    taxFiling: {
      enabled: false,
      description:
        "Remittance records support review. Government submission and payment require a dedicated approved filing provider."
    },
    providerGates: payrollProviderGates(),
    releasedPostingJurisdictions: ["CA-AB"],
    validationOnlyRulePacks: ["CA-QC", "US-FEDERAL"],
    usCoverage:
      "Federal withholding, FICA, and FUTA calculations are tested separately. State/local withholding, unemployment, paid leave, and filing must be covered by an approved state/provider pack before a U.S. run may post."
  };
}

const CA_AB_BASE_CODE_REQUIREMENTS = [
  { code: "GROSS_PAY", kind: "EARNING" },
  { code: "CA_CPP_EMPLOYEE", kind: "DEDUCTION" },
  { code: "CA_CPP_EMPLOYER", kind: "EMPLOYER_CONTRIBUTION" },
  { code: "CA_CPP2_EMPLOYEE", kind: "DEDUCTION" },
  { code: "CA_CPP2_EMPLOYER", kind: "EMPLOYER_CONTRIBUTION" },
  { code: "CA_EI_EMPLOYEE", kind: "DEDUCTION" },
  { code: "CA_EI_EMPLOYER", kind: "EMPLOYER_CONTRIBUTION" },
  { code: "CA_FEDERAL_INCOME_TAX", kind: "DEDUCTION" },
  { code: "CA_AB_INCOME_TAX", kind: "DEDUCTION" },
  { code: "CA_TD1_ADDITIONAL_TAX", kind: "DEDUCTION" }
] as const;

function caAbBaseCodeReadiness(codes: readonly { code: string; kind: string }[]) {
  const byCode = new Map(codes.map((code) => [code.code, code]));
  const missing: string[] = [];
  const invalid: Array<{ code: string; expectedKind: string; actualKind: string }> = [];
  for (const requirement of CA_AB_BASE_CODE_REQUIREMENTS) {
    const actual = byCode.get(requirement.code);
    if (!actual) {
      missing.push(requirement.code);
      continue;
    }
    if (actual.kind !== requirement.kind)
      invalid.push({
        code: requirement.code,
        expectedKind: requirement.kind,
        actualKind: actual.kind
      });
  }
  return {
    required: CA_AB_BASE_CODE_REQUIREMENTS.map((requirement) => ({ ...requirement })),
    missing,
    invalid,
    ready: missing.length === 0 && invalid.length === 0
  };
}

function caAbBaseCodeSet(
  settings: {
    readonly defaultExpenseAccountId: string;
    readonly defaultLiabilityAccountId: string;
  },
  userId: string
) {
  const statutoryAttributes = { jurisdiction: "CA-AB", baseCodeSet: "2026.2" };
  const contribution = (code: string, name: string) => ({
    code,
    name,
    kind: "EMPLOYER_CONTRIBUTION" as const,
    statutoryAttributes,
    expenseAccountId: settings.defaultExpenseAccountId,
    liabilityAccountId: settings.defaultLiabilityAccountId,
    remittanceAuthority: "CRA",
    active: true,
    createdByUserId: userId,
    updatedByUserId: userId
  });
  const deduction = (code: string, name: string) => ({
    code,
    name,
    kind: "DEDUCTION" as const,
    statutoryAttributes,
    expenseAccountId: null,
    liabilityAccountId: settings.defaultLiabilityAccountId,
    remittanceAuthority: "CRA",
    active: true,
    createdByUserId: userId,
    updatedByUserId: userId
  });
  return [
    {
      code: "GROSS_PAY",
      name: "Regular gross pay",
      kind: "EARNING" as const,
      statutoryAttributes,
      expenseAccountId: settings.defaultExpenseAccountId,
      liabilityAccountId: null,
      remittanceAuthority: null,
      active: true,
      createdByUserId: userId,
      updatedByUserId: userId
    },
    deduction("CA_CPP_EMPLOYEE", "CPP employee contribution"),
    contribution("CA_CPP_EMPLOYER", "CPP employer contribution"),
    deduction("CA_CPP2_EMPLOYEE", "CPP2 employee contribution"),
    contribution("CA_CPP2_EMPLOYER", "CPP2 employer contribution"),
    deduction("CA_EI_EMPLOYEE", "Employment Insurance employee premium"),
    contribution("CA_EI_EMPLOYER", "Employment Insurance employer premium"),
    deduction("CA_FEDERAL_INCOME_TAX", "Federal income tax withholding"),
    deduction("CA_AB_INCOME_TAX", "Alberta income tax withholding"),
    deduction("CA_TD1_ADDITIONAL_TAX", "Additional TD1 income tax withholding")
  ];
}

function scheduledGrossPay(
  compensation: {
    readonly kind: string;
    readonly rateMinor: bigint;
    readonly hoursPerPeriodMicros: bigint | null;
  },
  frequency: string
) {
  if (compensation.kind === "FIXED") return compensation.rateMinor;
  if (compensation.kind === "SALARY") {
    const periods = payPeriodsPerYear(frequency);
    return roundMinorDivision(compensation.rateMinor, BigInt(periods));
  }
  if (compensation.kind === "HOURLY") {
    if (!compensation.hoursPerPeriodMicros || compensation.hoursPerPeriodMicros <= 0n)
      throw new AppError(
        "PAYROLL_AUTOMATION_HOURS_REQUIRED",
        "An hourly worker needs default hours per payroll period before a scheduled draft can be prepared.",
        409
      );
    return roundMinorDivision(
      compensation.rateMinor * compensation.hoursPerPeriodMicros,
      1_000_000n
    );
  }
  throw new AppError(
    "PAYROLL_AUTOMATION_COMPENSATION_UNSUPPORTED",
    "The worker compensation type cannot be used for a scheduled payroll draft.",
    422
  );
}

function payPeriodsPerYear(frequency: string) {
  const periods = {
    WEEKLY: 52,
    BIWEEKLY: 26,
    SEMIMONTHLY: 24,
    MONTHLY: 12
  }[frequency];
  if (!periods)
    throw new AppError(
      "PAYROLL_SCHEDULE_FREQUENCY_UNSUPPORTED",
      "Payroll schedule frequency is not supported for scheduled draft compensation.",
      422
    );
  return periods;
}

function roundMinorDivision(numerator: bigint, denominator: bigint) {
  return (numerator + denominator / 2n) / denominator;
}

function payrollProfileStatutoryInput(value: Prisma.JsonValue): Prisma.InputJsonValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return jsonSafe(value);
}

/**
 * Prisma JSON cannot retain bigint values. Convert the supported statutory
 * amount fields at the service boundary so a browser/API client can submit
 * integer minor-unit strings without changing statutory arithmetic into
 * floating point or string concatenation.
 */
function statutoryOverridesFromStored(value: Prisma.JsonObject): StatutoryOverrides {
  const source = statutoryObject(value, "statutory input");
  const optionalMinor = (field: string) => statutoryMinor(source[field], field);
  const withholdingSource =
    source.canadianWithholding == null
      ? null
      : statutoryObject(source.canadianWithholding, "canadianWithholding");
  const w4Source = source.usW4 == null ? null : statutoryObject(source.usW4, "usW4");
  const canadianWithholding = withholdingSource
    ? {
        federalClaimCode: statutoryClaimCode(
          withholdingSource.federalClaimCode,
          "canadianWithholding.federalClaimCode"
        ),
        provincialClaimCode: statutoryClaimCode(
          withholdingSource.provincialClaimCode,
          "canadianWithholding.provincialClaimCode"
        ),
        additionalTaxMinor: statutoryMinor(
          withholdingSource.additionalTaxMinor,
          "canadianWithholding.additionalTaxMinor"
        )
      }
    : undefined;
  const usW4 = w4Source
    ? {
        formYear: statutoryWholeNumber(w4Source.formYear, "usW4.formYear", true)!,
        filingStatus: statutoryUsFilingStatus(w4Source.filingStatus),
        step2Checkbox: statutoryBoolean(w4Source.step2Checkbox, "usW4.step2Checkbox"),
        step3CreditsAnnualMinor: statutoryMinor(
          w4Source.step3CreditsAnnualMinor,
          "usW4.step3CreditsAnnualMinor"
        ),
        step4OtherIncomeAnnualMinor: statutoryMinor(
          w4Source.step4OtherIncomeAnnualMinor,
          "usW4.step4OtherIncomeAnnualMinor"
        ),
        step4DeductionsAnnualMinor: statutoryMinor(
          w4Source.step4DeductionsAnnualMinor,
          "usW4.step4DeductionsAnnualMinor"
        ),
        extraWithholdingPerPeriodMinor: statutoryMinor(
          w4Source.extraWithholdingPerPeriodMinor,
          "usW4.extraWithholdingPerPeriodMinor"
        )
      }
    : undefined;
  return {
    pensionableWagesMinor: optionalMinor("pensionableWagesMinor"),
    insurableWagesMinor: optionalMinor("insurableWagesMinor"),
    qpipInsurableWagesMinor: optionalMinor("qpipInsurableWagesMinor"),
    federalIncomeTaxWagesMinor: optionalMinor("federalIncomeTaxWagesMinor"),
    ficaWagesMinor: optionalMinor("ficaWagesMinor"),
    futaWagesMinor: optionalMinor("futaWagesMinor"),
    monthsSubjectToPensionPlan: statutoryWholeNumber(
      source.monthsSubjectToPensionPlan,
      "monthsSubjectToPensionPlan",
      false
    ),
    canadianWithholding,
    usW4,
    usFutaStateCreditRatePpm: optionalMinor("usFutaStateCreditRatePpm")
  };
}

function statutoryObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("PAYROLL_STATUTORY_INPUT_INVALID", `${field} must be an object.`, 422);
  return value as Record<string, unknown>;
}

function statutoryMinor(value: unknown, field: string): bigint | undefined {
  if (value == null) return undefined;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  throw new AppError(
    "PAYROLL_STATUTORY_INPUT_INVALID",
    `${field} must be an integer minor-unit string or a safe integer.`,
    422
  );
}

function statutoryWholeNumber(
  value: unknown,
  field: string,
  required: boolean
): number | undefined {
  if (value == null && !required) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new AppError("PAYROLL_STATUTORY_INPUT_INVALID", `${field} must be a whole number.`, 422);
}

function statutoryClaimCode(value: unknown, field: string): StatutoryClaimCode | undefined {
  const result = statutoryWholeNumber(value, field, false);
  if (result == null) return undefined;
  if (result < 0 || result > 10)
    throw new AppError(
      "PAYROLL_STATUTORY_INPUT_INVALID",
      `${field} must be a TD1 claim code from 0 through 10.`,
      422
    );
  return result as StatutoryClaimCode;
}

function statutoryBoolean(value: unknown, field: string): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === "boolean") return value;
  throw new AppError("PAYROLL_STATUTORY_INPUT_INVALID", `${field} must be true or false.`, 422);
}

function statutoryUsFilingStatus(value: unknown): StatutoryUsFilingStatus {
  if (
    value === "SINGLE_OR_MARRIED_FILING_SEPARATELY" ||
    value === "MARRIED_FILING_JOINTLY" ||
    value === "HEAD_OF_HOUSEHOLD"
  )
    return value;
  throw new AppError(
    "PAYROLL_STATUTORY_INPUT_INVALID",
    "usW4.filingStatus must be a supported 2020-or-later W-4 filing status.",
    422
  );
}

function scheduledRunNumber(scheduleCode: string, payDate: Date, sequence: number) {
  return `AUTO-${scheduleCode}-${dateOnly(payDate).replaceAll("-", "")}-${String(sequence)}`;
}

function draftLeadDays(value: number | undefined) {
  const normalized = value ?? 3;
  if (!Number.isInteger(normalized) || normalized < 0 || normalized > 31)
    throw new AppError(
      "PAYROLL_DRAFT_LEAD_DAYS_INVALID",
      "Payroll draft lead days must be a whole number from 0 through 31.",
      422
    );
  return normalized;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function validateEnvelope(
  input: EncryptedIdentifierEnvelopeInput | null | undefined,
  label: string
) {
  if (!input) return null;
  if (!input.ciphertext.trim() || !input.keyVersion.trim() || !/^\d{4}$/.test(input.lastFour))
    throw new AppError(
      "PAYROLL_ENCRYPTED_IDENTIFIER_INVALID",
      `${label} requires ciphertext, key version, and four numeric mask digits.`,
      422
    );
  return {
    ciphertext: input.ciphertext.trim(),
    keyVersion: input.keyVersion.trim(),
    lastFour: input.lastFour
  };
}

function storedInput(value: Prisma.JsonValue): StoredCalculationInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(
      "PAYROLL_CALCULATION_INPUT_INVALID",
      "Stored payroll calculation input is invalid.",
      500
    );
  const gross = value.grossPayMinor;
  const statutory = value.statutory;
  if (
    typeof gross !== "string" ||
    !statutory ||
    typeof statutory !== "object" ||
    Array.isArray(statutory)
  )
    throw new AppError(
      "PAYROLL_CALCULATION_INPUT_INVALID",
      "Stored payroll calculation input is invalid.",
      500
    );
  return { grossPayMinor: gross, statutory };
}

function workerSnapshot(value: Prisma.JsonValue): StoredWorkerSnapshot {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.workerNumber !== "string" ||
    typeof value.kind !== "string" ||
    typeof value.displayName !== "string" ||
    typeof value.jurisdictionCode !== "string" ||
    typeof value.profileEffectiveFrom !== "string"
  )
    throw new AppError(
      "PAYROLL_WORKER_SNAPSHOT_INVALID",
      "Stored payroll worker snapshot is invalid.",
      500
    );
  return {
    workerNumber: value.workerNumber,
    kind: value.kind,
    displayName: value.displayName,
    governmentIdMask: typeof value.governmentIdMask === "string" ? value.governmentIdMask : null,
    bankAccountMask: typeof value.bankAccountMask === "string" ? value.bankAccountMask : null,
    jurisdictionCode: value.jurisdictionCode,
    profileEffectiveFrom: value.profileEffectiveFrom
  };
}

function aggregateRulePack(packs: readonly { id: string; version: string; sourceHash: string }[]) {
  const unique = [
    ...new Map(
      packs.map((pack) => [`${pack.id}:${pack.version}:${pack.sourceHash}`, pack])
    ).values()
  ].sort((left, right) =>
    `${left.id}:${left.version}`.localeCompare(`${right.id}:${right.version}`)
  );
  if (unique.length === 1) return unique[0]!;
  const material = stableJson(unique);
  return {
    id: "MULTI_JURISDICTION",
    version: sha256(material).slice(0, 16),
    sourceHash: sha256(material)
  };
}

function parseBigInt(value: string, field: string, allowNegative: boolean) {
  if (!/^-?\d+$/.test(value))
    throw new AppError(
      "PAYROLL_AMOUNT_INVALID",
      `${field} must be an integer minor-unit string.`,
      422
    );
  const parsed = BigInt(value);
  if (!allowNegative && parsed < 0n)
    throw new AppError("PAYROLL_AMOUNT_INVALID", `${field} cannot be negative.`, 422);
  return parsed;
}

function jsonSafe(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item
    )
  ) as Prisma.InputJsonValue;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function mask(lastFour: string | null) {
  return lastFour ? `***${lastFour}` : null;
}

function normalizedCode(value: string) {
  return requiredText(value, "code").toUpperCase().replace(/\s+/g, "_");
}

function requiredText(value: string, field: string) {
  const normalized = value.trim();
  if (!normalized) throw new AppError("PAYROLL_FIELD_REQUIRED", `${field} is required.`, 422);
  return normalized;
}

function nullableText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function optionalDate(value: string | null | undefined, field: string) {
  return value ? parseDate(value, field) : null;
}

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

async function audit(
  tx: Tx,
  context: OrganizationContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Prisma.InputJsonObject
) {
  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      actorUserId: context.user.id,
      action,
      targetType,
      targetId,
      requestId: context.requestId,
      metadata: withAuditOrigin(context, metadata)
    }
  });
}
