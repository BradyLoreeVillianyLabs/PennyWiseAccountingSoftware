import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError, nextRecurrenceDate, recurrenceRunIdempotencyKey } from "@clearledger/shared";
import { InvoiceDocumentService } from "./invoice-document-service.js";
import { InvoiceService, type InvoiceCreateInput } from "./invoice-service.js";

const STALE_OCCURRENCE_MS = 15 * 60_000;
const BLOCKING_CODES = new Set([
  "FX_RATE_REQUIRED",
  "FX_RATE_DATE_MISMATCH",
  "FX_RATE_CURRENCY_MISMATCH",
  "CURRENCY_NOT_ENABLED",
  "MULTI_CURRENCY_NOT_ENABLED",
  "CURRENCY_PAIR_NOT_RELEASED",
  "FISCAL_PERIOD_CLOSED",
  "PERIOD_LOCKED",
  "FISCAL_PERIOD_NOT_FOUND"
]);

type RecurringScheduleRow = Prisma.RecurringScheduleGetPayload<{
  include: { occurrences: { orderBy: { occurrenceAt: "desc" }; take: 20 } };
}>;

type ScheduleFields = {
  readonly nextRunAt: Date;
  readonly endAt: Date | null;
  readonly frequency: "WEEK" | "MONTH" | "YEAR";
  readonly interval: number;
  readonly dayOfMonth: number | null;
  readonly timeZone: string;
};

export interface RecurringMaterializationCounts {
  readonly checked: number;
  readonly created: number;
  readonly skipped: number;
  readonly blocked: number;
  readonly failed: number;
}

