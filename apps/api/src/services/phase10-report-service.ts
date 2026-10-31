import { roundRatioHalfUp } from "@clearledger/accounting-core";
import {
  Prisma,
  withTenantTransaction,
  type AccountType,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService, hasPermission } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";

type Tx = Prisma.TransactionClient;

export interface ReportRange {
  readonly from: string;
  readonly to: string;
}

export interface DetailPage extends ReportRange {
  readonly page: number;
  readonly pageSize: number;
}

export type CustomerStatementType = "OPEN_ITEM" | "ACTIVITY";

const postedInvoiceStatuses = [
  "POSTED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "PARTIALLY_CREDITED",
  "CREDITED"
] as const;
const postedBillStatuses = [
  "POSTED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "PARTIALLY_CREDITED",
  "CREDITED"
] as const;
const settledPaymentStatuses = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "DISPUTED"] as const;
const maximumDetailRows = 5_000;

export class Phase10ReportService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async profitAndLoss(
    context: OrganizationContext,
    input: ReportRange & { basis: "ACCRUAL" | "CASH" }
  ) {
    await this.authorization.assert(context, "reports:read", "ProfitAndLoss");
    const range = reportRange(input);
    return withReportTransaction(this.prisma, context, async (tx) => {
      const organization = await reportOrganization(tx, context.organizationId);
      const rows =
        input.basis === "ACCRUAL"
          ? await accrualProfitAndLossRows(tx, context.organizationId, range)
          : await cashProfitAndLossRows(tx, context.organizationId, range);
      const revenue = rows
        .filter((row) => row.section === "REVENUE")
        .reduce((total, row) => total + row.amountMinor, 0n);
      const expenses = rows
        .filter((row) => row.section === "EXPENSE")
        .reduce((total, row) => total + row.amountMinor, 0n);
      return {
        basis: input.basis,
        from: dateOnly(range.from),
        to: dateOnly(range.to),
        currency: organization.currency,
        totalRevenueMinor: revenue.toString(),
        totalExpenseMinor: expenses.toString(),
        netIncomeMinor: (revenue - expenses).toString(),
        support:
          input.basis === "CASH"
            ? "Settled invoice allocations, bill-payment allocations, and immediate expenses."
            : "All posted journal lines in the selected effective-date range.",
        rows: rows.map((row) => ({
          ...row,
          amountMinor: row.amountMinor.toString(),
          drillDownUrl: generalLedgerUrl(row.accountId, range)
        }))
      };
    });
  }

  public async balanceSheet(context: OrganizationContext, asOf: string) {
    await this.authorization.assert(context, "reports:read", "BalanceSheet");
    const asOfDate = parseDate(asOf, "asOf");
    return withReportTransaction(this.prisma, context, async (tx) => {
      const organization = await reportOrganization(tx, context.organizationId);
      const accounts = await tx.account.findMany({
        where: { organizationId: context.organizationId },
        orderBy: [{ code: "asc" }, { id: "asc" }]
      });
      const lines = await tx.journalLine.groupBy({
        by: ["accountId"],
        where: {
          organizationId: context.organizationId,
          journal: { status: "POSTED", effectiveDate: { lte: asOfDate } }
        },
        _sum: { debitMinor: true, creditMinor: true }
      });
      const totals = new Map(
        lines.map((line) => [
          line.accountId,
          { debit: line._sum.debitMinor ?? 0n, credit: line._sum.creditMinor ?? 0n }
        ])
      );
      const rows = accounts
        .filter((account) =>
          ["ASSET", "CONTRA_ASSET", "LIABILITY", "EQUITY"].includes(account.type)
        )
        .map((account) => {
          const total = totals.get(account.id) ?? { debit: 0n, credit: 0n };
          const amountMinor =
            account.type === "ASSET" || account.type === "CONTRA_ASSET"
              ? total.debit - total.credit
              : total.credit - total.debit;
          return {
            accountId: account.id,
            code: account.code,
            name: account.name,
            section:
              account.type === "ASSET" || account.type === "CONTRA_ASSET"
                ? ("ASSET" as const)
                : account.type,
            amountMinor,
            drillDownUrl: generalLedgerUrl(account.id, {
              from: new Date("0001-01-01T00:00:00.000Z"),
              to: asOfDate
            })
          };
        });
      const incomeAccounts = accounts.filter((account) =>
        ["REVENUE", "CONTRA_REVENUE", "EXPENSE"].includes(account.type)
      );
      const currentEarnings = incomeAccounts.reduce((total, account) => {
        const amount = totals.get(account.id) ?? { debit: 0n, credit: 0n };
        return account.type === "EXPENSE"
          ? total - (amount.debit - amount.credit)
          : total + (amount.credit - amount.debit);
      }, 0n);
      const assets = rows
        .filter((row) => row.section === "ASSET")
        .reduce((total, row) => total + row.amountMinor, 0n);
      const liabilities = rows
        .filter((row) => row.section === "LIABILITY")
        .reduce((total, row) => total + row.amountMinor, 0n);
      const equity =
        rows
          .filter((row) => row.section === "EQUITY")
          .reduce((total, row) => total + row.amountMinor, 0n) + currentEarnings;
      const difference = assets - liabilities - equity;
      return {
        asOf: dateOnly(asOfDate),
        currency: organization.currency,
        totalAssetsMinor: assets.toString(),
        totalLiabilitiesMinor: liabilities.toString(),
        totalEquityMinor: equity.toString(),
        currentEarningsMinor: currentEarnings.toString(),
        differenceMinor: difference.toString(),
        isBalanced: difference === 0n,
        rows: rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() }))
      };
    });
  }

  public async journalReport(context: OrganizationContext, input: DetailPage) {
    await this.authorization.assert(context, "reports:read", "JournalReport");
    const range = reportRange(input);
    const pagination = boundedPage(input.page, input.pageSize);
    return withReportTransaction(this.prisma, context, async (tx) => {
      const where: Prisma.JournalWhereInput = {
        organizationId: context.organizationId,
        status: "POSTED",
        effectiveDate: { gte: range.from, lte: range.to }
      };
      const [total, journals] = await Promise.all([
        tx.journal.count({ where }),
        tx.journal.findMany({
          where,
          include: { lines: { include: { account: true }, orderBy: { lineNumber: "asc" } } },
          orderBy: [{ effectiveDate: "asc" }, { id: "asc" }],
          skip: pagination.skip,
          take: pagination.pageSize
        })
      ]);
      return {
        from: dateOnly(range.from),
        to: dateOnly(range.to),
        ...pageMetadata(total, input.page, pagination.pageSize),
        journals: journals.map((journal) => ({
          id: journal.id,
          effectiveDate: serializeDate(journal.effectiveDate),
          description: journal.description,
          sourceType: journal.sourceType,
          sourceId: journal.sourceId,
          reversedJournalId: journal.reversedJournalId,
          lines: journal.lines.map((line) => ({
            id: line.id,
            accountId: line.accountId,
            accountCode: line.account.code,
            accountName: line.account.name,
            description: line.description,
            debitMinor: line.debitMinor.toString(),
            creditMinor: line.creditMinor.toString()
          }))
        }))
      };
    });
  }

  public async cashFlow(context: OrganizationContext, input: ReportRange) {
    await this.authorization.assert(context, "reports:read", "CashFlow");
    const range = reportRange(input);
    return withReportTransaction(this.prisma, context, async (tx) => {
      const cashAccountIds = await cashAccounts(tx, context.organizationId);
      const journals = await tx.journal.findMany({
        where: {
          organizationId: context.organizationId,
          status: "POSTED",
          effectiveDate: { gte: range.from, lte: range.to },
          lines: { some: { accountId: { in: cashAccountIds } } }
        },
        include: { lines: { include: { account: true } } },
        orderBy: [{ effectiveDate: "asc" }, { id: "asc" }],
        take: maximumDetailRows
      });
      const detail = journals.map((journal) => {
        const cashChange = journal.lines
          .filter((line) => cashAccountIds.includes(line.accountId))
          .reduce((sum, line) => sum + line.debitMinor - line.creditMinor, 0n);
        const nonCash = journal.lines.filter((line) => !cashAccountIds.includes(line.accountId));
        const category =
          nonCash.length === 0
            ? "TRANSFER"
            : nonCash.some((line) => ["EQUITY", "LIABILITY"].includes(line.account.type))
              ? "FINANCING"
              : nonCash.some((line) => ["ASSET", "CONTRA_ASSET"].includes(line.account.type))
                ? "INVESTING"
                : "OPERATING";
        return {
          journalId: journal.id,
          effectiveDate: serializeDate(journal.effectiveDate),
          description: journal.description,
          sourceType: journal.sourceType,
          category,
          cashChangeMinor: cashChange
        };
      });
      const categoryTotal = (category: string) =>
        detail
          .filter((row) => row.category === category)
          .reduce((sum, row) => sum + row.cashChangeMinor, 0n);
      return {
        from: dateOnly(range.from),
        to: dateOnly(range.to),
        operatingMinor: categoryTotal("OPERATING").toString(),
        investingMinor: categoryTotal("INVESTING").toString(),
        financingMinor: categoryTotal("FINANCING").toString(),
        internalTransfersMinor: categoryTotal("TRANSFER").toString(),
        netCashChangeMinor: detail.reduce((sum, row) => sum + row.cashChangeMinor, 0n).toString(),
        detail: detail.map((row) => ({ ...row, cashChangeMinor: row.cashChangeMinor.toString() }))
      };
    });
  }

  public async receivables(context: OrganizationContext, asOf: string) {
    await this.authorization.assert(context, "receivables:read", "ReceivablesReport");
    const asOfDate = parseDate(asOf, "asOf");
    return withReportTransaction(this.prisma, context, async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { currency: true }
      });
      const baseCurrency = organization.currency.trim();
      const invoices = await tx.invoice.findMany({
        where: {
          organizationId: context.organizationId,
          issueDate: { lte: asOfDate },
          status: { in: [...postedInvoiceStatuses] }
        },
        include: {
          customer: true,
          creditNotes: {
            where: { status: "POSTED", issueDate: { lte: asOfDate } },
            select: { id: true, issueDate: true, grandTotalMinor: true }
          },
          paymentAllocations: {
            where: {
              payment: {
                status: { in: [...settledPaymentStatuses] },
                paymentDate: { lte: asOfDate }
              }
            },
            include: { payment: true }
          }
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }]
      });
      const foreignCarryingByInvoice = await monetaryCarryingBySource(
        tx,
        context.organizationId,
        "ACCOUNTS_RECEIVABLE",
        "invoice",
        asOfDate
      );
      const detail = invoices.map((invoice) => {
        const foreign = invoice.currency.trim() !== baseCurrency;
        const credits = invoice.creditNotes.reduce(
          (sum, credit) => sum + credit.grandTotalMinor,
          0n
        );
        const payments = invoice.paymentAllocations.reduce(
          (sum, allocation) =>
            sum + (foreign ? allocation.carryingBaseRelievedMinor : allocation.amountMinor),
          0n
        );
        const original = foreign ? invoice.baseGrandTotalMinor : invoice.grandTotalMinor;
        const baseCredits = foreign ? 0n : credits;
        const contractualOutstanding = max(0n, original - baseCredits - payments);
        const outstanding = foreign
          ? max(0n, foreignCarryingByInvoice.get(invoice.id) ?? contractualOutstanding)
          : contractualOutstanding;
        const bucket = agingBucket(asOfDate, invoice.dueDate);
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: invoice.customer.displayName,
          issueDate: dateOnly(invoice.issueDate),
          dueDate: dateOnly(invoice.dueDate),
          status: invoice.status,
          currency: invoice.currency.trim(),
          originalMinor: original,
          creditedMinor: baseCredits,
          paidMinor: payments,
          outstandingMinor: outstanding,
          unrealizedFxMinor: outstanding - contractualOutstanding,
          bucket
        };
      });
      const open = detail.filter((row) => row.outstandingMinor !== 0n);
      const buckets = bucketTotals(open);
      const customerMap = new Map<
        string,
        { customerId: string; customerName: string; balanceMinor: bigint }
      >();
      for (const row of open) {
        const current = customerMap.get(row.customerId) ?? {
          customerId: row.customerId,
          customerName: row.customerName,
          balanceMinor: 0n
        };
        current.balanceMinor += row.outstandingMinor;
        customerMap.set(row.customerId, current);
      }
      const unappliedPayments = await tx.payment.findMany({
        where: {
          organizationId: context.organizationId,
          paymentDate: { lte: asOfDate },
          status: { in: [...settledPaymentStatuses] },
          unappliedMinor: { gt: 0n }
        },
        include: { customer: true },
        orderBy: [{ paymentDate: "asc" }, { id: "asc" }]
      });
      const paymentHistory = await tx.payment.findMany({
        where: {
          organizationId: context.organizationId,
          paymentDate: { lte: asOfDate },
          status: { in: [...settledPaymentStatuses] }
        },
        include: { customer: true, allocations: true },
        orderBy: [{ paymentDate: "desc" }, { id: "asc" }],
        take: maximumDetailRows
      });
      const control = await controlBalance(
        tx,
        context.organizationId,
        "accounts-receivable",
        asOfDate
      );
      const subledger = open.reduce((sum, row) => sum + row.outstandingMinor, 0n);
      return {
        asOf: dateOnly(asOfDate),
        aging: stringifyBigInts(buckets),
        subledgerBalanceMinor: subledger.toString(),
        controlBalanceMinor: control.toString(),
        differenceMinor: (control - subledger).toString(),
        isReconciled: control === subledger,
        customerBalances: [...customerMap.values()].map(stringifyBigInts),
        invoices: detail.map(stringifyBigInts),
        unappliedCustomerCredits: unappliedPayments.map((payment) => ({
          paymentId: payment.id,
          customerId: payment.customerId,
          customerName: payment.customer.displayName,
          paymentDate: dateOnly(payment.paymentDate),
          amountMinor: payment.unappliedMinor.toString()
        })),
        paymentHistory: paymentHistory.map((payment) => ({
          paymentId: payment.id,
          customerId: payment.customerId,
          customerName: payment.customer.displayName,
          paymentDate: dateOnly(payment.paymentDate),
          status: payment.status,
          amountMinor: payment.amountMinor.toString(),
          allocatedMinor: payment.allocations
            .reduce((sum, allocation) => sum + allocation.amountMinor, 0n)
            .toString(),
          unappliedMinor: payment.unappliedMinor.toString(),
          reference: payment.reference
        }))
      };
    });
  }

  public async customerStatement(
    context: OrganizationContext,
    customerId: string,
    input: ReportRange & { readonly type?: CustomerStatementType | undefined }
  ) {
    await this.authorization.assert(context, "receivables:read", "CustomerStatement", customerId);
    const range = reportRange(input);
    return withReportTransaction(this.prisma, context, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, organizationId: context.organizationId }
      });
      if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
      const [organization, invoices, credits, payments] = await Promise.all([
        tx.organization.findUniqueOrThrow({
          where: { id: context.organizationId },
          select: { currency: true }
        }),
        tx.invoice.findMany({
          where: {
            organizationId: context.organizationId,
            customerId,
            status: { in: [...postedInvoiceStatuses] },
            issueDate: { lte: range.to }
          }
        }),
        tx.creditNote.findMany({
          where: {
            organizationId: context.organizationId,
            invoice: { customerId },
            status: "POSTED",
            issueDate: { lte: range.to }
          }
        }),
        tx.payment.findMany({
          where: {
            organizationId: context.organizationId,
            customerId,
            status: { in: [...settledPaymentStatuses] },
            paymentDate: { lte: range.to }
          },
          include: { allocations: { include: { invoice: { select: { customerId: true } } } } }
        })
      ]);
      const activityEntries = [
        ...invoices.map((invoice) => ({
          date: invoice.issueDate,
          type: "INVOICE",
          sourceId: invoice.id,
          reference: invoice.invoiceNumber,
          chargeMinor: invoice.grandTotalMinor,
          creditMinor: 0n
        })),
        ...credits.map((credit) => ({
          date: credit.issueDate,
          type: "CREDIT_NOTE",
          sourceId: credit.id,
          reference: credit.creditNoteNumber,
          chargeMinor: 0n,
          creditMinor: credit.grandTotalMinor
        })),
        ...payments.map((payment) => ({
          date: payment.paymentDate,
          type: "PAYMENT",
          sourceId: payment.id,
          reference: payment.reference,
          chargeMinor: 0n,
          creditMinor: payment.allocations
            .filter((allocation) => allocation.invoice.customerId === customerId)
            .reduce((sum, allocation) => sum + allocation.amountMinor, 0n)
        }))
      ].sort((left, right) => left.date.getTime() - right.date.getTime());
      const statementType = input.type ?? "ACTIVITY";
      const openingBalance = activityEntries
        .filter((entry) => entry.date < range.from)
        .reduce((sum, entry) => sum + entry.chargeMinor - entry.creditMinor, 0n);
      const activity = activityEntries.filter(
        (entry) => entry.date >= range.from && entry.date <= range.to
      );
      const openItems = invoices
        .map((invoice) => {
          const credited = credits
            .filter((credit) => credit.invoiceId === invoice.id)
            .reduce((sum, credit) => sum + credit.grandTotalMinor, 0n);
          const paid = invoice.amountPaidMinor;
          return {
            date: invoice.dueDate,
            type: "OPEN_INVOICE",
            sourceId: invoice.id,
            reference: invoice.invoiceNumber,
            chargeMinor: max(0n, invoice.grandTotalMinor - credited - paid),
            creditMinor: 0n
          };
        })
        .filter((entry) => entry.chargeMinor > 0n)
        .sort((left, right) => left.date.getTime() - right.date.getTime());
      const entries = statementType === "OPEN_ITEM" ? openItems : activity;
      let balance = statementType === "OPEN_ITEM" ? 0n : openingBalance;
      return {
        customerId,
        customerNumber: customer.customerNumber,
        customerName: customer.displayName,
        currency: organization.currency,
        from: dateOnly(range.from),
        to: dateOnly(range.to),
        statementType,
        openingBalanceMinor: openingBalance.toString(),
        entries: entries.map((entry) => {
          balance += entry.chargeMinor - entry.creditMinor;
          return {
            ...entry,
            date: dateOnly(entry.date),
            chargeMinor: entry.chargeMinor.toString(),
            creditMinor: entry.creditMinor.toString(),
            runningBalanceMinor: balance.toString()
          };
        }),
        closingActivityBalanceMinor: balance.toString(),
        closingBalanceMinor:
          statementType === "OPEN_ITEM"
            ? openItems.reduce((sum, entry) => sum + entry.chargeMinor, 0n).toString()
            : balance.toString()
      };
    });
  }

  public async payables(context: OrganizationContext, asOf: string) {
    await this.authorization.assert(context, "payables:read", "PayablesReport");
    const asOfDate = parseDate(asOf, "asOf");
    return withReportTransaction(this.prisma, context, async (tx) => {
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { currency: true }
      });
      const baseCurrency = organization.currency.trim();
      const bills = await tx.bill.findMany({
        where: {
          organizationId: context.organizationId,
          issueDate: { lte: asOfDate },
          status: { in: [...postedBillStatuses] }
        },
        include: {
          vendor: true,
          paymentAllocations: {
            where: {
              billPayment: { paymentDate: { lte: asOfDate }, reversedJournalId: null }
            },
            include: { billPayment: true }
          },
          creditApplications: {
            where: {
              appliedAt: { lte: asOfDate },
              vendorCredit: { status: { in: ["POSTED", "APPLIED"] } }
            },
            include: { vendorCredit: true }
          }
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }]
      });
      const foreignCarryingByBill = await monetaryCarryingBySource(
        tx,
        context.organizationId,
        "ACCOUNTS_PAYABLE",
        "bill",
        asOfDate
      );
      const detail = bills.map((bill) => {
        const foreign = bill.currency.trim() !== baseCurrency;
        const payments = bill.paymentAllocations.reduce(
          (sum, allocation) =>
            sum + (foreign ? allocation.carryingBaseRelievedMinor : allocation.amountMinor),
          0n
        );
        const credits = bill.creditApplications.reduce(
          (sum, application) => sum + application.amountMinor,
          0n
        );
        const original = foreign ? bill.baseGrandTotalMinor : bill.grandTotalMinor;
        const baseCredits = foreign ? 0n : credits;
        const contractualOutstanding = max(0n, original - payments - baseCredits);
        const outstanding = foreign
          ? max(0n, foreignCarryingByBill.get(bill.id) ?? contractualOutstanding)
          : contractualOutstanding;
        return {
          billId: bill.id,
          vendorInvoiceNumber: bill.vendorInvoiceNumber,
          vendorId: bill.vendorId,
          vendorName: bill.vendor.displayName,
          issueDate: dateOnly(bill.issueDate),
          dueDate: dateOnly(bill.dueDate),
          status: bill.status,
          currency: bill.currency.trim(),
          originalMinor: original,
          creditedMinor: baseCredits,
          paidMinor: payments,
          outstandingMinor: outstanding,
          unrealizedFxMinor: outstanding - contractualOutstanding,
          bucket: agingBucket(asOfDate, bill.dueDate)
        };
      });
      const open = detail.filter((row) => row.outstandingMinor !== 0n);
      const vendorMap = new Map<
        string,
        { vendorId: string; vendorName: string; balanceMinor: bigint }
      >();
      for (const row of open) {
        const current = vendorMap.get(row.vendorId) ?? {
          vendorId: row.vendorId,
          vendorName: row.vendorName,
          balanceMinor: 0n
        };
        current.balanceMinor += row.outstandingMinor;
        vendorMap.set(row.vendorId, current);
      }
      const unappliedCredits = await tx.vendorCredit.findMany({
        where: {
          organizationId: context.organizationId,
          currency: baseCurrency,
          issueDate: { lte: asOfDate },
          status: { in: ["POSTED", "APPLIED"] }
        },
        include: { vendor: true, applications: { where: { appliedAt: { lte: asOfDate } } } },
        orderBy: [{ issueDate: "asc" }, { id: "asc" }]
      });
      const availableCredits = unappliedCredits
        .map((credit) => ({
          vendorCreditId: credit.id,
          vendorId: credit.vendorId,
          vendorName: credit.vendor.displayName,
          issueDate: dateOnly(credit.issueDate),
          availableMinor:
            credit.grandTotalMinor -
            credit.applications.reduce((sum, application) => sum + application.amountMinor, 0n)
        }))
        .filter((credit) => credit.availableMinor > 0n);
      const paymentHistory = await tx.billPayment.findMany({
        where: {
          organizationId: context.organizationId,
          paymentDate: { lte: asOfDate },
          reversedJournalId: null
        },
        include: { vendor: true, allocations: true },
        orderBy: [{ paymentDate: "desc" }, { id: "asc" }],
        take: maximumDetailRows
      });
      const control = await controlBalance(
        tx,
        context.organizationId,
        "accounts-payable",
        asOfDate
      );
      const subledger =
        open.reduce((sum, row) => sum + row.outstandingMinor, 0n) -
        availableCredits.reduce((sum, credit) => sum + credit.availableMinor, 0n);
      for (const credit of availableCredits) {
        const current = vendorMap.get(credit.vendorId) ?? {
          vendorId: credit.vendorId,
          vendorName: credit.vendorName,
          balanceMinor: 0n
        };
        current.balanceMinor -= credit.availableMinor;
        vendorMap.set(credit.vendorId, current);
      }
      return {
        asOf: dateOnly(asOfDate),
        aging: stringifyBigInts(bucketTotals(open)),
        subledgerBalanceMinor: subledger.toString(),
        controlBalanceMinor: control.toString(),
        differenceMinor: (control - subledger).toString(),
        isReconciled: control === subledger,
        vendorBalances: [...vendorMap.values()].map(stringifyBigInts),
        bills: detail.map(stringifyBigInts),
        unappliedVendorCredits: availableCredits.map((credit) => ({
          ...credit,
          availableMinor: credit.availableMinor.toString()
        })),
        paymentHistory: paymentHistory.map((payment) => ({
          billPaymentId: payment.id,
          vendorId: payment.vendorId,
          vendorName: payment.vendor.displayName,
          paymentDate: dateOnly(payment.paymentDate),
          amountMinor: payment.amountMinor.toString(),
          allocatedMinor: payment.allocations
            .reduce((sum, allocation) => sum + allocation.amountMinor, 0n)
            .toString(),
          unappliedMinor: payment.unappliedMinor.toString(),
          reference: payment.reference
        }))
      };
    });
  }

  public async vendorStatement(context: OrganizationContext, vendorId: string, input: ReportRange) {
    await this.authorization.assert(context, "payables:read", "VendorStatement", vendorId);
    const range = reportRange(input);
    return withReportTransaction(this.prisma, context, async (tx) => {
      const vendor = await tx.vendor.findFirst({
        where: { id: vendorId, organizationId: context.organizationId }
      });
      if (!vendor) throw new AppError("VENDOR_NOT_FOUND", "Vendor was not found.", 404);
      const [bills, credits, payments] = await Promise.all([
        tx.bill.findMany({
          where: {
            organizationId: context.organizationId,
            vendorId,
            status: { in: [...postedBillStatuses] },
            issueDate: { gte: range.from, lte: range.to }
          }
        }),
        tx.vendorCredit.findMany({
          where: {
            organizationId: context.organizationId,
            vendorId,
            status: { in: ["POSTED", "APPLIED"] },
            issueDate: { gte: range.from, lte: range.to }
          }
        }),
        tx.billPayment.findMany({
          where: {
            organizationId: context.organizationId,
            vendorId,
            reversedJournalId: null,
            paymentDate: { gte: range.from, lte: range.to }
          }
        })
      ]);
      const entries = [
        ...bills.map((bill) => ({
          date: bill.issueDate,
          type: "BILL",
          sourceId: bill.id,
          reference: bill.vendorInvoiceNumber,
          chargeMinor: bill.grandTotalMinor,
          creditMinor: 0n
        })),
        ...credits.map((credit) => ({
          date: credit.issueDate,
          type: "VENDOR_CREDIT",
          sourceId: credit.id,
          reference: credit.vendorCreditNumber,
          chargeMinor: 0n,
          creditMinor: credit.grandTotalMinor
        })),
        ...payments.map((payment) => ({
          date: payment.paymentDate,
          type: "BILL_PAYMENT",
          sourceId: payment.id,
          reference: payment.reference,
          chargeMinor: 0n,
          creditMinor: payment.amountMinor
        }))
      ].sort((left, right) => left.date.getTime() - right.date.getTime());
      let balance = 0n;
      return {
        vendorId,
        vendorNumber: vendor.vendorNumber,
        vendorName: vendor.displayName,
        from: dateOnly(range.from),
        to: dateOnly(range.to),
        entries: entries.map((entry) => {
          balance += entry.chargeMinor - entry.creditMinor;
          return {
            ...entry,
            date: dateOnly(entry.date),
            chargeMinor: entry.chargeMinor.toString(),
            creditMinor: entry.creditMinor.toString(),
            runningBalanceMinor: balance.toString()
          };
        }),
        closingActivityBalanceMinor: balance.toString()
      };
    });
  }

  public async taxReport(context: OrganizationContext, input: ReportRange) {
    await this.authorization.assert(context, "tax-reports:read", "TaxReport");
    const range = reportRange(input);
    return withReportTransaction(this.prisma, context, async (tx) => {
      const [sales, salesCredits, purchases, purchaseCredits, immediateExpenses] =
        await Promise.all([
          tx.invoiceLine.findMany({
            where: {
              organizationId: context.organizationId,
              invoice: {
                status: { in: [...postedInvoiceStatuses] },
                issueDate: { gte: range.from, lte: range.to }
              }
            },
            include: { invoice: true, productItem: true },
            orderBy: [{ invoice: { issueDate: "asc" } }, { id: "asc" }],
            take: maximumDetailRows
          }),
          tx.creditNoteLine.findMany({
            where: {
              organizationId: context.organizationId,
              creditNote: { status: "POSTED", issueDate: { gte: range.from, lte: range.to } }
            },
            include: { creditNote: true, invoiceLine: true },
            orderBy: [{ creditNote: { issueDate: "asc" } }, { id: "asc" }],
            take: maximumDetailRows
          }),
          tx.billLine.findMany({
            where: {
              organizationId: context.organizationId,
              bill: {
                status: { in: [...postedBillStatuses] },
                issueDate: { gte: range.from, lte: range.to }
              }
            },
            include: { bill: true },
            orderBy: [{ bill: { issueDate: "asc" } }, { id: "asc" }],
            take: maximumDetailRows
          }),
          tx.vendorCreditLine.findMany({
            where: {
              organizationId: context.organizationId,
              vendorCredit: {
                status: { in: ["POSTED", "APPLIED"] },
                issueDate: { gte: range.from, lte: range.to }
              }
            },
            include: { vendorCredit: true },
            orderBy: [{ vendorCredit: { issueDate: "asc" } }, { id: "asc" }],
            take: maximumDetailRows
          }),
          tx.immediateExpenseLine.findMany({
            where: {
              organizationId: context.organizationId,
              immediateExpense: {
                reversedJournalId: null,
                expenseDate: { gte: range.from, lte: range.to }
              }
            },
            include: { immediateExpense: true },
            orderBy: [{ immediateExpense: { expenseDate: "asc" } }, { id: "asc" }],
            take: maximumDetailRows
          })
        ]);
      const detail: TaxDetailRow[] = [
        ...sales.map((line) =>
          taxDetail(
            "SALE",
            line.invoice.id,
            line.id,
            line.invoice.issueDate,
            line.netAmountMinor,
            line.taxTotalMinor,
            0n,
            0n,
            line.taxSnapshot
          )
        ),
        ...salesCredits.map((line) =>
          taxDetail(
            "SALES_CREDIT",
            line.creditNote.id,
            line.id,
            line.creditNote.issueDate,
            -line.netAmountMinor,
            -line.taxTotalMinor,
            0n,
            0n,
            line.taxSnapshot
          )
        ),
        ...purchases.map((line) =>
          taxDetail(
            "PURCHASE",
            line.bill.id,
            line.id,
            line.bill.issueDate,
            line.netAmountMinor,
            0n,
            line.recoverableTaxMinor,
            line.nonRecoverableTaxMinor,
            line.taxSnapshot
          )
        ),
        ...purchaseCredits.map((line) =>
          taxDetail(
            "PURCHASE_CREDIT",
            line.vendorCredit.id,
            line.id,
            line.vendorCredit.issueDate,
            -line.netAmountMinor,
            0n,
            -line.recoverableTaxMinor,
            -line.nonRecoverableTaxMinor,
            line.taxSnapshot
          )
        ),
        ...immediateExpenses.map((line) =>
          taxDetail(
            "IMMEDIATE_EXPENSE",
            line.immediateExpense.id,
            line.id,
            line.immediateExpense.expenseDate,
            line.netAmountMinor,
            0n,
            line.recoverableTaxMinor,
            line.nonRecoverableTaxMinor,
            line.taxSnapshot
          )
        )
      ];
      const collected = detail.reduce((sum, row) => sum + row.collectedMinor, 0n);
      const recoverable = detail.reduce((sum, row) => sum + row.recoverableMinor, 0n);
      const nonRecoverable = detail.reduce((sum, row) => sum + row.nonRecoverableMinor, 0n);
      const zeroRatedSales = detail
        .filter((row) => row.sourceType === "SALE" && row.treatment === "ZERO_RATED")
        .reduce((sum, row) => sum + row.netAmountMinor, 0n);
      const exemptSales = detail
        .filter((row) => row.sourceType === "SALE" && row.treatment === "EXEMPT")
        .reduce((sum, row) => sum + row.netAmountMinor, 0n);
      const payableControl = await controlPeriodActivity(
        tx,
        context.organizationId,
        "tax-payable",
        range
      );
      const recoverableControl = await controlPeriodActivity(
        tx,
        context.organizationId,
        "tax-recoverable",
        range
      );
      const jurisdictionGroups = taxJurisdictionGroups(detail);
      const groupAccountIds = [
        ...new Set(
          jurisdictionGroups
            .map((group) => group.payableAccountId)
            .filter((id): id is string => Boolean(id))
        )
      ];
      const groupAccounts = groupAccountIds.length
        ? await tx.account.findMany({
            where: { organizationId: context.organizationId, id: { in: groupAccountIds } },
            select: { id: true, code: true, name: true }
          })
        : [];
      const groupAccountById = new Map(groupAccounts.map((account) => [account.id, account]));
      const jurisdictions = [];
      for (const group of jurisdictionGroups) {
        const account = group.payableAccountId
          ? (groupAccountById.get(group.payableAccountId) ?? null)
          : null;
        // Reconcile each authority against the account its own component posts
        // to, rather than against the single `tax-payable` control. Only one
        // account may carry that system purpose, so the aggregate check below
        // can only ever speak for one authority.
        const accountActivity = account
          ? await accountPeriodActivity(tx, context.organizationId, account.id, range)
          : null;
        jurisdictions.push({
          jurisdiction: group.jurisdiction,
          payableAccountId: group.payableAccountId,
          payableAccountCode: account?.code ?? null,
          payableAccountName: account?.name ?? null,
          collectedMinor: group.collectedMinor.toString(),
          recoverableMinor: group.recoverableMinor.toString(),
          nonRecoverableMinor: group.nonRecoverableMinor.toString(),
          netTaxPositionMinor: (group.collectedMinor - group.recoverableMinor).toString(),
          accountBalanceMinor: accountActivity === null ? null : accountActivity.toString(),
          differenceMinor:
            accountActivity === null ? null : (accountActivity - group.collectedMinor).toString(),
          isReconciled: accountActivity === null ? null : accountActivity === group.collectedMinor
        });
      }

      return {
        from: dateOnly(range.from),
        to: dateOnly(range.to),
        jurisdictions,
        collectedMinor: collected.toString(),
        recoverableMinor: recoverable.toString(),
        nonRecoverableMinor: nonRecoverable.toString(),
        zeroRatedSalesMinor: zeroRatedSales.toString(),
        exemptSalesMinor: exemptSales.toString(),
        netTaxPositionMinor: (collected - recoverable).toString(),
        payableControlBalanceMinor: payableControl.toString(),
        recoverableControlBalanceMinor: recoverableControl.toString(),
        payableDifferenceMinor: (payableControl - collected).toString(),
        recoverableDifferenceMinor: (recoverableControl - recoverable).toString(),
        isReconciled: payableControl === collected && recoverableControl === recoverable,
        detail: detail.map((row) => ({
          ...row,
          eventDate: dateOnly(row.eventDate),
          netAmountMinor: row.netAmountMinor.toString(),
          collectedMinor: row.collectedMinor.toString(),
          recoverableMinor: row.recoverableMinor.toString(),
          nonRecoverableMinor: row.nonRecoverableMinor.toString()
        }))
      };
    });
  }

  public async bankingReport(context: OrganizationContext, input: ReportRange & { asOf: string }) {
    await this.authorization.assert(context, "bank-reports:read", "BankingReport");
    const range = reportRange(input);
    const asOfDate = parseDate(input.asOf, "asOf");
    return withReportTransaction(this.prisma, context, async (tx) => {
      const accounts = await tx.bankAccount.findMany({
        where: { organizationId: context.organizationId },
        include: { linkedLedgerAccount: true },
        orderBy: [{ displayName: "asc" }, { id: "asc" }]
      });
      const cashAccountIds = await cashAccounts(tx, context.organizationId);
      const ledgerAccounts = await tx.account.findMany({
        where: { organizationId: context.organizationId, id: { in: cashAccountIds } },
        orderBy: [{ code: "asc" }, { id: "asc" }]
      });
      const bankByLedgerAccount = new Map(
        accounts.map((account) => [account.linkedLedgerAccountId, account])
      );
      const balances = await Promise.all(
        ledgerAccounts.map(async (ledgerAccount) => {
          const account = bankByLedgerAccount.get(ledgerAccount.id);
          return {
            bankAccountId: account?.id ?? null,
            displayName: account?.displayName ?? ledgerAccount.name,
            accountKind: account?.accountKind ?? null,
            maskedAccountReference: account?.maskedAccountReference ?? null,
            linkedLedgerAccountId: ledgerAccount.id,
            balanceMinor: (
              await accountBalance(tx, context.organizationId, ledgerAccount.id, asOfDate)
            ).toString(),
            lastReconciledAt: account?.lastReconciledAt
              ? serializeDate(account.lastReconciledAt)
              : null
          };
        })
      );
      const [unmatched, unreconciled, transfers, reconciliations, clearingSettings] =
        await Promise.all([
          tx.bankImportedTransaction.findMany({
            where: {
              organizationId: context.organizationId,
              postingDate: { lte: asOfDate },
              status: "UNMATCHED"
            },
            include: { bankAccount: true },
            orderBy: [{ postingDate: "asc" }, { id: "asc" }],
            take: maximumDetailRows
          }),
          tx.bankImportedTransaction.findMany({
            where: {
              organizationId: context.organizationId,
              postingDate: { lte: asOfDate },
              reconciliationItems: { none: { active: true } }
            },
            include: { bankAccount: true },
            orderBy: [{ postingDate: "asc" }, { id: "asc" }],
            take: maximumDetailRows
          }),
          tx.bankTransfer.findMany({
            where: {
              organizationId: context.organizationId,
              transferDate: { gte: range.from, lte: range.to }
            },
            include: { sourceBankAccount: true, destinationBankAccount: true },
            orderBy: [{ transferDate: "asc" }, { id: "asc" }],
            take: maximumDetailRows
          }),
          tx.bankReconciliation.findMany({
            where: { organizationId: context.organizationId },
            include: { bankAccount: true },
            orderBy: [{ statementEndDate: "desc" }, { id: "asc" }],
            take: 500
          }),
          tx.paymentSettings.findUnique({ where: { organizationId: context.organizationId } })
        ]);
      const clearingBalance = clearingSettings
        ? await accountBalance(
            tx,
            context.organizationId,
            clearingSettings.clearingAccountId,
            asOfDate
          )
        : 0n;
      return {
        from: dateOnly(range.from),
        to: dateOnly(range.to),
        asOf: dateOnly(asOfDate),
        accountBalances: balances,
        unmatchedCount: unmatched.length,
        unmatchedTransactions: unmatched.map((row) => ({
          transactionId: row.id,
          bankAccountId: row.bankAccountId,
          bankAccountName: row.bankAccount.displayName,
          postingDate: dateOnly(row.postingDate),
          description: row.description,
          amountMinor: row.amountMinor.toString(),
          direction: row.direction,
          probableDuplicate: row.duplicateStatus === "PROBABLE"
        })),
        transfers: transfers.map((row) => ({
          transferId: row.id,
          transferDate: dateOnly(row.transferDate),
          sourceAccount: row.sourceBankAccount.displayName,
          destinationAccount: row.destinationBankAccount.displayName,
          amountMinor: row.amountMinor.toString(),
          journalId: row.journalId
        })),
        reconciliations: reconciliations.map((row) => ({
          reconciliationId: row.id,
          bankAccountId: row.bankAccountId,
          bankAccountName: row.bankAccount.displayName,
          statementStartDate: dateOnly(row.statementStartDate),
          statementEndDate: dateOnly(row.statementEndDate),
          status: row.status,
          differenceMinor: row.differenceMinor.toString(),
          completedAt: row.completedAt ? serializeDate(row.completedAt) : null
        })),
        paymentClearingAccountId: clearingSettings?.clearingAccountId ?? null,
        paymentClearingBalanceMinor: clearingBalance.toString(),
        unreconciledAccountActivity: unreconciled.map((row) => ({
          transactionId: row.id,
          bankAccountId: row.bankAccountId,
          bankAccountName: row.bankAccount.displayName,
          postingDate: dateOnly(row.postingDate),
          description: row.description,
          amountMinor: row.amountMinor.toString(),
          direction: row.direction,
          status: row.status
        })),
        outstandingBankItems: unreconciled
          .filter((row) => row.status !== "UNMATCHED")
          .map((row) => ({
            transactionId: row.id,
            bankAccountId: row.bankAccountId,
            postingDate: dateOnly(row.postingDate),
            amountMinor: row.amountMinor.toString(),
            direction: row.direction,
            status: row.status
          }))
      };
    });
  }

  public async salesReport(context: OrganizationContext, input: ReportRange) {
    await this.authorization.assert(context, "reports:read", "SalesReport");
    const range = reportRange(input);
    return withReportTransaction(this.prisma, context, async (tx) => {
      const [invoiceLines, creditLines, cogs] = await Promise.all([
        tx.invoiceLine.findMany({
          where: {
            organizationId: context.organizationId,
            invoice: {
              status: { in: [...postedInvoiceStatuses] },
              issueDate: { gte: range.from, lte: range.to }
            }
          },
          include: { invoice: { include: { customer: true } }, productItem: true },
          take: maximumDetailRows
        }),
        tx.creditNoteLine.findMany({
          where: {
            organizationId: context.organizationId,
            creditNote: { status: "POSTED", issueDate: { gte: range.from, lte: range.to } }
          },
          include: {
            creditNote: { include: { invoice: { include: { customer: true } } } },
            invoiceLine: { include: { productItem: true } }
          },
          take: maximumDetailRows
        }),
        tx.inventoryMovement.aggregate({
          where: {
            organizationId: context.organizationId,
            eventDate: { gte: range.from, lte: range.to },
            movementType: { in: ["SALE", "CUSTOMER_RETURN"] }
          },
          _sum: { totalValueMinor: true }
        })
      ]);
      const rows: SalesRow[] = [
        ...invoiceLines.map((line) => ({
          sourceType: "INVOICE",
          sourceId: line.invoiceId,
          lineId: line.id,
          eventDate: line.invoice.issueDate,
          customerId: line.invoice.customerId,
          customerName: line.invoice.customer.displayName,
          productItemId: line.productItemId,
          productName: line.productItem?.name ?? line.description,
          netSalesMinor: line.netAmountMinor,
          discountMinor: line.discountMinor,
          creditMinor: 0n
        })),
        ...creditLines.map((line) => ({
          sourceType: "CREDIT_NOTE",
          sourceId: line.creditNoteId,
          lineId: line.id,
          eventDate: line.creditNote.issueDate,
          customerId: line.creditNote.invoice.customerId,
          customerName: line.creditNote.invoice.customer.displayName,
          productItemId: line.invoiceLine.productItemId,
          productName: line.invoiceLine.productItem?.name ?? line.description,
          netSalesMinor: -line.netAmountMinor,
          discountMinor: 0n,
          creditMinor: line.netAmountMinor
        }))
      ];
      const netSales = rows.reduce((sum, row) => sum + row.netSalesMinor, 0n);
      const costOfGoods = -(cogs._sum.totalValueMinor ?? 0n);
      return {
        from: dateOnly(range.from),
        to: dateOnly(range.to),
        netSalesMinor: netSales.toString(),
        discountsMinor: rows.reduce((sum, row) => sum + row.discountMinor, 0n).toString(),
        creditsMinor: rows.reduce((sum, row) => sum + row.creditMinor, 0n).toString(),
        costOfGoodsMinor: costOfGoods.toString(),
        grossMarginMinor: (netSales - costOfGoods).toString(),
        byCustomer: groupedSales(rows, "customer"),
        byProduct: groupedSales(rows, "product"),
        byPeriod: groupedSales(rows, "period"),
        detail: rows.map((row) => ({
          ...row,
          eventDate: dateOnly(row.eventDate),
          netSalesMinor: row.netSalesMinor.toString(),
          discountMinor: row.discountMinor.toString(),
          creditMinor: row.creditMinor.toString()
        }))
      };
    });
  }

  public async expenseReport(context: OrganizationContext, input: ReportRange) {
    await this.authorization.assert(context, "reports:read", "ExpenseReport");
    const range = reportRange(input);
    return withReportTransaction(this.prisma, context, async (tx) => {
      const [billLines, immediateLines, settings] = await Promise.all([
        tx.billLine.findMany({
          where: {
            organizationId: context.organizationId,
            bill: {
              status: { in: [...postedBillStatuses] },
              issueDate: { gte: range.from, lte: range.to }
            },
            account: { type: "EXPENSE" }
          },
          include: { bill: { include: { vendor: true } }, account: true },
          take: maximumDetailRows
        }),
        tx.immediateExpenseLine.findMany({
          where: {
            organizationId: context.organizationId,
            immediateExpense: {
              reversedJournalId: null,
              expenseDate: { gte: range.from, lte: range.to }
            },
            account: { type: "EXPENSE" }
          },
          include: { immediateExpense: { include: { vendor: true } }, account: true },
          take: maximumDetailRows
        }),
        tx.paymentSettings.findUnique({ where: { organizationId: context.organizationId } })
      ]);
      const rows: ExpenseRow[] = [
        ...billLines.map((line) => ({
          sourceType: "BILL",
          sourceId: line.billId,
          lineId: line.id,
          eventDate: line.bill.issueDate,
          vendorId: line.bill.vendorId,
          vendorName: line.bill.vendor.displayName,
          accountId: line.accountId,
          accountCode: line.account.code,
          accountName: line.account.name,
          amountMinor: line.netAmountMinor + line.nonRecoverableTaxMinor
        })),
        ...immediateLines.map((line) => ({
          sourceType: "IMMEDIATE_EXPENSE",
          sourceId: line.immediateExpenseId,
          lineId: line.id,
          eventDate: line.immediateExpense.expenseDate,
          vendorId: line.immediateExpense.vendorId,
          vendorName: line.immediateExpense.vendor?.displayName ?? "No vendor",
          accountId: line.accountId,
          accountCode: line.account.code,
          accountName: line.account.name,
          amountMinor: line.netAmountMinor + line.nonRecoverableTaxMinor
        }))
      ];
      const feeMinor = settings
        ? await accountPeriodActivity(
            tx,
            context.organizationId,
            settings.feeExpenseAccountId,
            range
          )
        : 0n;
      return {
        from: dateOnly(range.from),
        to: dateOnly(range.to),
        totalExpenseMinor: (
          rows.reduce((sum, row) => sum + row.amountMinor, 0n) + feeMinor
        ).toString(),
        paymentProcessingFeesMinor: feeMinor.toString(),
        byCategory: groupExpenses(rows, "category"),
        byVendor: groupExpenses(rows, "vendor"),
        detail: rows.map((row) => ({
          ...row,
          eventDate: dateOnly(row.eventDate),
          amountMinor: row.amountMinor.toString()
        }))
      };
    });
  }

  public async dashboard(context: OrganizationContext, asOf: string) {
    await this.authorization.assert(context, "dashboard:read", "Dashboard");
    const asOfDate = parseDate(asOf, "asOf");
    const organization = await withReportTransaction(this.prisma, context, (tx) =>
      reportOrganization(tx, context.organizationId)
    );
    const month = localMonthRange(asOfDate, organization.timezone);
    const [profit, receivables, payables, tax, banking, sales] = await Promise.all([
      this.profitAndLoss(context, { ...month, basis: "ACCRUAL" }),
      this.receivables(context, asOf),
      this.payables(context, asOf),
      this.taxReport(context, month),
      this.bankingReport(context, { ...month, asOf }),
      this.salesReport(context, month)
    ]);
    const lowStock = hasPermission(context.role, "inventory:reports")
      ? await withReportTransaction(this.prisma, context, async (tx) => {
          const rows = await tx.$queryRaw<
            { id: string; name: string; sku: string | null; quantity: bigint; reorder: bigint }[]
          >`
            SELECT p.id, p.name, p.sku,
                   COALESCE(SUM(b."quantityOnHandMicros"), 0)::bigint AS quantity,
                   p."reorderPointMicros" AS reorder
              FROM "ProductItem" p
              LEFT JOIN "InventoryBalance" b
                ON b."organizationId" = p."organizationId" AND b."productItemId" = p.id
             WHERE p."organizationId" = ${context.organizationId}::uuid
               AND p.active AND p."itemType" = 'INVENTORY_PRODUCT'
             GROUP BY p.id
            HAVING COALESCE(SUM(b."quantityOnHandMicros"), 0) <= p."reorderPointMicros"
             ORDER BY p.name
             LIMIT 100
          `;
          return rows.map((row) => ({
            productItemId: row.id,
            name: row.name,
            sku: row.sku,
            quantityMicros: row.quantity.toString(),
            reorderPointMicros: row.reorder.toString(),
            reportUrl: "/v1/inventory/reports/low-stock"
          }));
        })
      : [];
    const unpaid = receivables.invoices.filter((invoice) => BigInt(invoice.outstandingMinor) > 0n);
    const upcomingBills = payables.bills.filter(
      (bill) => BigInt(bill.outstandingMinor) > 0n && bill.bucket === "current"
    );
    const foreignExposure = new Map<string, bigint>();
    for (const invoice of receivables.invoices) {
      if (invoice.currency !== organization.currency && BigInt(invoice.outstandingMinor) !== 0n) {
        foreignExposure.set(
          invoice.currency,
          (foreignExposure.get(invoice.currency) ?? 0n) + BigInt(invoice.outstandingMinor)
        );
      }
    }
    for (const bill of payables.bills) {
      if (bill.currency !== organization.currency && BigInt(bill.outstandingMinor) !== 0n) {
        foreignExposure.set(
          bill.currency,
          (foreignExposure.get(bill.currency) ?? 0n) - BigInt(bill.outstandingMinor)
        );
      }
    }
    return {
      asOf,
      generatedAt: new Date().toISOString(),
      currency: organization.currency,
      timezone: organization.timezone,
      cashMinor: banking.accountBalances
        .reduce((sum, account) => sum + BigInt(account.balanceMinor), 0n)
        .toString(),
      unpaidInvoicesMinor: receivables.subledgerBalanceMinor,
      overdueInvoicesMinor: unpaid
        .filter((invoice) => invoice.bucket !== "current")
        .reduce((sum, invoice) => sum + BigInt(invoice.outstandingMinor), 0n)
        .toString(),
      upcomingBillsMinor: upcomingBills
        .reduce((sum, bill) => sum + BigInt(bill.outstandingMinor), 0n)
        .toString(),
      salesThisMonthMinor: sales.netSalesMinor,
      expensesThisMonthMinor: profit.totalExpenseMinor,
      estimatedProfitMinor: profit.netIncomeMinor,
      estimatedTaxPositionMinor: tax.netTaxPositionMinor,
      foreignExposure: [...foreignExposure.entries()]
        .filter(([, amountMinor]) => amountMinor !== 0n)
        .map(([currency, amountMinor]) => ({ currency, amountMinor: amountMinor.toString() })),
      unreconciledBankItems: banking.unmatchedCount,
      lowStock,
      recentCustomerActivity: receivables.paymentHistory.slice(0, 10).map((payment) => ({
        type: "PAYMENT",
        customerId: payment.customerId,
        customerName: payment.customerName,
        eventDate: payment.paymentDate,
        amountMinor: payment.amountMinor,
        sourceId: payment.paymentId
      })),
      links: {
        cash: `/v1/reports/banking?from=${month.from}&to=${month.to}&asOf=${asOf}`,
        receivables: `/v1/reports/receivables?asOf=${asOf}`,
        payables: `/v1/reports/payables?asOf=${asOf}`,
        profit: `/v1/reports/profit-and-loss?from=${month.from}&to=${month.to}&basis=ACCRUAL`,
        tax: `/v1/reports/tax?from=${month.from}&to=${month.to}`,
        inventory: "/v1/inventory/reports/low-stock"
      }
    };
  }

  public async exportCsv(
    context: OrganizationContext,
    reportName: string,
    input: ReportRange & { asOf: string; basis: "ACCRUAL" | "CASH" }
  ) {
    await this.authorization.assert(context, "report-exports:create", "ReportExport", reportName);
    const report = await this.exportableReport(context, reportName, input);
    const rows = exportRows(reportName, report);
    const content = toCsv(rows);
    await withReportTransaction(this.prisma, context, (tx) =>
      tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "REPORT_EXPORTED",
          targetType: "Report",
          targetId: null,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {
            reportName,
            from: input.from,
            to: input.to,
            asOf: input.asOf,
            rowCount: rows.length,
            format: "CSV"
          })
        }
      })
    );
    return {
      filename: `clearledger-${safeFileSegment(reportName)}-${input.asOf}.csv`,
      content
    };
  }

  private async exportableReport(
    context: OrganizationContext,
    reportName: string,
    input: ReportRange & { asOf: string; basis: "ACCRUAL" | "CASH" }
  ): Promise<unknown> {
    switch (reportName) {
      case "profit-and-loss":
        return this.profitAndLoss(context, { from: input.from, to: input.to, basis: input.basis });
      case "balance-sheet":
        return this.balanceSheet(context, input.asOf);
      case "journals":
        return this.journalReport(context, {
          from: input.from,
          to: input.to,
          page: 1,
          pageSize: 100
        });
      case "receivables":
        return this.receivables(context, input.asOf);
      case "payables":
        return this.payables(context, input.asOf);
      case "tax":
      case "tax-by-authority":
        return this.taxReport(context, input);
      case "banking":
        return this.bankingReport(context, input);
      case "sales":
        return this.salesReport(context, input);
      case "expenses":
        return this.expenseReport(context, input);
      default:
        throw new AppError("REPORT_EXPORT_UNSUPPORTED", "Report export is not supported.", 400);
    }
  }
}

