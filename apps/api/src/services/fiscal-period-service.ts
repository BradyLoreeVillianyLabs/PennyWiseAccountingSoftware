import {
  Prisma,
  withTenantTransaction,
  type PeriodStatus,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { InventoryService } from "./inventory-service.js";
import { Phase10ReportService } from "./phase10-report-service.js";

type TransactionClient = Prisma.TransactionClient;

export interface CreateFiscalPeriodInput {
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
}

export class FiscalPeriodService {
  private readonly authorization: AuthorizationService;
  private readonly inventory: InventoryService;
  private readonly reports: Phase10ReportService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
    this.inventory = new InventoryService(prisma);
    this.reports = new Phase10ReportService(prisma);
  }

  public async listPeriods(context: OrganizationContext) {
    await this.authorization.assert(context, "reports:read", "FiscalPeriod");

    const periods = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.fiscalPeriod.findMany({
        where: { organizationId: context.organizationId, ...companyScope(context) },
        orderBy: { startDate: "asc" }
      })
    );

    return periods.map((period) => this.periodDto(period));
  }

  public async createPeriod(context: OrganizationContext, input: CreateFiscalPeriodInput) {
    await this.authorization.assert(context, "periods:manage", "FiscalPeriod");

    const startDate = parseDate(input.startDate, "startDate");
    const endDate = parseDate(input.endDate, "endDate");

    if (endDate < startDate) {
      throw new AppError(
        "INVALID_PERIOD_RANGE",
        "Fiscal period endDate must be on or after startDate."
      );
    }

    try {
      return await withTenantTransaction(
        this.prisma,
        dbContext(context),
        async (tx) => {
          const overlapping = await tx.fiscalPeriod.findFirst({
            where: {
              organizationId: context.organizationId,
              ...companyScope(context),
              startDate: { lte: endDate },
              endDate: { gte: startDate }
            }
          });

          if (overlapping) {
            throw new AppError("FISCAL_PERIOD_OVERLAP", "Fiscal periods cannot overlap.", 409, {
              periodId: overlapping.id
            });
          }

          const period = await tx.fiscalPeriod.create({
            data: {
              organizationId: context.organizationId,
              ...companyScope(context),
              name: input.name,
              startDate,
              endDate
            }
          });

          await this.writeAuditEvent(
            tx,
            context,
            "FISCAL_PERIOD_CREATED",
            "FiscalPeriod",
            period.id,
            {
              name: period.name,
              startDate: serializeDate(period.startDate),
              endDate: serializeDate(period.endDate)
            }
          );

          return this.periodDto(period);
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable
        }
      );
    } catch (error) {
      await this.throwFiscalPeriodOverlapIfPresent(context, startDate, endDate, error);
      throw error;
    }
  }

  public async closePeriod(
    context: OrganizationContext,
    periodId: string,
    reason: string,
    acknowledgeWarnings = false
  ) {
    await this.authorization.assert(context, "periods:close", "FiscalPeriod", periodId);

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await this.lockPeriod(tx, context, periodId);

      if (existing.status === "CLOSED") {
        return this.periodDto(existing);
      }
      const checklist = await this.closeChecklist(
        tx,
        context,
        existing.startDate,
        existing.endDate
      );
      if (checklist.warnings.length > 0 && !acknowledgeWarnings)
        throw new AppError(
          "PERIOD_CLOSE_WARNINGS_REQUIRE_ACKNOWLEDGEMENT",
          "Period close warnings must be reviewed and acknowledged.",
          409,
          { checklist }
        );

      const period = await tx.fiscalPeriod.update({
        where: { id: existing.id },
        data: {
          status: "CLOSED",
          closedAt: new Date(),
          closedByUserId: context.user.id
        }
      });
      const revision = await tx.periodCloseRecord.count({ where: { fiscalPeriodId: period.id } });
      const record = await tx.periodCloseRecord.create({
        data: {
          organizationId: context.organizationId,
          fiscalPeriodId: period.id,
          revision: revision + 1,
          action: "CLOSE",
          reason,
          checklist,
          createdByUserId: context.user.id
        }
      });

      await this.writeAuditEvent(tx, context, "FISCAL_PERIOD_CLOSED", "FiscalPeriod", period.id, {
        reason,
        closeRecordId: record.id,
        warningCount: checklist.warnings.length
      });

      return { ...this.periodDto(period), closeRecordId: record.id, checklist };
    });
  }

  public async reopenPeriod(context: OrganizationContext, periodId: string, reason: string) {
    await this.authorization.assert(context, "periods:reopen", "FiscalPeriod", periodId);

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await this.lockPeriod(tx, context, periodId);

      if (existing.status === "OPEN") {
        return this.periodDto(existing);
      }

      const period = await tx.fiscalPeriod.update({
        where: { id: existing.id },
        data: {
          status: "OPEN",
          closedAt: null,
          closedByUserId: null
        }
      });
      const revision = await tx.periodCloseRecord.count({ where: { fiscalPeriodId: period.id } });
      const record = await tx.periodCloseRecord.create({
        data: {
          organizationId: context.organizationId,
          fiscalPeriodId: period.id,
          revision: revision + 1,
          action: "REOPEN",
          reason,
          checklist: { priorClosedAt: existing.closedAt?.toISOString() ?? null },
          createdByUserId: context.user.id
        }
      });

      await this.writeAuditEvent(tx, context, "FISCAL_PERIOD_REOPENED", "FiscalPeriod", period.id, {
        reason,
        closeRecordId: record.id
      });

      return { ...this.periodDto(period), closeRecordId: record.id };
    });
  }

  public async previewClose(context: OrganizationContext, periodId: string) {
    await this.authorization.assert(context, "periods:close", "FiscalPeriod", periodId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const period = await this.findPeriod(tx, context, periodId);
      return this.closeChecklist(tx, context, period.startDate, period.endDate);
    });
  }

  private async findPeriod(tx: TransactionClient, context: OrganizationContext, periodId: string) {
    const period = await tx.fiscalPeriod.findFirst({
      where: {
        id: periodId,
        organizationId: context.organizationId,
        ...companyScope(context)
      }
    });

    if (!period) {
      throw new AppError("FISCAL_PERIOD_NOT_FOUND", "Fiscal period was not found.", 404);
    }

    return period;
  }

  private async lockPeriod(tx: TransactionClient, context: OrganizationContext, periodId: string) {
    if (context.companyId) {
      await tx.$queryRaw`
        SELECT id FROM "FiscalPeriod"
         WHERE id = ${periodId}::uuid
           AND "organizationId" = ${context.organizationId}::uuid
           AND "companyId" = ${context.companyId}::uuid
         FOR UPDATE
      `;
    } else {
      await tx.$queryRaw`
        SELECT id FROM "FiscalPeriod"
         WHERE id = ${periodId}::uuid
           AND "organizationId" = ${context.organizationId}::uuid
         FOR UPDATE
      `;
    }
    return this.findPeriod(tx, context, periodId);
  }

  private async closeChecklist(
    tx: TransactionClient,
    context: OrganizationContext,
    startDate: Date,
    endDate: Date
  ) {
    const organizationId = context.organizationId;
    const start = serializeDate(startDate).slice(0, 10);
    const end = serializeDate(endDate).slice(0, 10);
    const [
      manualDrafts,
      invoiceDrafts,
      billDrafts,
      unmatchedBank,
      unreconciledBankAccounts,
      incompleteImports,
      webhooks,
      outbox,
      suspenseBalances,
      receivables,
      payables,
      tax,
      inventory
    ] = await Promise.all([
      tx.manualJournalDraft.count({
        where: { organizationId, status: "DRAFT", effectiveDate: { lte: endDate } }
      }),
      tx.invoice.count({
        where: {
          organizationId,
          status: { in: ["DRAFT", "APPROVED"] },
          issueDate: { lte: endDate }
        }
      }),
      tx.bill.count({
        where: {
          organizationId,
          status: { in: ["DRAFT", "APPROVED"] },
          issueDate: { lte: endDate }
        }
      }),
      tx.bankImportedTransaction.count({
        where: { organizationId, postingDate: { lte: endDate }, status: "UNMATCHED" }
      }),
      tx.bankAccount.count({
        where: {
          organizationId,
          isActive: true,
          importedTransactions: {
            some: {
              postingDate: { lte: endDate },
              reconciliationItems: {
                none: { active: true, reconciliation: { status: "COMPLETED" } }
              }
            }
          }
        }
      }),
      tx.bankImportBatch.count({ where: { organizationId, status: "PREVIEWED" } }),
      tx.paymentWebhookEvent.count({
        where: { organizationId, status: { in: ["RECEIVED", "FAILED"] } }
      }),
      tx.outboxEvent.count({ where: { organizationId, status: "FAILED" } }),
      this.suspenseBalanceCount(tx, organizationId, endDate),
      this.optionalControlReport(() => this.reports.receivables(context, end)),
      this.optionalControlReport(() => this.reports.payables(context, end)),
      this.optionalControlReport(() => this.reports.taxReport(context, { from: start, to: end })),
      this.inventory.controlReconciliation(context, end)
    ]);
    const checks = {
      unpostedManualJournals: manualDrafts,
      unpostedInvoices: invoiceDrafts,
      unpostedBills: billDrafts,
      unmatchedBankTransactions: unmatchedBank,
      unreconciledBankAccounts,
      incompleteBankImports: incompleteImports,
      unresolvedPaymentWebhooks: webhooks,
      failedOutboxEvents: outbox,
      suspenseOrClearingBalances: suspenseBalances,
      receivablesControlDifferenceMinor: receivables?.differenceMinor ?? null,
      receivablesControlConfigured: receivables !== null,
      payablesControlDifferenceMinor: payables?.differenceMinor ?? null,
      payablesControlConfigured: payables !== null,
      taxControlReconciled: tax?.isReconciled ?? null,
      taxControlConfigured: tax !== null,
      inventoryControlDifferenceMinor: inventory.differenceMinor
    };
    const warnings = [
      ...Object.entries({
        unpostedManualJournals: manualDrafts,
        unpostedInvoices: invoiceDrafts,
        unpostedBills: billDrafts,
        unmatchedBankTransactions: unmatchedBank,
        unreconciledBankAccounts,
        incompleteBankImports: incompleteImports,
        unresolvedPaymentWebhooks: webhooks,
        failedOutboxEvents: outbox,
        suspenseOrClearingBalances: suspenseBalances
      })
        .filter(([, count]) => count > 0)
        .map(([code, count]) => ({ code, value: count.toString() })),
      ...(!receivables || receivables.isReconciled
        ? []
        : [{ code: "receivablesControlDifferenceMinor", value: receivables.differenceMinor }]),
      ...(!payables || payables.isReconciled
        ? []
        : [{ code: "payablesControlDifferenceMinor", value: payables.differenceMinor }]),
      ...(!tax || tax.isReconciled ? [] : [{ code: "taxControlReconciled", value: "false" }]),
      ...(inventory.isReconciled
        ? []
        : [{ code: "inventoryControlDifferenceMinor", value: inventory.differenceMinor }])
    ];
    return {
      asOf: end,
      checks,
      warnings,
      clean: warnings.length === 0
    };
  }

  private async suspenseBalanceCount(
    tx: TransactionClient,
    organizationId: string,
    endDate: Date
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
        FROM "Account" account
       WHERE account."organizationId" = ${organizationId}::uuid
         AND (
           account.name ILIKE '%suspense%'
           OR account.name ILIKE '%clearing%'
           OR COALESCE(account."systemPurpose", '') ILIKE '%suspense%'
           OR COALESCE(account."systemPurpose", '') ILIKE '%clearing%'
         )
         AND (
           SELECT COALESCE(sum(line."debitMinor" - line."creditMinor"), 0)
             FROM "JournalLine" line
             JOIN "Journal" journal ON journal.id = line."journalId"
            WHERE line."organizationId" = account."organizationId"
              AND line."accountId" = account.id
              AND journal.status = 'POSTED'
              AND journal."effectiveDate" <= ${endDate}
         ) <> 0
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  private async optionalControlReport<T>(run: () => Promise<T>): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AppError && error.code === "CONTROL_ACCOUNT_REQUIRED") return null;
      throw error;
    }
  }

  private periodDto(period: {
    id: string;
    organizationId: string;
    name: string;
    startDate: Date;
    endDate: Date;
    status: PeriodStatus;
    closedAt: Date | null;
    closedByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: period.id,
      organizationId: period.organizationId,
      name: period.name,
      startDate: serializeDate(period.startDate),
      endDate: serializeDate(period.endDate),
      status: period.status,
      closedAt: period.closedAt ? serializeDate(period.closedAt) : null,
      closedByUserId: period.closedByUserId,
      createdAt: serializeDate(period.createdAt),
      updatedAt: serializeDate(period.updatedAt)
    };
  }

  private async writeAuditEvent(
    tx: TransactionClient,
    context: OrganizationContext,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Prisma.InputJsonObject
  ): Promise<void> {
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

  private async throwFiscalPeriodOverlapIfPresent(
    context: OrganizationContext,
    startDate: Date,
    endDate: Date,
    error: unknown
  ): Promise<void> {
    if (error instanceof AppError || !isDatabaseConflict(error)) {
      throw error;
    }

    const overlapping = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.fiscalPeriod.findFirst({
        where: {
          organizationId: context.organizationId,
          ...companyScope(context),
          startDate: { lte: endDate },
          endDate: { gte: startDate }
        },
        select: { id: true }
      })
    );

    if (!overlapping) {
      throw error;
    }

    throw new AppError("FISCAL_PERIOD_OVERLAP", "Fiscal periods cannot overlap.", 409, {
      periodId: overlapping.id
    });
  }
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function companyScope(context: OrganizationContext) {
  return context.companyId ? { companyId: context.companyId } : {};
}

function isDatabaseConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2004" || error.code === "P2034")
  );
}
