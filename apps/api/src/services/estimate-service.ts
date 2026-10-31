import { randomUUID } from "node:crypto";
import {
  Prisma,
  withPublicInvoiceTransaction,
  withTenantTransaction,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import {
  AppError,
  assertEstimateTransition,
  estimateConversionIdempotencyKey,
  nextRecurrenceDate,
  recurrenceRunIdempotencyKey
} from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { createOpaqueToken, hashOpaqueToken } from "../auth/security.js";
import { withAuditOrigin } from "../utils/audit.js";
import { parseDate, serializeDate } from "../utils/dates.js";
import { addressSnapshot } from "./customer-address.js";
import { runIdempotent } from "./idempotency-service.js";
import {
  calculateLine,
  type CalculatedLine,
  type LineCalculationInput
} from "./invoice-calculation.js";
import { derivePaymentReference } from "./payment-reference-code.js";

export interface EstimateCreateInput {
  readonly customerId: string;
  readonly issueDate: string;
  readonly expiryDate?: string | null | undefined;
  readonly estimateNumber?: string | null | undefined;
  readonly currency: "CAD";
  readonly lines: readonly LineCalculationInput[];
  readonly customerFacingNotes?: string | null | undefined;
  readonly internalNotes?: string | null | undefined;
  readonly terms?: string | null | undefined;
}

export type EstimateUpdateInput = Omit<EstimateCreateInput, "estimateNumber"> & {
  readonly version: number;
};

export interface RecurringScheduleInput {
  readonly scheduleType: "INVOICE" | "BILL";
  readonly customerId?: string | null | undefined;
  readonly frequency: "WEEK" | "MONTH" | "YEAR";
  readonly interval: number;
  readonly dayOfMonth?: number | null | undefined;
  readonly timeZone: string;
  readonly startAt: string;
  readonly endAt?: string | null | undefined;
  readonly missedOccurrencePolicy?: "EVERY" | "LATEST" | undefined;
  readonly invoiceMode?: "DRAFT" | "FINALIZE" | "SEND" | undefined;
  readonly template: Record<string, unknown>;
}

export interface RecurringSchedulePatch {
  readonly version: number;
  readonly scheduleType?: RecurringScheduleInput["scheduleType"] | undefined;
  readonly customerId?: string | null | undefined;
  readonly frequency?: RecurringScheduleInput["frequency"] | undefined;
  readonly interval?: number | undefined;
  readonly dayOfMonth?: number | null | undefined;
  readonly timeZone?: string | undefined;
  readonly startAt?: string | undefined;
  readonly endAt?: string | null | undefined;
  readonly missedOccurrencePolicy?: "EVERY" | "LATEST" | undefined;
  readonly invoiceMode?: "DRAFT" | "FINALIZE" | "SEND" | undefined;
  readonly template?: Record<string, unknown> | undefined;
}

export class EstimateService {
  private readonly authorization: AuthorizationService;

  public constructor(private readonly prisma: PrismaClient) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async list(context: OrganizationContext, status?: string) {
    await this.authorization.assert(context, "estimates:read", "Estimate");
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const rows = await tx.estimate.findMany({
        where: {
          organizationId: context.organizationId,
          ...(status ? { status: status as never } : {})
        },
        include: { lines: { orderBy: { lineNumber: "asc" } } },
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
        take: 200
      });
      return rows.map(estimateDto);
    });
  }

  public async get(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "estimates:read", "Estimate", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.estimate.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } }, convertedInvoice: true }
      })
    );
    if (!row) throw new AppError("ESTIMATE_NOT_FOUND", "Estimate was not found.", 404);
    return estimateDto(row);
  }

  public async preview(context: OrganizationContext, id: string) {
    await this.authorization.assert(context, "estimates:read", "Estimate", id);
    const row = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.estimate.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      })
    );
    if (!row) throw new AppError("ESTIMATE_NOT_FOUND", "Estimate was not found.", 404);
    return { html: renderPublicEstimateHtml(row, "preview", false) };
  }

  public async create(
    context: OrganizationContext,
    input: EstimateCreateInput,
    idempotencyKey?: string
  ) {
    await this.authorization.assert(context, "estimates:create", "Estimate");
    const createDraft = async (tx: Prisma.TransactionClient) => {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: context.organizationId, active: true },
        include: { addresses: { orderBy: { createdAt: "asc" } } }
      });
      if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
      const issueDate = parseDate(input.issueDate, "issueDate");
      const expiryDate = input.expiryDate ? parseDate(input.expiryDate, "expiryDate") : null;
      if (expiryDate && expiryDate < issueDate)
        throw new AppError(
          "ESTIMATE_EXPIRY_INVALID",
          "Estimate expiry cannot precede its issue date.",
          422
        );
      const lines = await calculateLines(tx, context.organizationId, issueDate, input.lines);
      const organizationSnapshot = await organizationSnapshotFor(tx, context.organizationId);
      const totals = lineTotals(lines);
      const estimateNumber = await reserveEstimateNumber(
        tx,
        context.organizationId,
        input.estimateNumber
      );
      const estimate = await tx.estimate.create({
        data: {
          organizationId: context.organizationId,
          customerId: customer.id,
          estimateNumber,
          provisionalIdentifier: `ESTIMATE-DRAFT-${randomUUID()}`,
          issueDate,
          expiryDate,
          currency: input.currency,
          subtotalMinor: totals.subtotalMinor,
          discountTotalMinor: totals.discountTotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          grandTotalMinor: totals.grandTotalMinor,
          customerNameSnapshot: customer.displayName,
          customerEmailSnapshot: customer.email,
          billingAddressSnapshot: addressSnapshot(customer.addresses, "BILLING") ?? Prisma.JsonNull,
          organizationSnapshot,
          customerFacingNotes: input.customerFacingNotes ?? null,
          internalNotes: input.internalNotes ?? null,
          terms: input.terms ?? null,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await tx.estimateLine.createMany({
        data: lines.map((line, index) =>
          estimateLineData(context.organizationId, estimate.id, index + 1, line)
        )
      });
      await audit(tx, context, "ESTIMATE_DRAFT_CREATED", "Estimate", estimate.id, {
        lineCount: lines.length
      });
      return estimateDto(
        await tx.estimate.findUniqueOrThrow({
          where: { id: estimate.id },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        })
      );
    };
    if (!idempotencyKey?.trim())
      return withTenantTransaction(this.prisma, dbContext(context), createDraft);
    const result = await runIdempotent(
      this.prisma,
      context,
      "estimates.create",
      idempotencyKey,
      input,
      async (tx) => {
        const estimate = await createDraft(tx);
        return {
          statusCode: 201,
          body: { estimate } as never,
          resourceId: estimate.id
        };
      }
    );
    return (result.body as unknown as { estimate: ReturnType<typeof estimateDto> }).estimate;
  }

  public async update(context: OrganizationContext, id: string, input: EstimateUpdateInput) {
    await this.authorization.assert(context, "estimates:manage", "Estimate", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.estimate.findFirst({
        where: { id, organizationId: context.organizationId },
        include: { lines: true }
      });
      if (!current) throw new AppError("ESTIMATE_NOT_FOUND", "Estimate was not found.", 404);
      if (!["DRAFT", "SENT", "VIEWED"].includes(current.status))
        throw new AppError("ESTIMATE_IMMUTABLE", "Only editable estimates can be changed.", 409);
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, organizationId: context.organizationId, active: true },
        include: { addresses: { orderBy: { createdAt: "asc" } } }
      });
      if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
      const issueDate = parseDate(input.issueDate, "issueDate");
      const expiryDate = input.expiryDate ? parseDate(input.expiryDate, "expiryDate") : null;
      if (expiryDate && expiryDate < issueDate)
        throw new AppError(
          "ESTIMATE_EXPIRY_INVALID",
          "Estimate expiry cannot precede its issue date.",
          422
        );
      const lines = await calculateLines(tx, context.organizationId, issueDate, input.lines);
      const totals = lineTotals(lines);
      const changed = await tx.estimate.updateMany({
        where: { id, organizationId: context.organizationId, version: input.version },
        data: {
          customerId: customer.id,
          issueDate,
          expiryDate,
          currency: input.currency,
          subtotalMinor: totals.subtotalMinor,
          discountTotalMinor: totals.discountTotalMinor,
          taxTotalMinor: totals.taxTotalMinor,
          grandTotalMinor: totals.grandTotalMinor,
          customerNameSnapshot: customer.displayName,
          customerEmailSnapshot: customer.email,
          billingAddressSnapshot: addressSnapshot(customer.addresses, "BILLING") ?? Prisma.JsonNull,
          customerFacingNotes: input.customerFacingNotes ?? null,
          internalNotes: input.internalNotes ?? null,
          terms: input.terms ?? null,
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError("STALE_ESTIMATE", "Estimate was changed by another request.", 409);
      await tx.estimateLine.deleteMany({
        where: { estimateId: id, organizationId: context.organizationId }
      });
      await tx.estimateLine.createMany({
        data: lines.map((line, index) =>
          estimateLineData(context.organizationId, id, index + 1, line)
        )
      });
      await audit(tx, context, "ESTIMATE_UPDATED", "Estimate", id, { lineCount: lines.length });
      return estimateDto(
        await tx.estimate.findUniqueOrThrow({
          where: { id },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        })
      );
    });
  }

  public async transition(
    context: OrganizationContext,
    id: string,
    next: "SENT" | "VIEWED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "CANCELLED",
    version: number,
    reason?: string | null
  ) {
    await this.authorization.assert(context, "estimates:manage", "Estimate", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.estimate.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!current) throw new AppError("ESTIMATE_NOT_FOUND", "Estimate was not found.", 404);
      assertEstimateTransition(current.status, next);
      const updated = await tx.estimate.updateMany({
        where: { id, organizationId: context.organizationId, version },
        data: {
          status: next,
          version: { increment: 1 },
          ...(next === "ACCEPTED" ? { acceptedAt: new Date() } : {}),
          ...(next === "DECLINED"
            ? { declinedAt: new Date(), internalNotes: reason ?? current.internalNotes }
            : {}),
          updatedByUserId: context.user.id
        }
      });
      if (updated.count !== 1)
        throw new AppError("STALE_ESTIMATE", "Estimate was changed by another request.", 409);
      await audit(tx, context, `ESTIMATE_${next}`, "Estimate", id, { reason: reason ?? null });
      return estimateDto(
        await tx.estimate.findUniqueOrThrow({
          where: { id },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        })
      );
    });
  }

  public async convert(
    context: OrganizationContext,
    id: string,
    version: number,
    issueDate?: string
  ) {
    await this.authorization.assert(context, "estimates:create", "Estimate", id);
    const key = estimateConversionIdempotencyKey(id, version);
    return runIdempotent(
      this.prisma,
      context,
      "estimate.convert",
      key,
      { id, version, issueDate },
      async (tx) => {
        const estimate = await tx.estimate.findFirst({
          where: { id, organizationId: context.organizationId },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        if (!estimate) throw new AppError("ESTIMATE_NOT_FOUND", "Estimate was not found.", 404);
        if (estimate.status === "CONVERTED") {
          const existing = await tx.invoice.findFirst({
            where: { organizationId: context.organizationId, sourceEstimateId: estimate.id },
            select: { id: true }
          });
          if (existing)
            return {
              statusCode: 200,
              body: { invoiceId: existing.id, estimateId: id },
              resourceId: existing.id
            };
        }
        if (estimate.status !== "ACCEPTED")
          throw new AppError(
            "ESTIMATE_NOT_ACCEPTED",
            "Only accepted estimates can be converted.",
            409
          );
        if (estimate.version !== version)
          throw new AppError("STALE_ESTIMATE", "Estimate was changed by another request.", 409);
        const activeProgressPlan = await tx.progressBillingPlan.findFirst({
          where: {
            organizationId: context.organizationId,
            estimateId: estimate.id,
            status: { in: ["DRAFT", "SUBMITTED", "APPROVED"] }
          },
          select: { id: true }
        });
        if (activeProgressPlan)
          throw new AppError(
            "ESTIMATE_HAS_ACTIVE_PROGRESS_PLAN",
            "Cancel the active progress-billing plan before converting this estimate in full.",
            409
          );
        const customer = await tx.customer.findFirst({
          where: { id: estimate.customerId, organizationId: context.organizationId }
        });
        if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
        const effectiveIssueDate = issueDate
          ? parseDate(issueDate, "issueDate")
          : estimate.issueDate;
        const provisionalIdentifier = `DRAFT-${randomUUID()}`;
        const invoice = await tx.invoice.create({
          data: {
            organizationId: context.organizationId,
            customerId: estimate.customerId,
            sourceEstimateId: estimate.id,
            provisionalIdentifier,
            paymentReference: derivePaymentReference(
              `${context.organizationId}:${provisionalIdentifier}`
            ),
            issueDate: effectiveIssueDate,
            dueDate: addDays(effectiveIssueDate, customer.defaultPaymentTermsDays),
            paymentTermsDays: customer.defaultPaymentTermsDays,
            currency: estimate.currency,
            subtotalMinor: estimate.subtotalMinor,
            discountTotalMinor: estimate.discountTotalMinor,
            taxTotalMinor: estimate.taxTotalMinor,
            grandTotalMinor: estimate.grandTotalMinor,
            customerNameSnapshot: estimate.customerNameSnapshot,
            customerEmailSnapshot: estimate.customerEmailSnapshot,
            billingAddressSnapshot: estimate.billingAddressSnapshot ?? Prisma.JsonNull,
            organizationSnapshot: estimate.organizationSnapshot as Prisma.InputJsonValue,
            customerFacingNotes: estimate.customerFacingNotes,
            internalNotes: estimate.internalNotes,
            terms: estimate.terms,
            createdByUserId: context.user.id,
            updatedByUserId: context.user.id
          }
        });
        await tx.invoiceLine.createMany({
          data: estimate.lines.map((line) => ({
            organizationId: context.organizationId,
            invoiceId: invoice.id,
            lineNumber: line.lineNumber,
            productItemId: line.productItemId,
            description: line.description,
            quantityMicros: line.quantityMicros,
            unitPriceMinor: line.unitPriceMinor,
            grossAmountMinor: line.grossAmountMinor,
            discountMinor: line.discountMinor,
            netAmountMinor: line.netAmountMinor,
            taxableAmountMinor: line.taxableAmountMinor,
            taxTotalMinor: line.taxTotalMinor,
            totalMinor: line.totalMinor,
            taxCodeId: line.taxCodeId,
            taxSnapshot: line.taxSnapshot ?? Prisma.JsonNull,
            incomeAccountId: line.incomeAccountId,
            incomeAccountCode: line.incomeAccountCode,
            incomeAccountName: line.incomeAccountName
          }))
        });
        const marked = await tx.estimate.updateMany({
          where: { id, organizationId: context.organizationId, version, status: "ACCEPTED" },
          data: {
            status: "CONVERTED",
            convertedAt: new Date(),
            version: { increment: 1 },
            updatedByUserId: context.user.id
          }
        });
        if (marked.count !== 1)
          throw new AppError(
            "ESTIMATE_CONVERSION_CONFLICT",
            "Estimate conversion could not be committed safely.",
            409
          );
        await audit(tx, context, "ESTIMATE_CONVERTED", "Estimate", id, { invoiceId: invoice.id });
        return {
          statusCode: 201,
          body: { invoiceId: invoice.id, estimateId: id },
          resourceId: invoice.id
        };
      }
    );
  }

  public async issuePublicLink(context: OrganizationContext, estimateId: string, expiresAt?: Date) {
    await this.authorization.assert(context, "estimates:manage", "Estimate", estimateId);
    if (expiresAt && expiresAt <= new Date())
      throw new AppError(
        "PUBLIC_ESTIMATE_EXPIRY_INVALID",
        "Public estimate link expiry must be in the future.",
        422
      );
    const token = createOpaqueToken(32);
    const tokenHash = hashOpaqueToken(token);
    const link = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const estimate = await tx.estimate.findFirst({
        where: { id: estimateId, organizationId: context.organizationId }
      });
      if (!estimate) throw new AppError("ESTIMATE_NOT_FOUND", "Estimate was not found.", 404);
      if (["DRAFT", "EXPIRED", "CANCELLED", "CONVERTED"].includes(estimate.status))
        throw new AppError(
          "ESTIMATE_NOT_SHAREABLE",
          "Only sent, viewed, or accepted estimates can have public links.",
          409
        );
      await tx.estimatePublicLink.updateMany({
        where: { organizationId: context.organizationId, estimateId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      const created = await tx.estimatePublicLink.create({
        data: {
          organizationId: context.organizationId,
          estimateId,
          tokenHash,
          expiresAt: expiresAt ?? null,
          createdByUserId: context.user.id
        }
      });
      await audit(tx, context, "PUBLIC_ESTIMATE_LINK_ISSUED", "EstimatePublicLink", created.id, {
        estimateId,
        expiresAt: expiresAt?.toISOString() ?? null
      });
      return created;
    });
    return {
      link: {
        id: link.id,
        estimateId: link.estimateId,
        expiresAt: link.expiresAt?.toISOString() ?? null,
        createdAt: link.createdAt.toISOString()
      },
      token,
      publicUrl: `/public/estimates/${token}`
    };
  }

  public async publicView(token: string) {
    const tokenHash = hashOpaqueToken(token);
    return withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
      const link = await tx.estimatePublicLink.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });
      if (!link)
        throw new AppError(
          "PUBLIC_ESTIMATE_LINK_INVALID",
          "Estimate link is invalid or expired.",
          404
        );
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
      const estimate = await tx.estimate.findFirst({
        where: { id: link.estimateId, organizationId: link.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      if (!estimate)
        throw new AppError("PUBLIC_ESTIMATE_NOT_FOUND", "Estimate was not found.", 404);
      if (estimate.status === "SENT") {
        await tx.estimate.updateMany({
          where: { id: estimate.id, organizationId: link.organizationId, status: "SENT" },
          data: { status: "VIEWED", version: { increment: 1 } }
        });
        estimate.status = "VIEWED";
      }
      await tx.estimatePublicLink.update({
        where: { id: link.id },
        data: { lastViewedAt: new Date() }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: link.organizationId,
          actorUserId: null,
          action: "PUBLIC_ESTIMATE_VIEWED",
          targetType: "EstimatePublicLink",
          targetId: link.id,
          metadata: { estimateId: estimate.id }
        }
      });
      return {
        estimate: publicEstimateDto(estimate),
        html: renderPublicEstimateHtml(estimate, token)
      };
    });
  }

  public async publicRespond(token: string, action: "ACCEPTED" | "DECLINED") {
    const tokenHash = hashOpaqueToken(token);
    return withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
      const link = await tx.estimatePublicLink.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });
      if (!link)
        throw new AppError(
          "PUBLIC_ESTIMATE_LINK_INVALID",
          "Estimate link is invalid or expired.",
          404
        );
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
      const current = await tx.estimate.findFirst({
        where: { id: link.estimateId, organizationId: link.organizationId }
      });
      if (!current) throw new AppError("PUBLIC_ESTIMATE_NOT_FOUND", "Estimate was not found.", 404);
      if (!["SENT", "VIEWED"].includes(current.status))
        throw new AppError(
          "PUBLIC_ESTIMATE_ALREADY_RESPONDED",
          "This estimate is no longer awaiting a customer response.",
          409
        );
      const updated = await tx.estimate.updateMany({
        where: {
          id: current.id,
          organizationId: link.organizationId,
          version: current.version,
          status: { in: ["SENT", "VIEWED"] }
        },
        data: {
          status: action,
          version: { increment: 1 },
          ...(action === "ACCEPTED" ? { acceptedAt: new Date() } : { declinedAt: new Date() })
        }
      });
      if (updated.count !== 1)
        throw new AppError(
          "PUBLIC_ESTIMATE_RESPONSE_CONFLICT",
          "The estimate was updated before your response could be recorded.",
          409
        );
      await tx.auditEvent.create({
        data: {
          organizationId: link.organizationId,
          actorUserId: null,
          action: `PUBLIC_ESTIMATE_${action}`,
          targetType: "Estimate",
          targetId: current.id,
          metadata: { estimateId: current.id, publicLinkId: link.id }
        }
      });
      return { estimateId: current.id, status: action };
    });
  }

  public async revokePublicLink(context: OrganizationContext, estimateId: string, linkId: string) {
    await this.authorization.assert(context, "estimates:manage", "EstimatePublicLink", linkId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.estimatePublicLink.updateMany({
        where: {
          id: linkId,
          estimateId,
          organizationId: context.organizationId,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
      if (result.count !== 1)
        throw new AppError(
          "PUBLIC_ESTIMATE_LINK_NOT_FOUND",
          "Public estimate link was not found.",
          404
        );
      await audit(tx, context, "PUBLIC_ESTIMATE_LINK_REVOKED", "EstimatePublicLink", linkId, {
        estimateId
      });
      return { revoked: true };
    });
  }

  public async listSchedules(context: OrganizationContext) {
    await this.authorization.assert(context, "recurring-schedules:read", "RecurringSchedule");
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.recurringSchedule.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { nextRunAt: "asc" },
        take: 200
      })
    );
  }

  public async createSchedule(context: OrganizationContext, input: RecurringScheduleInput) {
    await this.authorization.assert(context, "recurring-schedules:manage", "RecurringSchedule");
    const startAt = new Date(input.startAt);
    const endAt = input.endAt ? new Date(input.endAt) : null;
    if (endAt && endAt <= startAt)
      throw new AppError("RECURRING_END_INVALID", "End date must be after start date.", 422);
    nextRecurrenceDate(startAt, recurrenceRule(input));
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      if (input.customerId) {
        const customer = await tx.customer.findFirst({
          where: { id: input.customerId, organizationId: context.organizationId, active: true }
        });
        if (!customer) throw new AppError("CUSTOMER_NOT_FOUND", "Customer was not found.", 404);
      }
      const row = await tx.recurringSchedule.create({
        data: {
          organizationId: context.organizationId,
          customerId: input.customerId ?? null,
          scheduleType: input.scheduleType,
          frequency: input.frequency,
          interval: input.interval,
          dayOfMonth: input.dayOfMonth ?? null,
          timeZone: input.timeZone,
          startAt,
          nextRunAt: startAt,
          endAt,
          missedOccurrencePolicy: input.missedOccurrencePolicy ?? "EVERY",
          invoiceMode: input.invoiceMode ?? "DRAFT",
          template: input.template as Prisma.InputJsonObject,
          createdByUserId: context.user.id,
          updatedByUserId: context.user.id
        }
      });
      await audit(tx, context, "RECURRING_SCHEDULE_CREATED", "RecurringSchedule", row.id, {
        scheduleType: row.scheduleType
      });
      return row;
    });
  }

  public async patchSchedule(
    context: OrganizationContext,
    id: string,
    input: RecurringSchedulePatch
  ) {
    await this.authorization.assert(context, "recurring-schedules:manage", "RecurringSchedule", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const current = await tx.recurringSchedule.findFirst({
        where: { id, organizationId: context.organizationId }
      });
      if (!current)
        throw new AppError(
          "RECURRING_SCHEDULE_NOT_FOUND",
          "Recurring schedule was not found.",
          404
        );
      const changed = await tx.recurringSchedule.updateMany({
        where: { id, organizationId: context.organizationId, version: input.version },
        data: {
          ...(input.scheduleType === undefined ? {} : { scheduleType: input.scheduleType }),
          ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
          ...(input.frequency === undefined ? {} : { frequency: input.frequency }),
          ...(input.interval === undefined ? {} : { interval: input.interval }),
          ...(input.dayOfMonth === undefined ? {} : { dayOfMonth: input.dayOfMonth }),
          ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
          ...(input.template === undefined
            ? {}
            : { template: input.template as Prisma.InputJsonObject }),
          ...(input.endAt === undefined
            ? {}
            : { endAt: input.endAt ? new Date(input.endAt) : null }),
          ...(input.missedOccurrencePolicy === undefined
            ? {}
            : { missedOccurrencePolicy: input.missedOccurrencePolicy }),
          ...(input.invoiceMode === undefined ? {} : { invoiceMode: input.invoiceMode }),
          updatedByUserId: context.user.id,
          version: { increment: 1 }
        }
      });
      if (changed.count !== 1)
        throw new AppError(
          "STALE_RECURRING_SCHEDULE",
          "Recurring schedule was changed by another request.",
          409
        );
      return tx.recurringSchedule.findUniqueOrThrow({ where: { id } });
    });
  }

  public async setScheduleStatus(
    context: OrganizationContext,
    id: string,
    status: "ACTIVE" | "PAUSED" | "ENDED",
    version: number
  ) {
    await this.authorization.assert(context, "recurring-schedules:manage", "RecurringSchedule", id);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const changed = await tx.recurringSchedule.updateMany({
        where: { id, organizationId: context.organizationId, version },
        data: { status, version: { increment: 1 }, updatedByUserId: context.user.id }
      });
      if (changed.count !== 1)
        throw new AppError(
          "STALE_RECURRING_SCHEDULE",
          "Recurring schedule was changed by another request.",
          409
        );
      await audit(tx, context, `RECURRING_SCHEDULE_${status}`, "RecurringSchedule", id, {});
      return tx.recurringSchedule.findUniqueOrThrow({ where: { id } });
    });
  }

  public previewSchedule(
    id: string,
    previous: Date,
    input: Pick<RecurringScheduleInput, "frequency" | "interval" | "dayOfMonth" | "timeZone">
  ) {
    const nextRunAt = nextRecurrenceDate(previous, recurrenceRule(input));
    return {
      scheduleId: id,
      nextRunAt,
      idempotencyKey: recurrenceRunIdempotencyKey(id, nextRunAt)
    };
  }
}

