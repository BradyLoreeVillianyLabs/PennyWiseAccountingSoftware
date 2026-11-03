import { withTenantTransaction, type Prisma, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AuthorizationService, hasPermission } from "../auth/permissions.js";
import { AppError } from "@clearledger/shared";
import { parseDate } from "../utils/dates.js";
import type { Phase10ReportService } from "./phase10-report-service.js";

type ReportRange = { readonly from: string; readonly to: string };
type AttentionItem = {
  readonly kind: string;
  readonly title: string;
  readonly dueDate: string;
  readonly amountMinor: string;
  readonly currency: string;
  readonly workspaceId: string;
  readonly targetId: string;
};

export class UiSummaryService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly reports: Phase10ReportService
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async homeSummary(context: OrganizationContext, asOf: string) {
    await this.authorization.assert(context, "dashboard:read", "Dashboard");
    const date = parseDate(asOf, "asOf");
    const month = monthRange(date);
    const priorMonth = priorMonthToDate(date);
    const current30 = daysRange(date, 29);
    const previous30 = daysRange(addDays(date, -30), 29);
    const [banking, receivables, payables, profit, priorProfit, currentCash, priorCash, series] =
      await Promise.all([
        this.reports.bankingReport(context, { ...month, asOf }),
        this.reports.receivables(context, asOf),
        this.reports.payables(context, asOf),
        this.reports.profitAndLoss(context, { ...month, basis: "ACCRUAL" }),
        this.reports.profitAndLoss(context, { ...priorMonth, basis: "ACCRUAL" }),
        this.reports.cashFlow(context, current30),
        this.reports.cashFlow(context, previous30),
        Promise.all(
          Array.from({ length: 12 }, (_, index) => {
            const range = monthOffsetRange(date, index - 11);
            return this.reports.profitAndLoss(context, { ...range, basis: "ACCRUAL" });
          })
        )
      ]);
    const cashIn = positiveCashChange(currentCash.detail);
    const cashOut = negativeCashChange(currentCash.detail);
    const priorCashIn = positiveCashChange(priorCash.detail);
    const priorCashOut = negativeCashChange(priorCash.detail);

    return {
      asOf,
      currency: profit.currency,
      cashOnHandMinor: sumMinor(banking.accountBalances.map((account) => account.balanceMinor)),
      moneyIn30d: comparison(cashIn, priorCashIn),
      moneyOut30d: comparison(cashOut, priorCashOut),
      profitMtd: comparison(BigInt(profit.netIncomeMinor), BigInt(priorProfit.netIncomeMinor)),
      incomeExpense12Months: series.map((row) => ({
        from: row.from,
        to: row.to,
        incomeMinor: row.totalRevenueMinor,
        expenseMinor: row.totalExpenseMinor
      })),
      receivablesAging: receivables.aging,
      payablesAging: payables.aging,
      source: "posted-ledger-and-existing-reports"
    };
  }

  public async attentionQueue(context: OrganizationContext, asOf: string) {
    await this.authorization.assert(context, "dashboard:read", "Dashboard");
    const [receivables, payables, banking, baseCurrency] = await Promise.all([
      this.reports.receivables(context, asOf),
      this.reports.payables(context, asOf),
      this.reports.bankingReport(context, { ...daysRange(parseDate(asOf, "asOf"), 29), asOf }),
      this.organizationCurrency(context)
    ]);
    const today = parseDate(asOf, "asOf");
    const sevenDays = addDays(today, 7);
    const bankTransactionIds = [
      ...banking.unmatchedTransactions.map((row) => row.transactionId),
      ...banking.outstandingBankItems.map((row) => row.transactionId)
    ];
    const bankCurrencies = bankTransactionIds.length
      ? await this.withTenant(
          context,
          async (tx) =>
            new Map(
              (
                await tx.bankImportedTransaction.findMany({
                  where: { organizationId: context.organizationId, id: { in: bankTransactionIds } },
                  select: { id: true, currency: true }
                })
              ).map((row) => [row.id, row.currency.trim()])
            )
        )
      : new Map<string, string>();
    const items: AttentionItem[] = [];
    for (const invoice of receivables.invoices) {
      if (invoice.bucket !== "current" && BigInt(invoice.outstandingMinor) > 0n) {
        items.push({
          kind: "overdue-invoice",
          title: "Overdue invoice",
          dueDate: invoice.dueDate,
          amountMinor: invoice.outstandingMinor,
          currency: baseCurrency,
          workspaceId: "sales",
          targetId: invoice.invoiceId
        });
      }
    }
    for (const bill of payables.bills) {
      if (BigInt(bill.outstandingMinor) > 0n && parseDate(bill.dueDate, "dueDate") <= sevenDays) {
        items.push({
          kind: "bill-due",
          title: "Bill due soon",
          dueDate: bill.dueDate,
          amountMinor: bill.outstandingMinor,
          currency: baseCurrency,
          workspaceId: "purchases",
          targetId: bill.billId
        });
      }
    }
    for (const row of banking.unmatchedTransactions) {
      items.push({
        kind: "uncategorized-bank-transaction",
        title: "Bank transaction to review",
        dueDate: row.postingDate,
        amountMinor: row.amountMinor,
        currency: bankCurrencies.get(row.transactionId) ?? baseCurrency,
        workspaceId: "banking",
        targetId: row.transactionId
      });
    }
    for (const row of banking.outstandingBankItems) {
      items.push({
        kind: "unreconciled-bank-transaction",
        title: "Bank transaction unreconciled",
        dueDate: row.postingDate,
        amountMinor: row.amountMinor,
        currency: bankCurrencies.get(row.transactionId) ?? baseCurrency,
        workspaceId: "banking",
        targetId: row.transactionId
      });
    }
    if (hasPermission(context.role, "payroll:read")) {
      const remittances = await this.withTenant(context, (tx) =>
        tx.payrollRemittance.findMany({
          where: {
            organizationId: context.organizationId,
            status: "OPEN",
            dueDate: { lte: sevenDays }
          },
          orderBy: [{ dueDate: "asc" }, { id: "asc" }],
          take: 100,
          select: { id: true, dueDate: true, amountMinor: true, authorityCode: true }
        })
      );
      for (const row of remittances) {
        items.push({
          kind: "payroll-remittance-due",
          title: `Payroll remittance due (${row.authorityCode})`,
          dueDate: dateOnly(row.dueDate),
          amountMinor: row.amountMinor.toString(),
          currency: baseCurrency,
          workspaceId: "taxes",
          targetId: row.id
        });
      }
    }
    const connectorFailures = await this.withTenant(context, (tx) =>
      tx.connectorInstallation.findMany({
        where: {
          organizationId: context.organizationId,
          OR: [
            { status: "ERROR" },
            { status: "READY", healthStatus: { in: ["DEGRADED", "FAILED"] } }
          ]
        },
        orderBy: [{ lastHealthAt: "asc" }, { id: "asc" }],
        take: 100,
        select: { id: true, displayName: true, healthStatus: true, lastHealthAt: true }
      })
    );
    for (const connector of connectorFailures) {
      items.push({
        kind: "failed-sync",
        title: `Connector needs attention (${connector.displayName})`,
        dueDate: connector.lastHealthAt ? dateOnly(connector.lastHealthAt) : asOf,
        amountMinor: "0",
        currency: baseCurrency,
        workspaceId: "integrations",
        targetId: connector.id
      });
    }
    items.sort((left, right) => {
      const dueDateOrder = left.dueDate.localeCompare(right.dueDate);
      if (dueDateOrder !== 0) return dueDateOrder;
      const amountOrder = BigInt(right.amountMinor) - BigInt(left.amountMinor);
      return amountOrder === 0n
        ? left.targetId.localeCompare(right.targetId)
        : amountOrder > 0n
          ? 1
          : -1;
    });
    return { asOf, items: items.slice(0, 5) };
  }

  public async landing(context: OrganizationContext, module: string, asOf: string) {
    await this.authorization.assert(context, "dashboard:read", "Dashboard");
    const date = parseDate(asOf, "asOf");
    const month = monthRange(date);
    const range30 = daysRange(date, 29);
    switch (module) {
      case "sales": {
        const [sales, receivables] = await Promise.all([
          this.reports.profitAndLoss(context, { ...range30, basis: "ACCRUAL" }),
          this.reports.receivables(context, asOf)
        ]);
        const [estimateStages, invoiceStages, averageDaysToPay, paid30dBaseMinor] =
          await this.withTenant(context, async (tx) =>
            Promise.all([
              tx.estimate.groupBy({
                by: ["status"],
                where: { organizationId: context.organizationId, issueDate: { lte: date } },
                _count: { _all: true }
              }),
              tx.invoice.groupBy({
                by: ["status"],
                where: { organizationId: context.organizationId, issueDate: { lte: date } },
                _count: { _all: true }
              }),
              tx.$queryRaw<{ averageDays: number | null }[]>`
                SELECT CASE WHEN COUNT(*) = 0 THEN NULL
                  ELSE ROUND(AVG(GREATEST(0, settled."paidAt"::date - settled."issueDate")))::int
                  END AS "averageDays"
                FROM (
                  SELECT i."id", i."issueDate", MAX(p."paymentDate") AS "paidAt"
                  FROM "Invoice" i
                  JOIN "PaymentAllocation" pa
                    ON pa."organizationId" = i."organizationId" AND pa."invoiceId" = i."id"
                  JOIN "Payment" p
                    ON p."organizationId" = pa."organizationId" AND p."id" = pa."paymentId"
                  WHERE i."organizationId" = ${context.organizationId}::uuid
                    AND i."status" = 'PAID'
                    AND i."issueDate" <= ${date}
                    AND p."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'DISPUTED')
                    AND p."paymentDate" <= ${date}
                  GROUP BY i."id", i."issueDate", i."baseGrandTotalMinor"
                  HAVING SUM(pa."carryingBaseRelievedMinor") >= i."baseGrandTotalMinor"
                ) settled
              `.then((rows) => rows[0]?.averageDays ?? null),
              tx.paymentAllocation
                .aggregate({
                  where: {
                    organizationId: context.organizationId,
                    payment: {
                      organizationId: context.organizationId,
                      status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"] },
                      paymentDate: { gte: parseDate(range30.from, "from"), lte: endOfDate(asOf) }
                    }
                  },
                  _sum: { carryingBaseRelievedMinor: true }
                })
                .then((result) => result._sum.carryingBaseRelievedMinor ?? 0n)
            ])
          );
        const overdue = receivables.invoices.filter(
          (row) => row.bucket !== "current" && BigInt(row.outstandingMinor) > 0n
        );
        return {
          module,
          asOf,
          currency: sales.currency,
          kpis: {
            outstandingMinor: receivables.subledgerBalanceMinor,
            overdueMinor: sumMinor(overdue.map((row) => row.outstandingMinor)),
            paid30dMinor: paid30dBaseMinor.toString(),
            averageDaysToPay: averageDaysToPay === null ? null : String(averageDaysToPay),
            netSales30dMinor: sales.totalRevenueMinor
          },
          pipeline: {
            estimates: Object.fromEntries(
              estimateStages.map((row) => [row.status.toLowerCase(), row._count._all])
            ),
            invoices: Object.fromEntries(
              invoiceStages.map((row) => [row.status.toLowerCase(), row._count._all])
            ),
            overdue: overdue.length
          }
        };
      }
      case "expenses": {
        const [expenses, payables, receiptsToReview] = await Promise.all([
          this.reports.profitAndLoss(context, { ...range30, basis: "ACCRUAL" }),
          this.reports.payables(context, asOf),
          this.withTenant(context, (tx) =>
            tx.captureReview.count({
              where: { organizationId: context.organizationId, status: "REVIEW_REQUIRED" }
            })
          )
        ]);
        const due = payables.bills.filter((row) => {
          const dateDue = parseDate(row.dueDate, "dueDate");
          return (
            BigInt(row.outstandingMinor) > 0n && dateDue >= date && dateDue <= addDays(date, 7)
          );
        });
        const overdue = payables.bills.filter(
          (row) => BigInt(row.outstandingMinor) > 0n && parseDate(row.dueDate, "dueDate") < date
        );
        return {
          module,
          asOf,
          currency: expenses.currency,
          kpis: {
            billsDue7dMinor: sumMinor(due.map((row) => row.outstandingMinor)),
            overdueBillsMinor: sumMinor(overdue.map((row) => row.outstandingMinor)),
            spent30dMinor: expenses.totalExpenseMinor,
            receiptsToReview: String(receiptsToReview)
          },
          pipeline: { due: due.length, overdue: overdue.length }
        };
      }
      case "banking": {
        const banking = await this.reports.bankingReport(context, { ...month, asOf });
        const [currency, lastImport] = await Promise.all([
          this.organizationCurrency(context),
          this.withTenant(context, (tx) =>
            tx.bankImportBatch.findFirst({
              where: {
                organizationId: context.organizationId,
                createdAt: { lte: endOfDate(asOf) }
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              select: { createdAt: true }
            })
          )
        ]);
        return {
          module,
          asOf,
          currency,
          kpis: {
            cashMinor: sumMinor(banking.accountBalances.map((row) => row.balanceMinor)),
            toReview: String(banking.unmatchedCount),
            unreconciled: String(banking.unreconciledAccountActivity.length),
            lastImportAt: lastImport ? lastImport.createdAt.toISOString() : null
          },
          pipeline: {
            toReview: banking.unmatchedCount,
            unreconciled: banking.unreconciledAccountActivity.length
          }
        };
      }
      case "contacts": {
        const [receivables, payables, counts, currency] = await Promise.all([
          this.reports.receivables(context, asOf),
          this.reports.payables(context, asOf),
          this.withTenant(context, async (tx) => {
            const [customers, vendors] = await Promise.all([
              tx.customer.count({
                where: {
                  organizationId: context.organizationId,
                  createdAt: { gte: parseDate(month.from, "from"), lte: endOfDate(month.to) }
                }
              }),
              tx.vendor.count({
                where: {
                  organizationId: context.organizationId,
                  createdAt: { gte: parseDate(month.from, "from"), lte: endOfDate(month.to) }
                }
              })
            ]);
            return { customers, vendors };
          }),
          this.organizationCurrency(context)
        ]);
        return {
          module,
          asOf,
          currency,
          kpis: {
            customersOwingMinor: receivables.subledgerBalanceMinor,
            vendorsOwedMinor: payables.subledgerBalanceMinor,
            newCustomersThisMonth: String(counts.customers),
            newVendorsThisMonth: String(counts.vendors)
          },
          pipeline: {
            customers: receivables.customerBalances.length,
            vendors: payables.vendorBalances.length
          }
        };
      }
      case "taxes": {
        const [tax, currency] = await Promise.all([
          this.reports.taxReport(context, month),
          this.organizationCurrency(context)
        ]);
        const calendar = await this.taxCalendar(context, asOf);
        return {
          module,
          asOf,
          currency,
          kpis: { estimatedTaxPositionMinor: tax.netTaxPositionMinor },
          pipeline: { openRemittances: calendar.payrollRemittances.length },
          taxCalendar: calendar
        };
      }
      default:
        throw new AppError("UI_SUMMARY_MODULE_INVALID", "Unsupported UI summary module.", 400);
    }
  }

  public async taxCalendar(context: OrganizationContext, asOf: string) {
    await this.authorization.assert(context, "dashboard:read", "Dashboard");
    const from = parseDate(asOf, "asOf");
    const to = addDays(from, 90);
    const payrollRemittances = hasPermission(context.role, "payroll:read")
      ? await this.withTenant(context, (tx) =>
          tx.payrollRemittance.findMany({
            where: {
              organizationId: context.organizationId,
              status: "OPEN",
              dueDate: { gte: from, lte: to }
            },
            orderBy: [{ dueDate: "asc" }, { id: "asc" }],
            take: 100,
            select: { id: true, authorityCode: true, amountMinor: true, dueDate: true }
          })
        )
      : [];
    return {
      asOf,
      through: dateOnly(to),
      gstHstFilingDates: [],
      gstHstAvailability: "filing-frequency-not-configured",
      payrollAvailability: hasPermission(context.role, "payroll:read")
        ? "available"
        : "permission-denied",
      payrollRemittances: payrollRemittances.map((row) => ({
        id: row.id,
        authorityCode: row.authorityCode,
        amountMinor: row.amountMinor.toString(),
        dueDate: dateOnly(row.dueDate)
      }))
    };
  }

  private organizationCurrency(context: OrganizationContext): Promise<string> {
    return this.withTenant(context, async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { currency: true }
      });
      return organization.currency;
    });
  }

  private withTenant<T>(
    context: OrganizationContext,
    work: (tx: Prisma.TransactionClient) => Promise<T>
  ): Promise<T> {
    return withTenantTransaction(
      this.prisma,
      {
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        companyId: context.companyId
      },
      work,
      { timeout: 15_000 }
    );
  }
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + amount);
  return result;
}