interface InternalRange {
  readonly from: Date;
  readonly to: Date;
}

interface ProfitAndLossRow {
  readonly accountId: string;
  readonly code: string;
  readonly name: string;
  readonly section: "REVENUE" | "EXPENSE";
  readonly amountMinor: bigint;
}

interface TaxDetailRow {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceLineId: string;
  readonly eventDate: Date;
  readonly netAmountMinor: bigint;
  readonly collectedMinor: bigint;
  readonly recoverableMinor: bigint;
  readonly nonRecoverableMinor: bigint;
  readonly taxCode: string | null;
  readonly taxVersion: string | null;
  readonly treatment: string | null;
  readonly rateSnapshot: unknown;
}

interface SalesRow {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly lineId: string;
  readonly eventDate: Date;
  readonly customerId: string;
  readonly customerName: string;
  readonly productItemId: string | null;
  readonly productName: string;
  readonly netSalesMinor: bigint;
  readonly discountMinor: bigint;
  readonly creditMinor: bigint;
}

interface ExpenseRow {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly lineId: string;
  readonly eventDate: Date;
  readonly vendorId: string | null;
  readonly vendorName: string;
  readonly accountId: string;
  readonly accountCode: string;
  readonly accountName: string;
  readonly amountMinor: bigint;
}