function recurrenceRule(
  input: Pick<RecurringScheduleInput, "frequency" | "interval" | "dayOfMonth" | "timeZone">
) {
  return {
    frequency: input.frequency,
    interval: input.interval,
    timeZone: input.timeZone,
    ...(input.dayOfMonth === null || input.dayOfMonth === undefined
      ? {}
      : { dayOfMonth: input.dayOfMonth })
  } as const;
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

async function calculateLines(
  tx: Prisma.TransactionClient,
  organizationId: string,
  issueDate: Date,
  inputs: readonly LineCalculationInput[]
): Promise<CalculatedLine[]> {
  const lines: CalculatedLine[] = [];
  for (const input of inputs) lines.push(await calculateLine(tx, organizationId, issueDate, input));
  return lines;
}

function lineTotals(lines: readonly CalculatedLine[]) {
  return {
    subtotalMinor: lines.reduce((sum, line) => sum + line.grossAmountMinor, 0n),
    discountTotalMinor: lines.reduce((sum, line) => sum + line.discountMinor, 0n),
    taxTotalMinor: lines.reduce((sum, line) => sum + line.taxTotalMinor, 0n),
    grandTotalMinor: lines.reduce((sum, line) => sum + line.totalMinor, 0n)
  };
}

function estimateLineData(
  organizationId: string,
  estimateId: string,
  lineNumber: number,
  line: CalculatedLine
) {
  return {
    organizationId,
    estimateId,
    lineNumber,
    productItemId: line.productItemId,
    description: line.description,
    quantityMicros: line.quantityMicros,
    unitPriceMinor: line.unitPriceMinor,
    grossAmountMinor: line.grossAmountMinor,
    discountMinor: line.discountMinor,
    netAmountMinor: line.netAmountMinor,
    taxableAmountMinor: line.taxableAmountMinor,
    taxTotalMinor: line.taxTotalMinor,
    totalMinor: line.totalMinor,
    taxCodeId: line.taxCodeId,
    taxSnapshot: line.taxSnapshot ?? Prisma.JsonNull,
    incomeAccountId: line.incomeAccountId,
    incomeAccountCode: line.incomeAccountCode,
    incomeAccountName: line.incomeAccountName
  };
}

async function reserveEstimateNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
  requestedNumber?: string | null
): Promise<string> {
  const rows = await tx.$queryRaw<
    readonly { estimatePrefix: string; estimateNextPlaceholder: string }[]
  >`SELECT "estimatePrefix", "estimateNextPlaceholder" FROM "BusinessDefaults" WHERE "organizationId" = ${organizationId}::uuid FOR UPDATE`;
  const defaults = rows[0];
  if (!defaults)
    throw new AppError(
      "ESTIMATE_DEFAULTS_REQUIRED",
      "Estimate numbering defaults must be configured before creating an estimate.",
      422
    );

  const requested = normalizeEstimateNumber(requestedNumber);
  if (requested) {
    const duplicate = await tx.estimate.findFirst({
      where: { organizationId, estimateNumber: requested },
      select: { id: true }
    });
    if (duplicate)
      throw new AppError(
        "ESTIMATE_NUMBER_DUPLICATE",
        "That estimate number is already in use by this company.",
        409
      );
    return requested;
  }

  let sequence = BigInt(defaults.estimateNextPlaceholder);
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const placeholder = sequence.toString().padStart(defaults.estimateNextPlaceholder.length, "0");
    const next = (sequence + 1n).toString().padStart(defaults.estimateNextPlaceholder.length, "0");
    if (placeholder.length > 12 || next.length > 12)
      throw new AppError(
        "ESTIMATE_NUMBER_SEQUENCE_EXHAUSTED",
        "Estimate number sequence is exhausted.",
        422
      );
    const estimateNumber = `${defaults.estimatePrefix}-${placeholder}`;
    const existing = await tx.estimate.findFirst({
      where: { organizationId, estimateNumber },
      select: { id: true }
    });
    if (!existing) {
      await tx.businessDefaults.update({
        where: { organizationId },
        data: { estimateNextPlaceholder: next, version: { increment: 1 } }
      });
      return estimateNumber;
    }
    sequence += 1n;
  }

  throw new AppError(
    "ESTIMATE_NUMBER_SEQUENCE_CONFLICT",
    "Estimate numbering could not find an available number. Update the estimate number defaults.",
    409
  );
}