function endOfDate(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function monthRange(date: Date): ReportRange {
  return {
    from: dateOnly(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))),
    to: dateOnly(date)
  };
}

function priorMonthToDate(date: Date): ReportRange {
  const previousMonthLast = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0));
  const day = Math.min(date.getUTCDate(), previousMonthLast.getUTCDate());
  const from = new Date(
    Date.UTC(previousMonthLast.getUTCFullYear(), previousMonthLast.getUTCMonth(), 1)
  );
  const to = new Date(
    Date.UTC(previousMonthLast.getUTCFullYear(), previousMonthLast.getUTCMonth(), day)
  );
  return { from: dateOnly(from), to: dateOnly(to) };
}

function monthOffsetRange(date: Date, offset: number): ReportRange {
  const from = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
  const lastDay = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 0));
  const to = offset === 0 ? date : lastDay;
  return { from: dateOnly(from), to: dateOnly(to) };
}

function daysRange(end: Date, daysBack: number): ReportRange {
  return { from: dateOnly(addDays(end, -daysBack)), to: dateOnly(end) };
}

function sumMinor(values: readonly string[]): string {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

function comparison(current: bigint, previous: bigint) {
  return {
    amountMinor: current.toString(),
    previousPeriodMinor: previous.toString(),
    changeMinor: (current - previous).toString()
  };
}

function positiveCashChange(rows: readonly { readonly cashChangeMinor: string }[]): bigint {
  return rows.reduce((sum, row) => {
    const amount = BigInt(row.cashChangeMinor);
    return amount > 0n ? sum + amount : sum;
  }, 0n);
}

function negativeCashChange(rows: readonly { readonly cashChangeMinor: string }[]): bigint {
  return rows.reduce((sum, row) => {
    const amount = BigInt(row.cashChangeMinor);
    return amount < 0n ? sum - amount : sum;
  }, 0n);
}