async function accrualProfitAndLossRows(
  tx: Tx,
  organizationId: string,
  range: InternalRange
): Promise<ProfitAndLossRow[]> {
  const accounts = await tx.account.findMany({
    where: {
      organizationId,
      type: { in: ["REVENUE", "CONTRA_REVENUE", "EXPENSE"] }
    },
    orderBy: [{ code: "asc" }, { id: "asc" }]
  });
  const totals = await tx.journalLine.groupBy({
    by: ["accountId"],
    where: {
      organizationId,
      accountId: { in: accounts.map((account) => account.id) },
      journal: {
        status: "POSTED",
        effectiveDate: { gte: range.from, lte: range.to }
      }
    },
    _sum: { debitMinor: true, creditMinor: true }
  });
  const byAccount = new Map(
    totals.map((total) => [
      total.accountId,
      { debit: total._sum.debitMinor ?? 0n, credit: total._sum.creditMinor ?? 0n }
    ])
  );
  return accounts.map((account) => {
    const total = byAccount.get(account.id) ?? { debit: 0n, credit: 0n };
    return {
      accountId: account.id,
      code: account.code,
      name: account.name,
      section: account.type === "EXPENSE" ? "EXPENSE" : "REVENUE",
      amountMinor:
        account.type === "EXPENSE" ? total.debit - total.credit : total.credit - total.debit
    };
  });
}