function normalizeEstimateNumber(value?: string | null): string | null {
  if (!value?.trim()) return null;
  const estimateNumber = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,119}$/.test(estimateNumber))
    throw new AppError(
      "ESTIMATE_NUMBER_INVALID",
      "Estimate number may contain letters, numbers, spaces, periods, underscores, slashes, and hyphens.",
      422
    );
  return estimateNumber;
}

function estimateDto(row: {
  id: string;
  customerId: string;
  estimateNumber: string | null;
  provisionalIdentifier: string;
  issueDate: Date;
  expiryDate: Date | null;
  currency: string;
  status: string;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxTotalMinor: bigint;
  grandTotalMinor: bigint;
  customerNameSnapshot: string;
  customerEmailSnapshot: string | null;
  version: number;
  acceptedAt?: Date | null;
  declinedAt?: Date | null;
  convertedAt?: Date | null;
  lines: readonly {
    id: string;
    lineNumber: number;
    description: string;
    quantityMicros: bigint;
    unitPriceMinor: bigint;
    totalMinor: bigint;
  }[];
}) {
  return {
    id: row.id,
    customerId: row.customerId,
    estimateNumber: row.estimateNumber,
    provisionalIdentifier: row.provisionalIdentifier,
    issueDate: serializeDate(row.issueDate),
    expiryDate: row.expiryDate ? serializeDate(row.expiryDate) : null,
    currency: row.currency,
    status: row.status,
    subtotalMinor: row.subtotalMinor.toString(),
    discountTotalMinor: row.discountTotalMinor.toString(),
    taxTotalMinor: row.taxTotalMinor.toString(),
    grandTotalMinor: row.grandTotalMinor.toString(),
    customerName: row.customerNameSnapshot,
    customerEmail: row.customerEmailSnapshot,
    version: row.version,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    lines: row.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      description: line.description,
      quantityMicros: line.quantityMicros.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      totalMinor: line.totalMinor.toString()
    }))
  };
}