export class RecurringInvoiceService {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly invoiceService: InvoiceService,
    private readonly invoiceDocumentService: InvoiceDocumentService,
    private readonly emailDeliveryAvailable: boolean
  ) {}

  public async materializeDue(
    context: OrganizationContext,
    limit: number,
    now = new Date()
  ): Promise<RecurringMaterializationCounts> {
    const schedules = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.recurringSchedule.findMany({
        where: {
          organizationId: context.organizationId,
          scheduleType: "INVOICE",
          status: "ACTIVE",
          nextRunAt: { lte: now }
        },
        orderBy: { nextRunAt: "asc" },
        take: limit
      })
    );
    const counts = { checked: schedules.length, created: 0, skipped: 0, blocked: 0, failed: 0 };
    for (const schedule of schedules) {
      const result = await this.materializeSchedule(context, schedule, limit, now);
      counts.created += result.created;
      counts.skipped += result.skipped;
      counts.blocked += result.blocked;
      counts.failed += result.failed;
    }
    return counts;
  }

  public async list(context: OrganizationContext) {
    const schedules = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.recurringSchedule.findMany({
        where: { organizationId: context.organizationId },
        include: { occurrences: { orderBy: { occurrenceAt: "desc" }, take: 20 } },
        orderBy: { nextRunAt: "asc" },
        take: 200
      })
    );
    return schedules.map((schedule) => scheduleDto(schedule));
  }

  private async materializeSchedule(
    context: OrganizationContext,
    schedule: Prisma.RecurringScheduleGetPayload<Prisma.RecurringScheduleDefaultArgs>,
    limit: number,
    now: Date
  ) {
    const dueDates = dueOccurrenceDates(schedule, now, limit);
    const selected = schedule.missedOccurrencePolicy === "LATEST" ? dueDates.slice(-1) : dueDates;
    let skipped = 0;
    if (schedule.missedOccurrencePolicy === "LATEST") {
      for (const occurrenceAt of dueDates.slice(0, -1)) {
        const marked = await this.recordSkipped(context, schedule, occurrenceAt);
        if (marked) skipped++;
      }
    }
    const totals = { created: 0, blocked: 0, failed: 0 };
    for (const occurrenceAt of selected) {
      const result = await this.materializeOccurrence(context, schedule, occurrenceAt);
      totals[result]++;
    }
    return { ...totals, skipped };
  }

  private async materializeOccurrence(
    context: OrganizationContext,
    schedule: Prisma.RecurringScheduleGetPayload<Prisma.RecurringScheduleDefaultArgs>,
    occurrenceAt: Date
  ): Promise<"created" | "blocked" | "failed"> {
    const claimed = await this.claimOccurrence(context, schedule, occurrenceAt);
    if (!claimed) return "created";
    const key = recurrenceRunIdempotencyKey(schedule.id, occurrenceAt);
    const issueDate = localDate(occurrenceAt, schedule.timeZone);
    try {
      const template = invoiceTemplate(schedule.template);
      const input: InvoiceCreateInput = {
        customerId: schedule.customerId ?? template.customerId,
        issueDate,
        dueDate: template.dueDate,
        paymentTermsDays: template.paymentTermsDays,
        currency: template.currency,
        fxRateSnapshotId: template.fxRateSnapshotId,
        lines: template.lines,
        customerFacingNotes: template.customerFacingNotes,
        internalNotes: template.internalNotes,
        terms: template.terms,
        paymentMethodSelection: template.paymentMethodSelection,
        recurrenceIdempotencyKey: key,
        allowMissingFxRate: !template.fxRateSnapshotId
      };
      if (!input.customerId)
        throw new AppError(
          "RECURRING_CUSTOMER_REQUIRED",
          "Choose a customer for this recurring invoice.",
          422
        );
      const invoice = await this.findOrCreateInvoice(context, input);
      if (invoice.automationBlockingReason) {
        await this.blockOccurrence(
          context,
          claimed.id,
          schedule,
          occurrenceAt,
          invoice.automationBlockingReason
        );
        return "blocked";
      }
      let outcome = "DRAFT_CREATED";
      if (schedule.invoiceMode === "FINALIZE") {
        if (invoice.status === "DRAFT" || invoice.status === "APPROVED") {
          await this.invoiceService.finalize(context, invoice.id, invoice.version, issueDate, key);
        }
        outcome = "FINALIZED";
      }
      if (schedule.invoiceMode === "SEND") {
        if (!this.emailDeliveryAvailable) {
          outcome = "DRAFT_EMAIL_UNAVAILABLE";
        } else {
          if (invoice.status === "DRAFT" || invoice.status === "APPROVED") {
            await this.invoiceService.finalize(
              context,
              invoice.id,
              invoice.version,
              issueDate,
              key
            );
          }
          await this.invoiceDocumentService.queueSend(
            context,
            invoice.id,
            {},
            `recurring-send:${key}`
          );
          outcome = "FINALIZED_AND_QUEUED";
        }
      }
      await this.completeOccurrence(
        context,
        claimed.id,
        schedule,
        occurrenceAt,
        invoice.id,
        outcome
      );
      return "created";
    } catch (error) {
      const code = error instanceof AppError ? error.code : "RECURRING_MATERIALIZATION_FAILED";
      if (BLOCKING_CODES.has(code)) {
        await this.blockOccurrence(context, claimed.id, schedule, occurrenceAt, code);
        return "blocked";
      }
      await this.failOccurrence(context, claimed.id, errorMessage(error));
      return "failed";
    }
  }

  private async findOrCreateInvoice(context: OrganizationContext, input: InvoiceCreateInput) {
    const existing = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoice.findFirst({
        where: {
          organizationId: context.organizationId,
          ...(input.recurrenceIdempotencyKey
            ? { recurrenceIdempotencyKey: input.recurrenceIdempotencyKey }
            : {})
        },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      })
    );
    if (existing)
      return {
        id: existing.id,
        version: existing.version,
        status: existing.status,
        automationBlockingReason: existing.automationBlockingReason
      };
    return this.invoiceService.create(context, input);
  }

  private async claimOccurrence(
    context: OrganizationContext,
    schedule: Prisma.RecurringScheduleGetPayload<Prisma.RecurringScheduleDefaultArgs>,
    occurrenceAt: Date
  ) {
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const existing = await tx.recurringScheduleOccurrence.findUnique({
        where: {
          organizationId_scheduleId_occurrenceAt: {
            organizationId: context.organizationId,
            scheduleId: schedule.id,
            occurrenceAt
          }
        }
      });
      if (
        existing?.status === "SUCCEEDED" ||
        existing?.status === "BLOCKED" ||
        existing?.status === "SKIPPED"
      )
        return null;
      if (
        existing &&
        existing.status === "PROCESSING" &&
        Date.now() - existing.updatedAt.getTime() < STALE_OCCURRENCE_MS
      )
        return null;
      if (existing) {
        return tx.recurringScheduleOccurrence.update({
          where: { id: existing.id },
          data: { status: "PROCESSING", failureReason: null }
        });
      }
      try {
        return await tx.recurringScheduleOccurrence.create({
          data: {
            organizationId: context.organizationId,
            scheduleId: schedule.id,
            occurrenceAt,
            status: "PROCESSING"
          }
        });
      } catch (error) {
        if (isUnique(error)) return null;
        throw error;
      }
    });
  }

  private async recordSkipped(
    context: OrganizationContext,
    schedule: Prisma.RecurringScheduleGetPayload<Prisma.RecurringScheduleDefaultArgs>,
    occurrenceAt: Date
  ) {
    try {
      await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
        tx.recurringScheduleOccurrence.create({
          data: {
            organizationId: context.organizationId,
            scheduleId: schedule.id,
            occurrenceAt,
            status: "SKIPPED",
            outcome: "MISSED_OCCURRENCE_SKIPPED_BY_POLICY"
          }
        })
      );
      return true;
    } catch (error) {
      if (isUnique(error)) return false;
      throw error;
    }
  }

  private async completeOccurrence(
    context: OrganizationContext,
    occurrenceId: string,
    schedule: Prisma.RecurringScheduleGetPayload<Prisma.RecurringScheduleDefaultArgs>,
    occurrenceAt: Date,
    invoiceId: string,
    outcome: string
  ) {
    await this.advanceSchedule(context, occurrenceId, schedule, occurrenceAt, {
      status: "SUCCEEDED",
      invoiceId,
      outcome,
      lastError: null
    });
  }

  private async blockOccurrence(
    context: OrganizationContext,
    occurrenceId: string,
    schedule: Prisma.RecurringScheduleGetPayload<Prisma.RecurringScheduleDefaultArgs>,
    occurrenceAt: Date,
    reason: string
  ) {
    await this.advanceSchedule(context, occurrenceId, schedule, occurrenceAt, {
      status: "BLOCKED",
      blockingReason: reason,
      outcome: "DRAFT_OR_MATERIALIZATION_BLOCKED",
      lastError: reason
    });
  }

  private async advanceSchedule(
    context: OrganizationContext,
    occurrenceId: string,
    schedule: Prisma.RecurringScheduleGetPayload<Prisma.RecurringScheduleDefaultArgs>,
    occurrenceAt: Date,
    outcome: {
      status: string;
      invoiceId?: string;
      outcome: string;
      blockingReason?: string;
      lastError: string | null;
    }
  ) {
    const nextRunAt = nextRecurrenceDate(occurrenceAt, scheduleRule(schedule));
    const ended = schedule.endAt !== null && nextRunAt > schedule.endAt;
    await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const occurrenceData = {
        status: outcome.status,
        outcome: outcome.outcome,
        blockingReason: outcome.blockingReason ?? null,
        ...(outcome.invoiceId ? { invoiceId: outcome.invoiceId } : {})
      };
      await tx.recurringScheduleOccurrence.update({
        where: { id: occurrenceId },
        data: occurrenceData
      });
      await tx.recurringSchedule.update({
        where: { id: schedule.id },
        data: {
          nextRunAt: ended ? nextRunAt : nextRunAt,
          status: ended ? "ENDED" : "ACTIVE",
          lastRunAt: occurrenceAt,
          lastError: outcome.lastError
        }
      });
    });
  }

  private async failOccurrence(context: OrganizationContext, occurrenceId: string, reason: string) {
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.recurringScheduleOccurrence.update({
        where: { id: occurrenceId },
        data: { status: "FAILED", failureReason: reason.slice(0, 4000) }
      })
    );
  }
}