async function cashProfitAndLossRows(
  tx: Tx,
  organizationId: string,
  range: InternalRange
): Promise<ProfitAndLossRow[]> {
  const accounts = await tx.account.findMany({
    where: {
      organizationId,
      type: { in: ["REVENUE", "CONTRA_REVENUE", "EXPENSE"] }
    },
    orderBy: [{ code: "asc" }, { id: "asc" }]
  });
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const totals = new Map<string, bigint>();
  const add = (accountId: string, amount: bigint) =>
    totals.set(accountId, (totals.get(accountId) ?? 0n) + amount);
  const [receipts, disbursements, immediateLines] = await Promise.all([
    tx.paymentAllocation.findMany({
      where: {
        organizationId,
        payment: {
          status: { in: [...settledPaymentStatuses] },
          paymentDate: { gte: range.from, lte: range.to }
        }
      },
      include: { invoice: { include: { lines: true } } },
      take: maximumDetailRows
    }),
    tx.billPaymentAllocation.findMany({
      where: {
        organizationId,
        billPayment: {
          reversedJournalId: null,
          paymentDate: { gte: range.from, lte: range.to }
        }
      },
      include: { bill: { include: { lines: true } } },
      take: maximumDetailRows
    }),
    tx.immediateExpenseLine.findMany({
      where: {
        organizationId,
        account: { type: "EXPENSE" },
        immediateExpense: {
          reversedJournalId: null,
          expenseDate: { gte: range.from, lte: range.to }
        }
      },
      take: maximumDetailRows
    })
  ]);
  for (const receipt of receipts) {
    if (receipt.invoice.grandTotalMinor <= 0n) continue;
    for (const line of receipt.invoice.lines) {
      const recognized = roundRatioHalfUp(
        receipt.amountMinor * line.netAmountMinor,
        receipt.invoice.grandTotalMinor
      );
      add(line.incomeAccountId, recognized);
    }
  }
  for (const disbursement of disbursements) {
    if (disbursement.bill.grandTotalMinor <= 0n) continue;
    for (const line of disbursement.bill.lines) {
      if (!accountById.has(line.accountId)) continue;
      const expenseBase = line.netAmountMinor + line.nonRecoverableTaxMinor;
      add(
        line.accountId,
        roundRatioHalfUp(disbursement.amountMinor * expenseBase, disbursement.bill.grandTotalMinor)
      );
    }
  }
  for (const line of immediateLines)
    add(line.accountId, line.netAmountMinor + line.nonRecoverableTaxMinor);
  return accounts.map((account) => ({
    accountId: account.id,
    code: account.code,
    name: account.name,
    section: account.type === "EXPENSE" ? "EXPENSE" : "REVENUE",
    amountMinor: totals.get(account.id) ?? 0n
  }));
}

