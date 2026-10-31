import { withTenantTransaction, type PrismaClient } from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { createOpaqueToken, hashOpaqueToken, normalizeEmail } from "../auth/security.js";
import { withAuditOrigin } from "../utils/audit.js";
import { runIdempotent } from "./idempotency-service.js";
import { DevelopmentEmailProvider, type EmailProvider } from "./invoice-document-service.js";
import { environmentValueOrDefault } from "../environment.js";

export interface EstimateEmailInput {
  readonly recipientEmail?: string | undefined;
  readonly subject?: string | undefined;
  readonly message?: string | null | undefined;
}

export class EstimateEmailService {
  private readonly authorization: AuthorizationService;

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly emailProvider: EmailProvider = new DevelopmentEmailProvider(),
    private readonly betaRuntime = process.env.CLEARLEDGER_BETA_RUNTIME === "true",
    private readonly emailDeliveryEnabled = !betaRuntime
  ) {
    this.authorization = new AuthorizationService(prisma);
  }

  public async queueSend(
    context: OrganizationContext,
    estimateId: string,
    input: EstimateEmailInput,
    idempotencyKey: string
  ) {
    this.assertEmailDeliveryEnabled();
    await this.authorization.assert(context, "estimates:manage", "Estimate", estimateId);
    const estimate = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.estimate.findFirst({
        where: { id: estimateId, organizationId: context.organizationId },
        select: {
          id: true,
          status: true,
          estimateNumber: true,
          provisionalIdentifier: true,
          expiryDate: true,
          customerEmailSnapshot: true
        }
      })
    );
    if (!estimate) throw new AppError("ESTIMATE_NOT_FOUND", "Estimate was not found.", 404);
    if (!["SENT", "VIEWED", "ACCEPTED"].includes(estimate.status))
      throw new AppError(
        "ESTIMATE_NOT_ISSUED",
        "Only sent, viewed, or accepted estimates can be emailed.",
        409
      );
    const recipientEmail = normalizeEmail(
      input.recipientEmail ?? estimate.customerEmailSnapshot ?? ""
    );
    if (!recipientEmail || !recipientEmail.includes("@"))
      throw new AppError("ESTIMATE_RECIPIENT_INVALID", "A valid recipient email is required.", 422);
    const subject = input.subject?.trim() || "Estimate " + (estimate.estimateNumber ?? "draft");
    if (subject.includes("\r") || subject.includes("\n") || subject.length > 998)
      throw new AppError("ESTIMATE_SUBJECT_INVALID", "Email subject is invalid.", 422);
    const message = input.message?.trim() || null;

    return runIdempotent(
      this.prisma,
      context,
      "estimate.email.queue",
      idempotencyKey,
      { estimateId, recipientEmail, subject, message },
      async (tx) => {
        const token = createOpaqueToken();
        const expiresAt = estimate.expiryDate
          ? new Date(estimate.expiryDate.getTime() + 24 * 60 * 60 * 1000)
          : addDays(new Date(), 30);
        if (expiresAt <= new Date())
          throw new AppError("ESTIMATE_EXPIRED", "Expired estimates cannot be emailed.", 409);
        const publicLink = await tx.estimatePublicLink.create({
          data: {
            organizationId: context.organizationId,
            estimateId,
            tokenHash: hashOpaqueToken(token),
            expiresAt,
            createdByUserId: context.user.id
          }
        });
        const publicUrl = absolutePublicUrl("/public/estimates/" + token);
        const deliveryMessage = [message, "View estimate: " + publicUrl]
          .filter(Boolean)
          .join("\n\n");
        const delivery = await tx.estimateDelivery.create({
          data: {
            organizationId: context.organizationId,
            estimateId,
            recipientEmail,
            subject,
            message: deliveryMessage,
            createdByUserId: context.user.id
          }
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "estimate.email.queued",
            aggregateType: "EstimateDelivery",
            aggregateId: delivery.id,
            payload: { deliveryId: delivery.id, estimateId, publicLinkId: publicLink.id }
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "ESTIMATE_EMAIL_QUEUED",
            targetType: "EstimateDelivery",
            targetId: delivery.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, {
              estimateId,
              recipientDomain: recipientEmail.split("@")[1] ?? "",
              publicLinkId: publicLink.id
            })
          }
        });
        return {
          statusCode: 202,
          body: { delivery: deliveryDto(delivery), publicUrl },
          resourceId: delivery.id
        };
      }
    );
  }

  public async deliveryHistory(context: OrganizationContext, estimateId: string) {
    await this.authorization.assert(context, "estimates:read", "EstimateDelivery", estimateId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const deliveries = await tx.estimateDelivery.findMany({
        where: { organizationId: context.organizationId, estimateId },
        orderBy: { queuedAt: "desc" }
      });
      return deliveries.map(deliveryDto);
    });
  }

  public async dispatchDelivery(context: OrganizationContext, deliveryId: string) {
    this.assertEmailDeliveryEnabled();
    await this.authorization.assert(context, "estimates:manage", "EstimateDelivery", deliveryId);
    const claimed = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.estimateDelivery.updateMany({
        where: {
          id: deliveryId,
          organizationId: context.organizationId,
          status: { in: ["QUEUED", "FAILED"] },
          attempts: { lt: 5 }
        },
        data: { status: "SENDING", attempts: { increment: 1 }, failedAt: null, lastError: null }
      });
      const delivery = await tx.estimateDelivery.findFirst({
        where: { id: deliveryId, organizationId: context.organizationId }
      });
      return { delivery, claimed: result.count === 1 };
    });
    if (!claimed.delivery)
      throw new AppError("ESTIMATE_DELIVERY_NOT_FOUND", "Delivery was not found.", 404);
    if (!claimed.claimed) return deliveryDto(claimed.delivery);
    try {
      const result = await this.emailProvider.send({
        to: claimed.delivery.recipientEmail,
        subject: claimed.delivery.subject,
        message: claimed.delivery.message,
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        requestId: context.requestId,
        estimateId: claimed.delivery.estimateId
      });
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const updated = await tx.estimateDelivery.update({
          where: { id: claimed.delivery!.id },
          data: { status: "SENT", providerMessageId: result.providerMessageId, sentAt: new Date() }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "ESTIMATE_EMAIL_SENT",
            targetType: "EstimateDelivery",
            targetId: updated.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, { providerMessageId: result.providerMessageId })
          }
        });
        return deliveryDto(updated);
      });
    } catch (error) {
      await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await tx.estimateDelivery.update({
          where: { id: claimed.delivery!.id },
          data: { status: "FAILED", lastError: "Email provider failed", failedAt: new Date() }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "ESTIMATE_EMAIL_FAILED",
            targetType: "EstimateDelivery",
            targetId: claimed.delivery!.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, { reason: "provider_failure" })
          }
        });
      });
      throw new AppError(
        "ESTIMATE_EMAIL_FAILED",
        error instanceof Error ? error.message : "Email provider failed.",
        502
      );
    }
  }

  private assertEmailDeliveryEnabled(): void {
    if (this.emailDeliveryEnabled) return;
    throw new AppError(
      this.betaRuntime ? "BETA_EMAIL_DELIVERY_DISABLED" : "EMAIL_DELIVERY_UNAVAILABLE",
      this.betaRuntime
        ? "Email delivery is disabled in this beta. Create a customer link and send it through your own email service."
        : "Email delivery is not configured for this environment. Create a customer link and send it through your own email service.",
      409
    );
  }
}

function deliveryDto(delivery: {
  id: string;
  estimateId: string;
  recipientEmail: string;
  subject: string;
  status: string;
  attempts: number;
  providerMessageId: string | null;
  queuedAt: Date;
  sentAt: Date | null;
  failedAt: Date | null;
}) {
  return {
    id: delivery.id,
    estimateId: delivery.estimateId,
    recipientEmail: delivery.recipientEmail,
    subject: delivery.subject,
    status: delivery.status,
    attempts: delivery.attempts,
    providerMessageId: delivery.providerMessageId,
    queuedAt: delivery.queuedAt.toISOString(),
    sentAt: delivery.sentAt?.toISOString() ?? null,
    failedAt: delivery.failedAt?.toISOString() ?? null
  };
}

function absolutePublicUrl(path: string): string {
  return new URL(
    path,
    environmentValueOrDefault(process.env.APP_BASE_URL, "http://localhost:3000")
  ).toString();
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}