function publicEstimateDto(row: {
  id: string;
  estimateNumber: string | null;
  provisionalIdentifier: string;
  issueDate: Date;
  expiryDate: Date | null;
  currency: string;
  status: string;
  subtotalMinor: bigint;
  discountTotalMinor: bigint;
  taxTotalMinor: bigint;
  grandTotalMinor: bigint;
  customerNameSnapshot: string;
  customerEmailSnapshot: string | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  lines: readonly {
    id: string;
    lineNumber: number;
    description: string;
    quantityMicros: bigint;
    unitPriceMinor: bigint;
    totalMinor: bigint;
  }[];
}) {
  return {
    id: row.id,
    estimateNumber: row.estimateNumber ?? "DRAFT",
    issueDate: serializeDate(row.issueDate),
    expiryDate: row.expiryDate ? serializeDate(row.expiryDate) : null,
    currency: row.currency,
    status: row.status,
    subtotalMinor: row.subtotalMinor.toString(),
    discountTotalMinor: row.discountTotalMinor.toString(),
    taxTotalMinor: row.taxTotalMinor.toString(),
    grandTotalMinor: row.grandTotalMinor.toString(),
    customerName: row.customerNameSnapshot,
    customerEmail: row.customerEmailSnapshot,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    declinedAt: row.declinedAt?.toISOString() ?? null,
    lines: row.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      description: line.description,
      quantityMicros: line.quantityMicros.toString(),
      unitPriceMinor: line.unitPriceMinor.toString(),
      totalMinor: line.totalMinor.toString()
    }))
  };
}