function reportRange(input: ReportRange): InternalRange {
  const from = parseDate(input.from, "from");
  const to = parseDate(input.to, "to");
  if (to < from)
    throw new AppError("REPORT_RANGE_INVALID", "Report end date must not precede start date.", 400);
  return { from, to };
}

function boundedPage(page: number, pageSize: number) {
  if (!Number.isSafeInteger(page) || page < 1)
    throw new AppError("REPORT_PAGE_INVALID", "Report page must be a positive integer.", 400);
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new AppError(
      "REPORT_PAGE_SIZE_INVALID",
      "Report page size must be between 1 and 100.",
      400
    );
  return { pageSize, skip: (page - 1) * pageSize };
}

function pageMetadata(total: number, page: number, pageSize: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize)
  };
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function generalLedgerUrl(accountId: string, range: InternalRange): string {
  return `/v1/reports/general-ledger?accountId=${encodeURIComponent(accountId)}&from=${dateOnly(range.from)}&to=${dateOnly(range.to)}`;
}

async function reportOrganization(tx: Tx, organizationId: string) {
  const organization = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { currency: true, timezone: true }
  });
  if (!organization)
    throw new AppError("ORGANIZATION_NOT_FOUND", "Organization was not found.", 404);
  return organization;
}

async function cashAccounts(tx: Tx, organizationId: string): Promise<string[]> {
  const [linked, configured] = await Promise.all([
    tx.bankAccount.findMany({
      where: { organizationId },
      select: { linkedLedgerAccountId: true }
    }),
    tx.account.findMany({
      where: { organizationId, type: "ASSET", systemPurpose: "cash" },
      select: { id: true }
    })
  ]);
  return [
    ...new Set([
      ...linked.map((account) => account.linkedLedgerAccountId),
      ...configured.map((account) => account.id)
    ])
  ];
}

