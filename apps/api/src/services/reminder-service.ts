import { Prisma, withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { InvoiceDocumentService } from "./invoice-document-service.js";

const DEFAULT_OFFSETS = [-3, 0, 7, 14] as const;
const POSTED_STATUSES = ["POSTED", "PARTIALLY_PAID", "OVERDUE", "PARTIALLY_CREDITED"] as const;

export interface ReminderMessageInput {
  readonly recipientEmail?: string | undefined;
  readonly subject?: string | undefined;
  readonly message?: string | null | undefined;
  readonly tone?: "FRIENDLY" | "FIRM" | undefined;
}

export class ReminderService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly invoiceDocuments: InvoiceDocumentService,
    private readonly emailDeliveryEnabled = false,
    private readonly now: () => Date = () => new Date()
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async settings(context: OrganizationContext) {
    await this.authorization.assert(context, "receivables:read", "ReminderSettings");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const settings = await tx.organizationSettings.findUnique({
        where: { organizationId: context.organizationId }
      });
      return settingsDto(settings);
    });
  }

  public async updateSettings(
    context: OrganizationContext,
    input: {
      readonly version: number;
      readonly enabled?: boolean | undefined;
      readonly tone?: "FRIENDLY" | "FIRM" | undefined;
      readonly offsets?: readonly number[] | undefined;
      readonly quietStartHour?: number | undefined;
      readonly quietEndHour?: number | undefined;
    }
  ) {
    await this.authorization.assert(context, "settings:write", "ReminderSettings");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const updated = await tx.organizationSettings.updateMany({
        where: { organizationId: context.organizationId, version: input.version },
        data: {
          ...(input.enabled === undefined ? {} : { reminderAutomationEnabled: input.enabled }),
          ...(input.tone === undefined ? {} : { reminderTone: input.tone }),
          ...(input.offsets === undefined ? {} : { reminderOffsets: input.offsets.slice() }),
          ...(input.quietStartHour === undefined
            ? {}
            : { reminderQuietStartHour: input.quietStartHour }),
          ...(input.quietEndHour === undefined ? {} : { reminderQuietEndHour: input.quietEndHour }),
          version: { increment: 1 }
        }
      });
      if (updated.count !== 1)
        throw new AppError("STALE_REMINDER_SETTINGS", "Reminder settings were changed.", 409);
      return settingsDto(
        await tx.organizationSettings.findUniqueOrThrow({
          where: { organizationId: context.organizationId }
        })
      );
    });
  }

  public async overdue(context: OrganizationContext, asOf?: string) {
    await this.authorization.assert(context, "receivables:read", "OverdueReceivables");
    const asOfDate = asOf ? parseDate(asOf, "asOf") : this.now();
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: {
          organizationId: context.organizationId,
          status: { in: [...POSTED_STATUSES] },
          dueDate: { lt: asOfDate },
          issueDate: { lte: asOfDate },
          customer: { active: true, archivedAt: null }
        },
        include: {
          customer: {
            select: { id: true, displayName: true, email: true, reminderDisabled: true }
          },
          creditNotes: {
            where: { status: "POSTED", issueDate: { lte: asOfDate } },
            select: { grandTotalMinor: true }
          }
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }]
      });
      return invoices
        .map((invoice) => {
          const credited = invoice.creditNotes.reduce(
            (sum, note) => sum + note.grandTotalMinor,
            0n
          );
          const outstanding = maxBigInt(
            0n,
            invoice.grandTotalMinor - credited - invoice.amountPaidMinor
          );
          const ageDays = Math.max(
            1,
            Math.floor((asOfDate.getTime() - invoice.dueDate.getTime()) / 86_400_000)
          );
          return {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber ?? invoice.provisionalIdentifier,
            customerId: invoice.customerId,
            customerName: invoice.customer.displayName,
            recipientEmail: invoice.customerEmailSnapshot ?? invoice.customer.email,
            dueDate: serializeDate(invoice.dueDate),
            currency: invoice.currency.trim(),
            outstandingMinor: outstanding.toString(),
            ageDays,
            bucket:
              ageDays <= 30 ? "1-30" : ageDays <= 60 ? "31-60" : ageDays <= 90 ? "61-90" : "90+",
            reminderDisabled: invoice.reminderDisabled || invoice.customer.reminderDisabled,
            canRemind:
              outstanding > 0n && !invoice.reminderDisabled && !invoice.customer.reminderDisabled
          };
        })
        .filter((invoice) => BigInt(invoice.outstandingMinor) > 0n);
    });
  }

  public async sendManual(
    context: OrganizationContext,
    invoiceId: string,
    input: ReminderMessageInput,
    manualFallback = !this.emailDeliveryEnabled
  ) {
    await this.authorization.assert(context, "invoices:send", "Invoice", invoiceId);
    const invoice = await this.findRemindableInvoice(context, invoiceId);
    const recipientEmail = normalizeRecipient(
      input.recipientEmail ?? invoice.customerEmailSnapshot ?? invoice.customer.email ?? ""
    );
    if (!recipientEmail)
      throw new AppError("INVOICE_RECIPIENT_INVALID", "A valid customer email is required.", 422);
    const tone = normalizeTone(input.tone ?? invoice.customer.reminderTone);
    const subject =
      input.subject?.trim() ||
      `Payment reminder: ${invoice.invoiceNumber ?? invoice.provisionalIdentifier}`;
    const message = input.message?.trim() || reminderMessage(invoice, tone);
    const delivery = manualFallback
      ? await this.invoiceDocuments.recordManualDelivery(
          context,
          invoiceId,
          { recipientEmails: [recipientEmail], subject, message },
          context.requestId
        )
      : await this.invoiceDocuments.queueSend(
          context,
          invoiceId,
          { recipientEmail, subject, message },
          context.requestId
        );
    await this.recordCommunication(context, invoiceId, invoice.customerId, {
      status: manualFallback ? "SENT" : "QUEUED",
      deduplicationKey: `manual-reminder:${invoiceId}:${context.requestId}`,
      tone,
      channel: manualFallback ? "OWN_EMAIL_APP" : "EMAIL_PROVIDER",
      deliveryId: delivery.resourceId ?? null
    });
    return { ...delivery.body, reminder: { manualFallback, tone, recipientEmail } };
  }

  public async sendDue(context: OrganizationContext, limit: number) {
    const settings = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.organizationSettings.findUnique({ where: { organizationId: context.organizationId } })
    );
    if (!settings?.reminderAutomationEnabled) return { checked: 0, sent: 0, skipped: 0, failed: 0 };
    const now = this.now();
    const quietHour = localHour(now, settings.timeZone);
    if (
      !withinQuietHours(quietHour, settings.reminderQuietStartHour, settings.reminderQuietEndHour)
    )
      return { checked: 0, sent: 0, skipped: 0, failed: 0, quietHours: true };
    const offsets = readOffsets(settings.reminderOffsets);
    const today = localDate(now, settings.timeZone);
    const invoices = await this.overdueCandidates(context, now, limit, offsets);
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const invoice of invoices) {
      const credited = invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
      const outstanding = maxBigInt(
        0n,
        invoice.grandTotalMinor - credited - invoice.amountPaidMinor
      );
      if (outstanding === 0n) {
        skipped++;
        continue;
      }
      const invoiceOffsets = readOffsets(
        invoice.customer.reminderOffsets ?? settings.reminderOffsets
      );
      const offset = reminderOffset(now, invoice.dueDate, invoiceOffsets, settings.timeZone);
      if (offset === null || invoice.reminderDisabled || invoice.customer.reminderDisabled) {
        skipped++;
        continue;
      }
      const deduplicationKey = `scheduled-reminder:${invoice.id}:${today}`;
      const claimed = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        try {
          await tx.communication.create({
            data: {
              organizationId: context.organizationId,
              customerId: invoice.customerId,
              invoiceId: invoice.id,
              kind: "REMINDER",
              channel: "EMAIL_PROVIDER",
              deduplicationKey,
              status: "QUEUED",
              createdByUserId: context.user.id,
              payload: {
                offset,
                runId: context.requestId,
                tone: normalizeTone(invoice.customer.reminderTone ?? settings.reminderTone)
              }
            }
          });
          return true;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
            return false;
          throw error;
        }
      });
      if (!claimed) {
        skipped++;
        continue;
      }
      try {
        const recipientEmail = normalizeRecipient(
          invoice.customerEmailSnapshot ?? invoice.customer.email ?? ""
        );
        if (!recipientEmail)
          throw new AppError("INVOICE_RECIPIENT_INVALID", "Customer email is missing.", 422);
        await this.invoiceDocuments.queueSend(
          context,
          invoice.id,
          {
            recipientEmail,
            subject: `Payment reminder: ${invoice.invoiceNumber ?? invoice.provisionalIdentifier}`,
            message: reminderMessage(
              invoice,
              normalizeTone(invoice.customer.reminderTone ?? settings.reminderTone)
            )
          },
          `${context.requestId}:${invoice.id}`
        );
        sent++;
      } catch (error) {
        failed++;
        await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
          tx.communication.updateMany({
            where: { organizationId: context.organizationId, deduplicationKey },
            data: {
              status: "FAILED",
              lastError: error instanceof Error ? error.message.slice(0, 500) : "Reminder failed."
            }
          })
        );
      }
    }
    return { checked: invoices.length, sent, skipped, failed };
  }

  private async overdueCandidates(
    context: OrganizationContext,
    asOf: Date,
    limit: number,
    offsets: readonly number[]
  ) {
    // Customer overrides are bounded by the request schema (-90..365). Include the
    // complete supported window here, then apply the effective offsets per invoice.
    // This keeps a customer override from being silently missed by the batch query.
    const earliestOffset = Math.min(-90, ...offsets);
    const latestOffset = Math.max(365, ...offsets);
    const dayStart = startOfDay(asOf).getTime();
    const earliestDueDate = new Date(dayStart - latestOffset * 86_400_000);
    const latestDueDate = new Date(dayStart - earliestOffset * 86_400_000);
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoice.findMany({
        where: {
          organizationId: context.organizationId,
          status: { in: [...POSTED_STATUSES] },
          dueDate: { gte: earliestDueDate, lte: latestDueDate },
          issueDate: { lte: asOf },
          reminderDisabled: false,
          customer: { active: true, archivedAt: null, reminderDisabled: false }
        },
        include: {
          customer: {
            select: {
              id: true,
              displayName: true,
              email: true,
              reminderDisabled: true,
              reminderTone: true,
              reminderOffsets: true
            }
          },
          creditNotes: {
            where: { status: "POSTED", issueDate: { lte: asOf } },
            select: { grandTotalMinor: true }
          }
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: Math.max(limit * 25, 500)
      })
    );
  }

  private async findRemindableInvoice(context: OrganizationContext, invoiceId: string) {
    const invoice = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: context.organizationId },
        include: {
          customer: {
            select: {
              id: true,
              displayName: true,
              email: true,
              active: true,
              archivedAt: true,
              reminderDisabled: true,
              reminderTone: true
            }
          },
          creditNotes: { where: { status: "POSTED" }, select: { grandTotalMinor: true } }
        }
      })
    );
    if (!invoice) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
    const credited = invoice.creditNotes.reduce((sum, note) => sum + note.grandTotalMinor, 0n);
    const outstanding = maxBigInt(0n, invoice.grandTotalMinor - credited - invoice.amountPaidMinor);
    if (!(POSTED_STATUSES as readonly string[]).includes(invoice.status) || outstanding === 0n)
      throw new AppError(
        "INVOICE_NOT_REMINDABLE",
        "Only unpaid finalized invoices can be reminded.",
        409
      );
    if (
      !invoice.customer.active ||
      invoice.customer.archivedAt ||
      invoice.customer.reminderDisabled ||
      invoice.reminderDisabled
    )
      throw new AppError(
        "INVOICE_REMINDER_SUPPRESSED",
        "Reminders are disabled for this customer or invoice.",
        409
      );
    return invoice;
  }

  private async recordCommunication(
    context: OrganizationContext,
    invoiceId: string,
    customerId: string,
    input: {
      readonly status: "SENT" | "QUEUED";
      readonly deduplicationKey: string;
      readonly tone: string;
      readonly channel: string;
      readonly deliveryId: string | null;
    }
  ) {
    await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.communication.create({
        data: {
          organizationId: context.organizationId,
          customerId,
          invoiceId,
          kind: "REMINDER",
          channel: input.channel,
          deduplicationKey: input.deduplicationKey,
          status: input.status,
          sentAt: input.status === "SENT" ? this.now() : null,
          createdByUserId: context.user.id,
          payload: { tone: input.tone, deliveryId: input.deliveryId, requestId: context.requestId }
        }
      })
    );
  }
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function settingsDto(
  settings: {
    version: number;
    reminderAutomationEnabled: boolean;
    reminderTone: string;
    reminderOffsets: Prisma.JsonValue | null;
    reminderQuietStartHour: number;
    reminderQuietEndHour: number;
  } | null
) {
  if (!settings)
    return {
      version: 1,
      enabled: false,
      tone: "FRIENDLY",
      offsets: [...DEFAULT_OFFSETS],
      quietStartHour: 8,
      quietEndHour: 20
    };
  return {
    version: settings.version,
    enabled: settings.reminderAutomationEnabled,
    tone: settings.reminderTone,
    offsets: readOffsets(settings.reminderOffsets),
    quietStartHour: settings.reminderQuietStartHour,
    quietEndHour: settings.reminderQuietEndHour
  };
}