function dueOccurrenceDates(schedule: ScheduleFields, now: Date, limit: number) {
  const dates: Date[] = [];
  let next = new Date(schedule.nextRunAt);
  while (next <= now && dates.length < Math.max(1, limit)) {
    if (!schedule.endAt || next <= schedule.endAt) dates.push(next);
    next = nextRecurrenceDate(next, scheduleRule(schedule));
  }
  return dates;
}

function scheduleRule(
  schedule: Pick<ScheduleFields, "frequency" | "interval" | "dayOfMonth" | "timeZone">
) {
  return {
    frequency: schedule.frequency,
    interval: schedule.interval,
    timeZone: schedule.timeZone,
    ...(schedule.dayOfMonth === null ? {} : { dayOfMonth: schedule.dayOfMonth })
  } as const;
}

function localDate(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = values.year;
  const month = values.month;
  const day = values.day;
  if (!year || !month || !day)
    throw new AppError(
      "RECURRING_TIMEZONE_INVALID",
      "The schedule timezone did not produce a calendar date.",
      422
    );
  return [year, month, day].join("-");
}

function invoiceTemplate(value: Prisma.JsonValue): InvoiceCreateInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError(
      "RECURRING_TEMPLATE_INVALID",
      "The recurring invoice template is invalid.",
      422
    );
  const template = value as Record<string, unknown>;
  const rawLines = Array.isArray(template.lines) ? template.lines : [];
  if (!rawLines.length)
    throw new AppError(
      "RECURRING_TEMPLATE_LINES_REQUIRED",
      "Add at least one invoice line to the recurring template.",
      422
    );
  return {
    customerId: typeof template.customerId === "string" ? template.customerId : "",
    issueDate: "1970-01-01",
    currency: typeof template.currency === "string" ? template.currency : "CAD",
    dueDate: typeof template.dueDate === "string" ? template.dueDate : undefined,
    paymentTermsDays:
      typeof template.paymentTermsDays === "number" ? template.paymentTermsDays : undefined,
    fxRateSnapshotId:
      typeof template.fxRateSnapshotId === "string" ? template.fxRateSnapshotId : undefined,
    lines: rawLines.map((line) => {
      if (!line || typeof line !== "object" || Array.isArray(line))
        throw new AppError(
          "RECURRING_TEMPLATE_LINE_INVALID",
          "A recurring invoice line is invalid.",
          422
        );
      const row = line as Record<string, unknown>;
      return {
        productItemId: typeof row.productItemId === "string" ? row.productItemId : null,
        description: typeof row.description === "string" ? row.description : undefined,
        quantity: scalarString(row.quantity) ?? "1",
        unitPriceMinor: scalarString(row.unitPriceMinor),
        discountMinor: scalarString(row.discountMinor) ?? "0",
        taxCodeId: typeof row.taxCodeId === "string" ? row.taxCodeId : null,
        incomeAccountId: typeof row.incomeAccountId === "string" ? row.incomeAccountId : null
      };
    }),
    customerFacingNotes:
      typeof template.customerFacingNotes === "string" ? template.customerFacingNotes : undefined,
    internalNotes: typeof template.internalNotes === "string" ? template.internalNotes : undefined,
    terms: typeof template.terms === "string" ? template.terms : undefined,
    paymentMethodSelection: Array.isArray(template.paymentMethodSelection)
      ? template.paymentMethodSelection.filter(
          (value): value is string => typeof value === "string"
        )
      : undefined
  };
}

function scalarString(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function scheduleDto(schedule: RecurringScheduleRow) {
  const nextDates: string[] = [];
  let next = new Date(schedule.nextRunAt);
  for (let index = 0; index < 3; index += 1) {
    if (schedule.endAt && next > schedule.endAt) break;
    nextDates.push(next.toISOString());
    next = nextRecurrenceDate(next, scheduleRule(schedule));
  }
  return {
    ...schedule,
    nextDates,
    history: schedule.occurrences
  };
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function isUnique(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Recurring invoice materialization failed.";
}