async function accountBalance(
  tx: Tx,
  organizationId: string,
  accountId: string,
  asOf: Date
): Promise<bigint> {
  const [account, totals] = await Promise.all([
    tx.account.findFirst({ where: { id: accountId, organizationId } }),
    tx.journalLine.aggregate({
      where: {
        organizationId,
        accountId,
        journal: { status: "POSTED", effectiveDate: { lte: asOf } }
      },
      _sum: { debitMinor: true, creditMinor: true }
    })
  ]);
  if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "Report account was not found.", 422);
  return naturalBalance(account.type, totals._sum.debitMinor ?? 0n, totals._sum.creditMinor ?? 0n);
}

async function accountPeriodActivity(
  tx: Tx,
  organizationId: string,
  accountId: string,
  range: InternalRange
): Promise<bigint> {
  const [account, totals] = await Promise.all([
    tx.account.findFirst({ where: { id: accountId, organizationId } }),
    tx.journalLine.aggregate({
      where: {
        organizationId,
        accountId,
        journal: {
          status: "POSTED",
          effectiveDate: { gte: range.from, lte: range.to }
        }
      },
      _sum: { debitMinor: true, creditMinor: true }
    })
  ]);
  if (!account) throw new AppError("ACCOUNT_NOT_FOUND", "Report account was not found.", 422);
  return naturalBalance(account.type, totals._sum.debitMinor ?? 0n, totals._sum.creditMinor ?? 0n);
}

