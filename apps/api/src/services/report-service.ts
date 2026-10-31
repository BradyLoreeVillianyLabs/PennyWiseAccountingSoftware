import { serializeMinorUnit } from "@clearledger/accounting-core";
import {
  withTenantTransaction,
  type AccountType,
  type Prisma,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { parseDate, serializeDate } from "../utils/dates.js";

export class ReportService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async trialBalance(context: OrganizationContext, asOf?: string) {
    await this.authorization.assert(context, "reports:read", "Report");
    const asOfDate = asOf ? parseDate(asOf, "asOf") : undefined;

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const journalWhere: Prisma.JournalWhereInput = { status: "POSTED" };
      if (asOfDate) journalWhere.effectiveDate = { lte: asOfDate };
      const [accounts, balances] = await Promise.all([
        tx.account.findMany({
          where: { organizationId: context.organizationId },
          orderBy: [{ code: "asc" }, { name: "asc" }]
        }),
        tx.journalLine.groupBy({
          by: ["accountId"],
          where: {
            organizationId: context.organizationId,
            journal: journalWhere
          },
          _sum: { debitMinor: true, creditMinor: true }
        })
      ]);
      const balancesByAccount = new Map(
        balances.map((balance) => [
          balance.accountId,
          {
            debitMinor: balance._sum.debitMinor ?? 0n,
            creditMinor: balance._sum.creditMinor ?? 0n
          }
        ])
      );
      const rows = accounts.map((account) => {
        const balance = balancesByAccount.get(account.id);
        const debitMinor = balance?.debitMinor ?? 0n;
        const creditMinor = balance?.creditMinor ?? 0n;
        return {
          accountId: account.id,
          code: account.code,
          name: account.name,
          type: account.type,
          debitMinor: serializeMinorUnit(debitMinor),
          creditMinor: serializeMinorUnit(creditMinor),
          balanceMinor: serializeMinorUnit(
            balanceByAccountType(account.type, debitMinor, creditMinor)
          ),
          drillDownUrl: `/v1/reports/general-ledger?accountId=${encodeURIComponent(account.id)}${asOfDate ? `&to=${serializeDate(asOfDate).slice(0, 10)}` : ""}`
        };
      });
      const totalDebitMinor = rows.reduce((total, row) => total + BigInt(row.debitMinor), 0n);
      const totalCreditMinor = rows.reduce((total, row) => total + BigInt(row.creditMinor), 0n);
      return {
        asOf: asOfDate ? serializeDate(asOfDate) : null,
        totalDebitMinor: serializeMinorUnit(totalDebitMinor),
        totalCreditMinor: serializeMinorUnit(totalCreditMinor),
        isBalanced: totalDebitMinor === totalCreditMinor,
        rows
      };
    });
  }

  public async generalLedger(
    context: OrganizationContext,
    filters: {
      readonly accountId?: string | undefined;
      readonly from?: string | undefined;
      readonly to?: string | undefined;
      readonly page?: number | undefined;
      readonly pageSize?: number | undefined;
    }
  ) {
    await this.authorization.assert(context, "reports:read", "Report");
    const from = filters.from ? parseDate(filters.from, "from") : undefined;
    const to = filters.to ? parseDate(filters.to, "to") : undefined;

    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const effectiveDateFilter: Prisma.DateTimeFilter<"Journal"> = {};
      if (from) effectiveDateFilter.gte = from;
      if (to) effectiveDateFilter.lte = to;
      const journalWhere: Prisma.JournalWhereInput = { status: "POSTED" };
      if (from || to) journalWhere.effectiveDate = effectiveDateFilter;
      const where: Prisma.JournalLineWhereInput = {
        organizationId: context.organizationId,
        journal: journalWhere,
        ...(filters.accountId ? { accountId: filters.accountId } : {})
      };
      const page = filters.page ?? 1;
      const pageSize = filters.pageSize ?? 100;
      const skip = (page - 1) * pageSize;
      if (skip > 5_000)
        throw new AppError(
          "REPORT_ROW_LIMIT_EXCEEDED",
          "General-ledger pagination is limited to the first 5,000 detail rows.",
          422
        );
      const orderBy: Prisma.JournalLineOrderByWithRelationInput[] = [
        { journal: { effectiveDate: "asc" } },
        { journalId: "asc" },
        { lineNumber: "asc" }
      ];
      const [total, preceding, lines] = await Promise.all([
        tx.journalLine.count({ where }),
        tx.journalLine.findMany({
          where,
          select: { accountId: true, debitMinor: true, creditMinor: true, account: true },
          orderBy,
          take: skip
        }),
        tx.journalLine.findMany({
          where,
          include: { account: true, journal: true },
          orderBy,
          skip,
          take: pageSize
        })
      ]);
      const runningByAccount = new Map<string, bigint>();
      for (const line of preceding)
        runningByAccount.set(
          line.accountId,
          (runningByAccount.get(line.accountId) ?? 0n) +
            balanceByAccountType(line.account.type, line.debitMinor, line.creditMinor)
        );
      return {
        from: from ? serializeDate(from) : null,
        to: to ? serializeDate(to) : null,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        lines: lines.map((line) => {
          const previous = runningByAccount.get(line.accountId) ?? 0n;
          const runningBalance =
            previous + balanceByAccountType(line.account.type, line.debitMinor, line.creditMinor);
          runningByAccount.set(line.accountId, runningBalance);
          return {
            journalId: line.journalId,
            journalLineId: line.id,
            accountId: line.accountId,
            accountCode: line.account.code,
            accountName: line.account.name,
            accountType: line.account.type,
            effectiveDate: serializeDate(line.journal.effectiveDate),
            description: line.description ?? line.journal.description,
            sourceType: line.journal.sourceType,
            sourceId: line.journal.sourceId,
            debitMinor: serializeMinorUnit(line.debitMinor),
            creditMinor: serializeMinorUnit(line.creditMinor),
            runningBalanceMinor: serializeMinorUnit(runningBalance)
          };
        })
      };
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

function balanceByAccountType(type: AccountType, debitMinor: bigint, creditMinor: bigint): bigint {
  switch (type) {
    case "ASSET":
    case "EXPENSE":
    case "CONTRA_REVENUE":
      return debitMinor - creditMinor;
    case "LIABILITY":
    case "EQUITY":
    case "REVENUE":
    case "CONTRA_ASSET":
      return creditMinor - debitMinor;
  }
}
