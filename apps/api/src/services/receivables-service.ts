import { serializeMinorUnit } from "@clearledger/accounting-core";
import { withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { parseDate, serializeDate } from "../utils/dates.js";

export class ReceivablesService {
  private readonly authorization: AuthorizationService;
  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async customerBalance(context: OrganizationContext, customerId: string) {
    await this.authorization.assert(context, "receivables:read", "Customer", customerId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, organizationId: context.organizationId }
      });
      if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
      const invoices = await tx.invoice.findMany({
        where: {
          organizationId: context.organizationId,
          customerId,
          status: { in: ["POSTED", "PARTIALLY_PAID", "PAID", "PARTIALLY_CREDITED", "CREDITED"] }
        },
        include: {
          creditNotes: { where: { status: "POSTED" }, select: { grandTotalMinor: true } },
          lines: true
        },
        orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }]
      });
      const detail = invoices.map((invoice) => this.invoiceDetail(invoice));
      const balance = detail.reduce((sum, item) => sum + BigInt(item.outstandingBalanceMinor), 0n);
      return {
        customerId,
        customerNumber: customer.customerNumber,
        displayName: customer.displayName,
        balanceMinor: serializeMinorUnit(balance),
        invoices: detail
      };
    });
  }

  public async aging(context: OrganizationContext, asOf?: string) {
    await this.authorization.assert(context, "receivables:read", "AccountsReceivable");
    const asOfDate = asOf ? parseDate(asOf, "asOf") : new Date();
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: {
          organizationId: context.organizationId,
          status: { in: ["POSTED", "PARTIALLY_PAID", "PAID", "PARTIALLY_CREDITED", "CREDITED"] },
          issueDate: { lte: asOfDate }
        },
        include: {
          customer: true,
          creditNotes: { where: { status: "POSTED" }, select: { grandTotalMinor: true } }
        },
        orderBy: { dueDate: "asc" }
      });
      const buckets = new Map([
        ["current", 0n],
        ["1-30", 0n],
        ["31-60", 0n],
        ["61-90", 0n],
        ["90+", 0n]
      ]);
      const rows = invoices.map((invoice) => {
        const outstanding =
          invoice.status === "VOIDED"
            ? 0n
            : maxBigInt(
                0n,
                invoice.grandTotalMinor -
                  invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n) -
                  invoice.amountPaidMinor
              );
        const days = Math.floor((asOfDate.getTime() - invoice.dueDate.getTime()) / 86_400_000);
        const bucket =
          days <= 0
            ? "current"
            : days <= 30
              ? "1-30"
              : days <= 60
                ? "31-60"
                : days <= 90
                  ? "61-90"
                  : "90+";
        buckets.set(bucket, buckets.get(bucket)! + outstanding);
        return {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: invoice.customer.displayName,
          dueDate: serializeDate(invoice.dueDate),
          outstandingBalanceMinor: serializeMinorUnit(outstanding),
          bucket
        };
      });
      return {
        asOf: serializeDate(asOfDate),
        buckets: Object.fromEntries(
          [...buckets].map(([key, value]) => [key, serializeMinorUnit(value)])
        ),
        invoices: rows
      };
    });
  }

  public async reconcile(context: OrganizationContext) {
    await this.authorization.assert(context, "receivables:read", "AccountsReceivable");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const account = await tx.account.findFirst({
        where: {
          organizationId: context.organizationId,
          systemPurpose: "accounts-receivable",
          isControl: true,
          isArchived: false
        }
      });
      if (!account)
        throw new AppError(
          "RECEIVABLE_CONTROL_ACCOUNT_REQUIRED",
          "Accounts-receivable control account is not configured.",
          422
        );
      const lines = await tx.journalLine.findMany({
        where: {
          organizationId: context.organizationId,
          accountId: account.id,
          journal: { status: "POSTED" }
        },
        select: { debitMinor: true, creditMinor: true }
      });
      const ledgerBalance = lines.reduce(
        (sum, line) => sum + line.debitMinor - line.creditMinor,
        0n
      );
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: context.organizationId },
        select: { currency: true }
      });
      const baseCurrency = organization.currency.trim();
      const invoices = await tx.invoice.findMany({
        where: {
          organizationId: context.organizationId,
          currency: baseCurrency,
          status: { in: ["POSTED", "PARTIALLY_PAID", "PAID", "PARTIALLY_CREDITED", "CREDITED"] }
        },
        include: { creditNotes: { where: { status: "POSTED" }, select: { grandTotalMinor: true } } }
      });
      const baseCurrencyBalance = invoices.reduce(
        (sum, invoice) =>
          sum +
          invoice.grandTotalMinor -
          invoice.creditNotes.reduce((credit, note) => credit + note.grandTotalMinor, 0n) -
          invoice.amountPaidMinor,
        0n
      );
      const foreignPositionEvents = await tx.monetaryPositionEvent.aggregate({
        where: {
          organizationId: context.organizationId,
          eventDate: { lte: new Date() },
          monetaryPosition: { kind: "ACCOUNTS_RECEIVABLE" }
        },
        _sum: { carryingBaseDeltaMinor: true }
      });
      const subledgerBalance =
        baseCurrencyBalance + (foreignPositionEvents._sum.carryingBaseDeltaMinor ?? 0n);
      const difference = ledgerBalance - subledgerBalance;
      return {
        accountId: account.id,
        ledgerBalanceMinor: serializeMinorUnit(ledgerBalance),
        subledgerBalanceMinor: serializeMinorUnit(subledgerBalance),
        differenceMinor: serializeMinorUnit(difference),
        isReconciled: difference === 0n
      };
    });
  }

  private invoiceDetail(invoice: {
    id: string;
    invoiceNumber: string | null;
    issueDate: Date;
    dueDate: Date;
    grandTotalMinor: bigint;
    amountPaidMinor: bigint;
    status: string;
    creditNotes: readonly { grandTotalMinor: bigint }[];
  }) {
    const credited = invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
    const outstanding =
      invoice.status === "VOIDED"
        ? 0n
        : maxBigInt(0n, invoice.grandTotalMinor - credited - invoice.amountPaidMinor);
    return {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: serializeDate(invoice.issueDate),
      dueDate: serializeDate(invoice.dueDate),
      status: invoice.status,
      grandTotalMinor: serializeMinorUnit(invoice.grandTotalMinor),
      creditedMinor: serializeMinorUnit(credited),
      amountPaidMinor: serializeMinorUnit(invoice.amountPaidMinor),
      outstandingBalanceMinor: serializeMinorUnit(outstanding)
    };
  }
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right;
}