async function controlBalance(
  tx: Tx,
  organizationId: string,
  purpose: string,
  asOf: Date
): Promise<bigint> {
  const account = await tx.account.findFirst({
    where: { organizationId, systemPurpose: purpose, isControl: true, isArchived: false }
  });
  if (!account)
    throw new AppError(
      "CONTROL_ACCOUNT_REQUIRED",
      `Configured ${purpose} control account is required.`,
      422
    );
  return accountBalance(tx, organizationId, account.id, asOf);
}

async function controlPeriodActivity(
  tx: Tx,
  organizationId: string,
  purpose: string,
  range: InternalRange
): Promise<bigint> {
  const account = await tx.account.findFirst({
    where: { organizationId, systemPurpose: purpose, isControl: true, isArchived: false }
  });
  if (!account)
    throw new AppError(
      "CONTROL_ACCOUNT_REQUIRED",
      `Configured ${purpose} control account is required.`,
      422
    );
  return accountPeriodActivity(tx, organizationId, account.id, range);
}

function naturalBalance(type: AccountType, debit: bigint, credit: bigint): bigint {
  return ["ASSET", "EXPENSE", "CONTRA_REVENUE"].includes(type) ? debit - credit : credit - debit;
}

function agingBucket(asOf: Date, dueDate: Date) {
  const days = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000);
  if (days <= 0) return "current" as const;
  if (days <= 30) return "days1To30" as const;
  if (days <= 60) return "days31To60" as const;
  if (days <= 90) return "days61To90" as const;
  return "over90" as const;
}