function renderPublicEstimateHtml(
  row: {
    estimateNumber: string | null;
    provisionalIdentifier: string;
    issueDate: Date;
    expiryDate: Date | null;
    currency: string;
    status: string;
    subtotalMinor: bigint;
    taxTotalMinor: bigint;
    grandTotalMinor: bigint;
    customerNameSnapshot: string;
    customerFacingNotes: string | null;
    terms: string | null;
    organizationSnapshot: Prisma.JsonValue;
    lines: readonly {
      description: string;
      quantityMicros: bigint;
      unitPriceMinor: bigint;
      totalMinor: bigint;
    }[];
  },
  token: string,
  interactive = true
) {
  const organization = isJsonRecord(row.organizationSnapshot)
    ? row.organizationSnapshot
    : ({} as Record<string, unknown>);
  const displayName = typeof organization.displayName === "string" ? organization.displayName : "";
  // UUID-sized provisional identifiers are internal-only. Legacy drafts retain
  // their audit value in storage but never show it in a customer document.
  const estimateNumber = row.estimateNumber ?? "DRAFT";
  const lineRows = row.lines
    .map(
      (line) =>
        `<tr><td>${escapeHtml(line.description)}</td><td>${formatQuantity(line.quantityMicros)}</td><td>${formatMoney(line.unitPriceMinor, row.currency)}</td><td>${formatMoney(line.totalMinor, row.currency)}</td></tr>`
    )
    .join("");
  let actions =
    interactive && ["SENT", "VIEWED"].includes(row.status)
      ? `<section class="actions"><p>Please review this estimate and choose a response.</p><form method="post" action="/public/estimates/${encodeURIComponent(token)}/accept"><button type="submit">Accept estimate</button></form><form method="post" action="/public/estimates/${encodeURIComponent(token)}/decline"><button class="secondary" type="submit">Decline estimate</button></form></section>`
      : `<section class="notice">This estimate has already been ${escapeHtml(row.status.toLowerCase())}.</section>`;
  const notes = row.customerFacingNotes
    ? `<section class="document-copy"><h2>Notes</h2><p>${escapeHtml(row.customerFacingNotes).replaceAll("\n", "<br>")}</p></section>`
    : "";
  const terms = row.terms
    ? `<section class="document-copy"><h2>Terms</h2><p>${escapeHtml(row.terms).replaceAll("\n", "<br>")}</p></section>`
    : "";
  actions = `${notes}${terms}${actions}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Estimate ${escapeHtml(estimateNumber)}</title><style>body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f6f8;color:#18212b;margin:0;padding:32px}.card{max-width:820px;margin:auto;background:#fff;border-radius:16px;padding:36px;box-shadow:0 8px 30px #18212b18}header{display:flex;justify-content:space-between;gap:24px;border-bottom:1px solid #e6e9ed;padding-bottom:24px;margin-bottom:24px}h1{margin:0 0 8px;font-size:28px}h2{font-size:16px;margin-top:30px}p{color:#59636e}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #edf0f2}th:last-child,td:last-child{text-align:right}.totals{margin-left:auto;max-width:320px;margin-top:20px}.total{font-size:20px;font-weight:700}.actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#f7fafc;padding:20px;border-radius:12px;margin-top:28px}.actions p{width:100%;margin:0 0 4px}button{border:0;border-radius:8px;background:#166534;color:white;font-weight:600;padding:11px 16px;cursor:pointer}.secondary{background:#475569}.notice{margin-top:28px;padding:16px;background:#fff7ed;border-radius:10px;color:#9a3412}@media(max-width:640px){body{padding:12px}.card{padding:20px}header{display:block}table{font-size:13px}}</style></head><body><main class="card"><header><div><p>${escapeHtml(displayName)}</p><h1>Estimate ${escapeHtml(estimateNumber)}</h1><p>Issued ${escapeHtml(serializeDate(row.issueDate))}${row.expiryDate ? ` · Valid until ${escapeHtml(serializeDate(row.expiryDate))}` : ""}</p></div><div><strong>${escapeHtml(row.status)}</strong></div></header><section><h2>Prepared for</h2><p>${escapeHtml(row.customerNameSnapshot)}</p></section><table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${lineRows}</tbody></table><section class="totals"><p>Subtotal <strong>${formatMoney(row.subtotalMinor, row.currency)}</strong></p><p>Tax <strong>${formatMoney(row.taxTotalMinor, row.currency)}</strong></p><p class="total">Total ${formatMoney(row.grandTotalMinor, row.currency)}</p></section>${actions}</main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character] ?? character;
  });
}

function formatMoney(value: bigint, currency: string): string {
  return `${currency} ${(Number(value) / 100).toFixed(2)}`;
}

function formatQuantity(value: bigint): string {
  return (Number(value) / 1_000_000).toFixed(2).replace(/\.00$/, "");
}

function isJsonRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function organizationSnapshotFor(tx: Prisma.TransactionClient, organizationId: string) {
  const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
  return {
    legalName: organization.legalName,
    displayName: organization.displayName,
    currency: organization.currency,
    timezone: organization.timezone
  } satisfies Prisma.InputJsonObject;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
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