function readOffsets(value: Prisma.JsonValue | null): number[] {
  if (!Array.isArray(value)) return [...DEFAULT_OFFSETS];
  const offsets = value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isInteger(entry)
  );
  return offsets.length
    ? [...new Set(offsets)].sort((left, right) => left - right)
    : [...DEFAULT_OFFSETS];
}

function reminderOffset(now: Date, dueDate: Date, offsets: readonly number[], timeZone: string) {
  const today = localDate(now, timeZone);
  const due = dueDate.toISOString().slice(0, 10);
  const days = Math.floor(
    (Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${due}T00:00:00.000Z`)) / 86_400_000
  );
  return offsets.includes(days) ? days : null;
}

function reminderMessage(
  invoice: {
    invoiceNumber: string | null;
    provisionalIdentifier: string;
    customer: { displayName: string };
  },
  tone: "FRIENDLY" | "FIRM"
) {
  const number = invoice.invoiceNumber ?? invoice.provisionalIdentifier;
  return tone === "FIRM"
    ? `Hello ${invoice.customer.displayName},\n\nInvoice ${number} remains unpaid. Please arrange payment or contact us if there is an issue.\n\nThank you.`
    : `Hello ${invoice.customer.displayName},\n\nJust a friendly reminder that invoice ${number} is still outstanding. Please let us know if you need anything to complete payment.\n\nThank you.`;
}

function normalizeRecipient(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : null;
}

function normalizeTone(value: string | null | undefined): "FRIENDLY" | "FIRM" {
  return value === "FIRM" ? "FIRM" : "FRIENDLY";
}

function localDate(value: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(value);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function localHour(value: Date, timeZone: string): number {
  try {
    return Number(
      new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(value)
    );
  } catch {
    return value.getUTCHours();
  }
}

function withinQuietHours(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function startOfDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function maxBigInt(left: bigint, right: bigint) {
  return left > right ? left : right;
}