function bucketTotals(
  rows: readonly { readonly bucket: string; readonly outstandingMinor: bigint }[]
) {
  const result = {
    current: 0n,
    days1To30: 0n,
    days31To60: 0n,
    days61To90: 0n,
    over90: 0n
  };
  for (const row of rows) {
    const bucket = row.bucket as keyof typeof result;
    result[bucket] += row.outstandingMinor;
  }
  return result;
}

function max(left: bigint, right: bigint) {
  return left > right ? left : right;
}

type StringifiedBigInts<T> = {
  [K in keyof T]: T[K] extends bigint ? string : T[K];
};

function stringifyBigInts<T extends object>(value: T): StringifiedBigInts<T> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      typeof entry === "bigint" ? entry.toString() : entry
    ])
  ) as StringifiedBigInts<T>;
}

function taxDetail(
  sourceType: string,
  sourceId: string,
  sourceLineId: string,
  eventDate: Date,
  netAmountMinor: bigint,
  collectedMinor: bigint,
  recoverableMinor: bigint,
  nonRecoverableMinor: bigint,
  snapshot: Prisma.JsonValue | null
): TaxDetailRow {
  const taxSnapshot =
    snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) ? snapshot : null;
  return {
    sourceType,
    sourceId,
    sourceLineId,
    eventDate,
    netAmountMinor,
    collectedMinor,
    recoverableMinor,
    nonRecoverableMinor,
    taxCode: typeof taxSnapshot?.code === "string" ? taxSnapshot.code : null,
    taxVersion: typeof taxSnapshot?.version === "string" ? taxSnapshot.version : null,
    treatment: typeof taxSnapshot?.treatment === "string" ? taxSnapshot.treatment : null,
    rateSnapshot: taxSnapshot?.components ?? []
  };
}

function taxComponentMinor(value: unknown): bigint {
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  return 0n;
}

/**
 * Group the tax detail by the authority each component is remitted to.
 *
 * A Canadian seller files GST/HST with the CRA and PST or QST with a province,
 * on different schedules and different returns. The aggregate the report already
 * produces cannot be filed from. Every posted line's tax snapshot already
 * carries `components[].jurisdiction` and `components[].payableAccountId`
 * (tax-calculation-service.ts), so the breakdown is derived from stored
 * decisions rather than recalculated — a rate that has since changed cannot
 * alter a past return.
 *
 * Credits keep the original snapshot's positive component amounts, so the row's
 * direction is applied here rather than trusting the component sign.
 */
function taxJurisdictionGroups(detail: readonly TaxDetailRow[]) {
  const groups = new Map<
    string,
    {
      jurisdiction: string;
      payableAccountId: string | null;
      collectedMinor: bigint;
      recoverableMinor: bigint;
      nonRecoverableMinor: bigint;
    }
  >();
  for (const row of detail) {
    const components = Array.isArray(row.rateSnapshot) ? row.rateSnapshot : [];
    const sign = row.sourceType.endsWith("_CREDIT") ? -1n : 1n;
    const collecting = row.sourceType === "SALE" || row.sourceType === "SALES_CREDIT";
    for (const raw of components) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const component = raw as Record<string, unknown>;
      const jurisdiction =
        typeof component.jurisdiction === "string" && component.jurisdiction.trim()
          ? component.jurisdiction.trim()
          : "Unattributed";
      const payableAccountId =
        typeof component.payableAccountId === "string" ? component.payableAccountId : null;
      const key = `${jurisdiction}::${payableAccountId ?? "none"}`;
      const entry = groups.get(key) ?? {
        jurisdiction,
        payableAccountId,
        collectedMinor: 0n,
        recoverableMinor: 0n,
        nonRecoverableMinor: 0n
      };
      if (collecting) entry.collectedMinor += sign * taxComponentMinor(component.totalMinor);
      else {
        entry.recoverableMinor += sign * taxComponentMinor(component.recoverableMinor);
        entry.nonRecoverableMinor += sign * taxComponentMinor(component.nonRecoverableMinor);
      }
      groups.set(key, entry);
    }
  }
  return [...groups.values()].sort((left, right) =>
    left.jurisdiction.localeCompare(right.jurisdiction)
  );
}

function groupedSales(rows: readonly SalesRow[], group: "customer" | "product" | "period") {
  const totals = new Map<string, { key: string; name: string; amountMinor: bigint }>();
  for (const row of rows) {
    const key =
      group === "customer"
        ? row.customerId
        : group === "product"
          ? (row.productItemId ?? `manual:${row.productName}`)
          : dateOnly(row.eventDate).slice(0, 7);
    const name =
      group === "customer"
        ? row.customerName
        : group === "product"
          ? row.productName
          : dateOnly(row.eventDate).slice(0, 7);
    const current = totals.get(key) ?? { key, name, amountMinor: 0n };
    current.amountMinor += row.netSalesMinor;
    totals.set(key, current);
  }
  return [...totals.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((row) => ({ ...row, amountMinor: row.amountMinor.toString() }));
}

function groupExpenses(rows: readonly ExpenseRow[], group: "category" | "vendor") {
  const totals = new Map<string, { key: string; name: string; amountMinor: bigint }>();
  for (const row of rows) {
    const key = group === "category" ? row.accountId : (row.vendorId ?? "no-vendor");
    const name = group === "category" ? `${row.accountCode} ${row.accountName}` : row.vendorName;
    const current = totals.get(key) ?? { key, name, amountMinor: 0n };
    current.amountMinor += row.amountMinor;
    totals.set(key, current);
  }
  return [...totals.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((row) => ({ ...row, amountMinor: row.amountMinor.toString() }));
}

function localMonthRange(asOf: Date, timezone: string): ReportRange {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(asOf);
  } catch {
    throw new AppError("ORGANIZATION_TIMEZONE_INVALID", "Organization time zone is invalid.", 422);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const finalDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-01`,
    to: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${finalDay.toString().padStart(2, "0")}`
  };
}

async function monetaryCarryingBySource(
  tx: Tx,
  organizationId: string,
  kind: "ACCOUNTS_RECEIVABLE" | "ACCOUNTS_PAYABLE",
  sourceType: "invoice" | "bill",
  asOf: Date
): Promise<Map<string, bigint>> {
  const positions = await tx.monetaryPosition.findMany({
    where: { organizationId, kind, sourceType },
    select: {
      sourceId: true,
      events: {
        where: { eventDate: { lte: asOf } },
        select: { carryingBaseDeltaMinor: true }
      }
    }
  });
  return new Map(
    positions.map((position) => [
      position.sourceId,
      position.events.reduce((sum, event) => sum + event.carryingBaseDeltaMinor, 0n)
    ])
  );
}

function exportRows(reportName: string, report: unknown): readonly Record<string, unknown>[] {
  if (!report || typeof report !== "object")
    throw new AppError("REPORT_EXPORT_INVALID", "Report data could not be exported.", 500);
  const object = report as Record<string, unknown>;
  const candidates =
    reportName === "journals"
      ? object.journals
      : reportName === "receivables"
        ? object.invoices
        : reportName === "payables"
          ? object.bills
          : reportName === "banking"
            ? object.unmatchedTransactions
            : reportName === "balance-sheet" || reportName === "profit-and-loss"
              ? object.rows
              : // A sales tax return is prepared per authority, not from the line
                // detail, so this export carries the grouped figures.
                reportName === "tax-by-authority"
                ? object.jurisdictions
                : object.detail;
  if (!Array.isArray(candidates)) return [flattenRecord(object)];
  return candidates
    .slice(0, maximumDetailRows)
    .map((row) =>
      flattenRecord(
        row && typeof row === "object" ? (row as Record<string, unknown>) : { value: row }
      )
    );
}

function flattenRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      entry && typeof entry === "object" ? JSON.stringify(entry) : entry
    ])
  );
}

export function toCsv(rows: readonly Record<string, unknown>[]): string {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "bigint" || typeof value === "boolean"
          ? value.toString()
          : typeof value === "object"
            ? JSON.stringify(value)
            : "";
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function safeFileSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function withReportTransaction<T>(
  prisma: PrismaClient,
  context: OrganizationContext,
  work: (tx: Tx) => Promise<T>
): Promise<T> {
  return withTenantTransaction(
    prisma,
    dbContext(context),
    async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '12s'");
      return work(tx);
    },
    { timeout: 15_000 }
  );
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
