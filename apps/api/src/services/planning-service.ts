import { parseMinorUnit } from "@clearledger/accounting-core";
import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import {
  AppError,
  buildThirteenWeekForecast,
  type CashForecastDriver,
  type OrganizationContext
} from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";

export interface BudgetInput {
  readonly name: string;
  readonly periodType: "WEEK" | "MONTH";
  readonly startDate: string;
  readonly endDate: string;
  readonly lines: readonly {
    readonly accountId: string;
    readonly periodStart: string;
    readonly plannedMinor: string;
    readonly note?: string | null | undefined;
  }[];
}

export interface ForecastAssumptionInput {
  readonly weekStart: string;
  readonly label: string;
  readonly direction: "INFLOW" | "OUTFLOW";
  readonly amountMinor: string;
  readonly note?: string | null | undefined;
}

export class PlanningService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async listBudgets(context: OrganizationContext) {
    await this.authorization.assert(context, "planning:read", "BudgetPlan");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.budgetPlan.findMany({
        where: { organizationId: context.organizationId },
        include: { _count: { select: { lines: true } } },
        orderBy: [{ startDate: "desc" }, { name: "asc" }],
        take: 100
      });
      return rows.map((row) => ({
        ...budgetDto(row),
        lineCount: row._count.lines
      }));
    });
  }

  public async getBudget(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "planning:read", "BudgetPlan", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const plan = await tx.budgetPlan.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          lines: {
            include: { account: true },
            orderBy: [{ periodStart: "asc" }, { account: { code: "asc" } }]
          }
        }
      });
      if (!plan) throw new AppError("BUDGET_NOT_FOUND", "Budget was not found.", 404);
      const actualLines = await tx.journalLine.findMany({
        where: {
          organizationId: context.organizationId,
          accountId: { in: [...new Set(plan.lines.map((line) => line.accountId))] },
          journal: {
            status: "POSTED",
            effectiveDate: { gte: plan.startDate, lte: plan.endDate }
          }
        },
        include: { journal: { select: { effectiveDate: true } } }
      });
      const lines = plan.lines.map((line) => {
        const periodEnd = nextPeriod(
          line.periodStart,
          plan.periodType,
          plan.startDate,
          plan.endDate
        );
        const actualMinor = actualLines
          .filter(
            (actual) =>
              actual.accountId === line.accountId &&
              actual.journal.effectiveDate >= line.periodStart &&
              actual.journal.effectiveDate < periodEnd
          )
          .reduce(
            (sum, actual) =>
              sum +
              (line.account.normalBalance === "CREDIT" ||
              (line.account.normalBalance === null && line.account.type === "REVENUE")
                ? actual.creditMinor - actual.debitMinor
                : actual.debitMinor - actual.creditMinor),
            0n
          );
        return {
          id: line.id,
          accountId: line.accountId,
          accountCode: line.account.code,
          accountName: line.account.name,
          periodStart: serializeDate(line.periodStart),
          plannedMinor: line.plannedMinor.toString(),
          actualMinor: actualMinor.toString(),
          varianceMinor: (actualMinor - line.plannedMinor).toString(),
          note: line.note
        };
      });
      return { ...budgetDto(plan), lines };
    });
  }

  public async createBudget(context: OrganizationContext, input: BudgetInput) {
    await this.authorization.assert(context, "planning:manage", "BudgetPlan");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const dates = validateBudget(input);
      await validateBudgetAccounts(
        tx,
        context.organizationId,
        input.lines.map((line) => line.accountId)
      );
      const row = await tx.budgetPlan.create({
        data: {
          organizationId: context.organizationId,
          name: input.name.trim(),
          periodType: input.periodType,
          ...dates,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id,
          lines: {
            create: input.lines.map((line) => ({
              accountId: line.accountId,
              periodStart: parseDate(line.periodStart, "periodStart"),
              plannedMinor: parseMinorUnit(line.plannedMinor, "plannedMinor"),
              note: line.note ?? null
            }))
          }
        }
      });
      await audit(tx, context, "BUDGET_CREATED", "BudgetPlan", row.id, {
        lineCount: input.lines.length
      });
      return budgetDto(row);
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new AppError(
          "BUDGET_NAME_DUPLICATE",
          "A budget with this name and start date already exists.",
          409
        );
      throw error;
    });
  }

  public async replaceBudget(
    context: OrganizationContext,
    id: string,
    version: number,
    input: BudgetInput
  ) {
    await this.authorization.assert(context, "planning:manage", "BudgetPlan", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const dates = validateBudget(input);
      await validateBudgetAccounts(
        tx,
        context.organizationId,
        input.lines.map((line) => line.accountId)
      );
      const claimed = await tx.budgetPlan.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          status: "DRAFT",
          version
        },
        data: {
          name: input.name.trim(),
          periodType: input.periodType,
          ...dates,
          version: { increment: 1 },
          updatedByUserId: context.user.id
        }
      });
      if (claimed.count !== 1)
        throw new AppError("STALE_BUDGET", "Only the current budget draft can be changed.", 409);
      await tx.budgetLine.deleteMany({
        where: { budgetPlanId: id, organizationId: context.organizationId }
      });
      await tx.budgetLine.createMany({
        data: input.lines.map((line) => ({
          organizationId: context.organizationId,
          budgetPlanId: id,
          accountId: line.accountId,
          periodStart: parseDate(line.periodStart, "periodStart"),
          plannedMinor: parseMinorUnit(line.plannedMinor, "plannedMinor"),
          note: line.note ?? null
        }))
      });
      const row = await tx.budgetPlan.findUniqueOrThrow({ where: { id } });
      await audit(tx, context, "BUDGET_REPLACED", "BudgetPlan", id, {
        lineCount: input.lines.length
      });
      return budgetDto(row);
    }).catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new AppError(
          "BUDGET_NAME_DUPLICATE",
          "A budget with this name and start date already exists.",
          409
        );
      throw error;
    });
  }

  public async setBudgetStatus(
    context: OrganizationContext,
    id: string,
    version: number,
    status: "ACTIVE" | "ARCHIVED"
  ) {
    await this.authorization.assert(context, "planning:manage", "BudgetPlan", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.budgetPlan.updateMany({
        where: {
          id,
          organizationId: context.organizationId,
          version,
          status: status === "ACTIVE" ? "DRAFT" : { in: ["DRAFT", "ACTIVE"] }
        },
        data: { status, version: { increment: 1 }, updatedByUserId: context.user.id }
      });
      if (result.count !== 1)
        throw new AppError("STALE_BUDGET", "Budget status changed or is not eligible.", 409);
      await audit(tx, context, `BUDGET_${status}`, "BudgetPlan", id, {});
      return budgetDto(await tx.budgetPlan.findUniqueOrThrow({ where: { id } }));
    });
  }

  public async listAssumptions(context: OrganizationContext, from?: string) {
    await this.authorization.assert(context, "planning:read", "CashForecastAssumption");
    const fromDate = from ? startOfWeek(parseDate(from, "from")) : startOfWeek(new Date());
    const endDate = addDays(fromDate, 91);
    const rows = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.cashForecastAssumption.findMany({
        where: {
          organizationId: context.organizationId,
          weekStart: { gte: fromDate, lt: endDate }
        },
        orderBy: [{ weekStart: "asc" }, { label: "asc" }]
      })
    );
    return rows.map(assumptionDto);
  }

  public async createAssumption(context: OrganizationContext, input: ForecastAssumptionInput) {
    await this.authorization.assert(context, "planning:manage", "CashForecastAssumption");
    const amountMinor = parseMinorUnit(input.amountMinor, "amountMinor");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const row = await tx.cashForecastAssumption.create({
        data: {
          organizationId: context.organizationId,
          weekStart: startOfWeek(parseDate(input.weekStart, "weekStart")),
          label: input.label.trim(),
          direction: input.direction,
          amountMinor,
          note: input.note ?? null,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "CASH_ASSUMPTION_CREATED", "CashForecastAssumption", row.id, {
        direction: row.direction
      });
      return assumptionDto(row);
    });
  }

  public async deleteAssumption(context: OrganizationContext, id: string, version: number) {
    await this.authorization.assert(context, "planning:manage", "CashForecastAssumption", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.cashForecastAssumption.deleteMany({
        where: { id, organizationId: context.organizationId, version }
      });
      if (result.count !== 1)
        throw new AppError("STALE_CASH_ASSUMPTION", "Cash assumption was changed or removed.", 409);
      await audit(tx, context, "CASH_ASSUMPTION_DELETED", "CashForecastAssumption", id, {});
      return { deleted: true };
    });
  }

  public async cashForecast(context: OrganizationContext, from?: string) {
    await this.authorization.assert(context, "planning:read", "CashForecast");
    const firstWeek = from ? startOfWeek(parseDate(from, "from")) : startOfWeek(new Date());
    const weekDates = Array.from({ length: 13 }, (_, index) => addDays(firstWeek, index * 7));
    const finalDate = addDays(firstWeek, 91);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const [systemCashAccounts, operationalBankAccounts] = await Promise.all([
        tx.account.findMany({
          where: {
            organizationId: context.organizationId,
            type: "ASSET",
            systemPurpose: "cash",
            isArchived: false
          },
          select: { id: true }
        }),
        tx.bankAccount.findMany({
          where: {
            organizationId: context.organizationId,
            accountKind: "BANK",
            isActive: true
          },
          select: { linkedLedgerAccountId: true }
        })
      ]);
      const cashAccountIds = [
        ...new Set([
          ...systemCashAccounts.map((account) => account.id),
          ...operationalBankAccounts.map((account) => account.linkedLedgerAccountId)
        ])
      ];
      const cashTotals = cashAccountIds.length
        ? await tx.journalLine.aggregate({
            where: {
              organizationId: context.organizationId,
              accountId: { in: cashAccountIds },
              journal: { status: "POSTED", effectiveDate: { lt: firstWeek } }
            },
            _sum: { debitMinor: true, creditMinor: true }
          })
        : { _sum: { debitMinor: 0n, creditMinor: 0n } };
      const openingMinor = (cashTotals._sum.debitMinor ?? 0n) - (cashTotals._sum.creditMinor ?? 0n);
      const [actualCashLines, invoices, bills, assumptions] = await Promise.all([
        cashAccountIds.length
          ? tx.journalLine.findMany({
              where: {
                organizationId: context.organizationId,
                accountId: { in: cashAccountIds },
                journal: {
                  status: "POSTED",
                  effectiveDate: { gte: firstWeek, lt: finalDate }
                }
              },
              select: {
                journalId: true,
                debitMinor: true,
                creditMinor: true,
                journal: {
                  select: {
                    effectiveDate: true,
                    description: true,
                    sourceType: true
                  }
                }
              }
            })
          : Promise.resolve([]),
        tx.invoice.findMany({
          where: {
            organizationId: context.organizationId,
            status: { in: ["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED", "OVERDUE"] },
            dueDate: { lt: finalDate }
          },
          select: {
            invoiceNumber: true,
            dueDate: true,
            grandTotalMinor: true,
            amountPaidMinor: true,
            creditNotes: {
              where: { status: "POSTED" },
              select: { grandTotalMinor: true }
            }
          }
        }),
        tx.bill.findMany({
          where: {
            organizationId: context.organizationId,
            status: { in: ["POSTED", "PARTIALLY_PAID", "PARTIALLY_CREDITED", "OVERDUE"] },
            dueDate: { lt: finalDate }
          },
          select: {
            vendorInvoiceNumber: true,
            dueDate: true,
            grandTotalMinor: true,
            amountPaidMinor: true,
            creditedMinor: true
          }
        }),
        tx.cashForecastAssumption.findMany({
          where: {
            organizationId: context.organizationId,
            weekStart: { gte: firstWeek, lt: finalDate }
          }
        })
      ]);
      const driversByWeek: CashForecastDriver[][] = weekDates.map(() => []);
      const actualByJournal = new Map<
        string,
        { effectiveDate: Date; label: string; amountMinor: bigint }
      >();
      for (const line of actualCashLines) {
        const existing = actualByJournal.get(line.journalId);
        const amountMinor = line.debitMinor - line.creditMinor;
        actualByJournal.set(line.journalId, {
          effectiveDate: line.journal.effectiveDate,
          label:
            existing?.label ??
            `Posted cash: ${line.journal.description || line.journal.sourceType}`,
          amountMinor: (existing?.amountMinor ?? 0n) + amountMinor
        });
      }
      for (const actual of actualByJournal.values()) {
        if (actual.amountMinor === 0n) continue;
        driversByWeek[weekIndex(actual.effectiveDate, firstWeek)]?.push({
          label: actual.label,
          amountMinor: actual.amountMinor,
          confidence: "ACTUAL"
        });
      }
      for (const invoice of invoices) {
        const creditedMinor = invoice.creditNotes.reduce(
          (sum, credit) => sum + credit.grandTotalMinor,
          0n
        );
        const outstanding = invoice.grandTotalMinor - invoice.amountPaidMinor - creditedMinor;
        if (outstanding > 0n)
          driversByWeek[weekIndex(invoice.dueDate, firstWeek)]?.push({
            label: `Invoice ${invoice.invoiceNumber ?? "draft number"}`,
            amountMinor: outstanding,
            confidence: "PROJECTED"
          });
      }
      for (const bill of bills) {
        const outstanding = bill.grandTotalMinor - bill.amountPaidMinor - bill.creditedMinor;
        if (outstanding > 0n)
          driversByWeek[weekIndex(bill.dueDate, firstWeek)]?.push({
            label: `Bill ${bill.vendorInvoiceNumber}`,
            amountMinor: -outstanding,
            confidence: "PROJECTED"
          });
      }
      for (const assumption of assumptions)
        driversByWeek[weekIndex(assumption.weekStart, firstWeek)]?.push({
          label: assumption.label,
          amountMinor:
            assumption.direction === "INFLOW" ? assumption.amountMinor : -assumption.amountMinor,
          confidence: "ASSUMED"
        });
      return {
        asOf: serializeDate(new Date()),
        forecastStart: serializeDate(firstWeek),
        openingMinor: openingMinor.toString(),
        weeks: buildThirteenWeekForecast(
          openingMinor,
          weekDates.map(serializeDate),
          driversByWeek
        ).map((week) => ({
          ...week,
          openingMinor: week.openingMinor.toString(),
          inflowsMinor: week.inflowsMinor.toString(),
          outflowsMinor: week.outflowsMinor.toString(),
          closingMinor: week.closingMinor.toString(),
          drivers: week.drivers.map((driver) => ({
            ...driver,
            amountMinor: driver.amountMinor.toString()
          }))
        }))
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

function validateBudget(input: BudgetInput) {
  const startDate = parseDate(input.startDate, "startDate");
  const endDate = parseDate(input.endDate, "endDate");
  if (endDate < startDate)
    throw new AppError("BUDGET_DATE_INVALID", "Budget end date is invalid.", 422);
  const seen = new Set<string>();
  for (const line of input.lines) {
    const periodStart = parseDate(line.periodStart, "periodStart");
    if (periodStart < startDate || periodStart > endDate)
      throw new AppError("BUDGET_PERIOD_INVALID", "Budget line is outside the plan dates.", 422);
    if (!isBudgetPeriodStart(periodStart, input.periodType, startDate))
      throw new AppError(
        "BUDGET_PERIOD_INVALID",
        `Budget lines must start on the plan's ${input.periodType === "WEEK" ? "seven-day" : "monthly"} cadence.`,
        422
      );
    if (parseMinorUnit(line.plannedMinor, "plannedMinor") < 0n)
      throw new AppError("BUDGET_AMOUNT_INVALID", "Budget amounts cannot be negative.", 422);
    const key = `${line.accountId}:${serializeDate(periodStart)}`;
    if (seen.has(key))
      throw new AppError("BUDGET_LINE_DUPLICATE", "Budget account and period must be unique.", 422);
    seen.add(key);
  }
  return { startDate, endDate };
}

async function validateBudgetAccounts(
  tx: Prisma.TransactionClient,
  organizationId: string,
  accountIds: readonly string[]
) {
  const unique = [...new Set(accountIds)];
  const accounts = await tx.account.findMany({
    where: {
      organizationId,
      id: { in: unique },
      type: { in: ["REVENUE", "EXPENSE"] },
      isArchived: false
    },
    select: { id: true }
  });
  if (accounts.length !== unique.length)
    throw new AppError(
      "BUDGET_ACCOUNT_INVALID",
      "Budgets can use active revenue and expense accounts only.",
      422
    );
}

function budgetDto(row: {
  id: string;
  name: string;
  periodType: string;
  startDate: Date;
  endDate: Date;
  status: string;
  version: number;
}) {
  return {
    id: row.id,
    name: row.name,
    periodType: row.periodType,
    startDate: serializeDate(row.startDate),
    endDate: serializeDate(row.endDate),
    status: row.status,
    version: row.version
  };
}

function assumptionDto(row: {
  id: string;
  weekStart: Date;
  label: string;
  direction: string;
  amountMinor: bigint;
  note: string | null;
  version: number;
}) {
  return {
    id: row.id,
    weekStart: serializeDate(row.weekStart),
    label: row.label,
    direction: row.direction,
    amountMinor: row.amountMinor.toString(),
    note: row.note,
    version: row.version
  };
}

function nextPeriod(
  periodStart: Date,
  periodType: "WEEK" | "MONTH",
  planStart: Date,
  planEnd: Date
) {
  const next =
    periodType === "WEEK"
      ? addDays(periodStart, 7)
      : addCalendarMonthsClamped(planStart, monthOffset(planStart, periodStart) + 1);
  return next > addDays(planEnd, 1) ? addDays(planEnd, 1) : next;
}

function isBudgetPeriodStart(date: Date, periodType: "WEEK" | "MONTH", planStart: Date) {
  if (periodType === "WEEK") {
    const dayDifference = Math.floor((date.getTime() - planStart.getTime()) / 86_400_000);
    return dayDifference >= 0 && dayDifference % 7 === 0;
  }
  const offset = monthOffset(planStart, date);
  return (
    offset >= 0 &&
    serializeDate(addCalendarMonthsClamped(planStart, offset)) === serializeDate(date)
  );
}

function monthOffset(from: Date, to: Date) {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth();
}

function addCalendarMonthsClamped(anchor: Date, count: number) {
  const monthStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + count, 1));
  const lastDay = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0)
  ).getUTCDate();
  monthStart.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
  return monthStart;
}

function startOfWeek(date: Date) {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = result.getUTCDay();
  result.setUTCDate(result.getUTCDate() - (day === 0 ? 6 : day - 1));
  return result;
}

function addDays(date: Date, count: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result;
}

function weekIndex(date: Date, firstWeek: Date) {
  return Math.max(
    0,
    Math.min(12, Math.floor((date.getTime() - firstWeek.getTime()) / (7 * 24 * 60 * 60 * 1000)))
  );
}

async function audit(
  tx: Prisma.TransactionClient,
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
