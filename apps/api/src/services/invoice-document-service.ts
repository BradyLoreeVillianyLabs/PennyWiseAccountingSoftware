import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  withPublicInvoiceTransaction,
  withTenantTransaction,
  type PrismaClient
} from "@clearledger/db";
import type { OrganizationContext } from "@clearledger/shared";
import { AppError } from "@clearledger/shared";
import { AuthorizationService } from "../auth/permissions.js";
import { createOpaqueToken, hashOpaqueToken, normalizeEmail } from "../auth/security.js";
import { withAuditOrigin } from "../utils/audit.js";
import { runIdempotent } from "./idempotency-service.js";
import {
  buildInvoiceRenderData,
  DeterministicPdfRenderer,
  assertCustomerFacingPaymentUrl,
  parseStoredRenderData,
  renderDataHash,
  renderInvoiceHtml,
  type DocumentStorage,
  type InvoiceRenderData,
  type InvoiceRenderAsset,
  type InvoiceRenderAssets,
  type InvoiceRenderSource,
  type PdfRenderer
} from "./invoice-render-service.js";
import { PaymentInstructionService } from "./payment-instruction-service.js";
import {
  getInvoiceTemplate,
  validateTemplateConfiguration,
  type InvoiceTemplateConfiguration
} from "./invoice-template-service.js";
import type { LogoStorage } from "./logo-service.js";

export { DevelopmentDocumentStorage } from "./invoice-render-service.js";
export type { DocumentStorage } from "./invoice-render-service.js";

export interface AttachmentScanner {
  scan(data: Buffer, mediaType: string): Promise<"CLEAN" | "REJECTED">;
}

export class DevelopmentAttachmentScanner implements AttachmentScanner {
  public scan(data: Buffer, mediaType: string): Promise<"CLEAN" | "REJECTED"> {
    return Promise.resolve(inspectAttachmentBytes(data, mediaType) ? "CLEAN" : "REJECTED");
  }
}

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly message: string | null;
  /** Required by real mailbox providers; development providers deliberately ignore it. */
  readonly organizationId?: string;
  readonly actorUserId?: string;
  readonly requestId?: string;
  readonly pdf?: Buffer;
  readonly invoiceId?: string;
  readonly estimateId?: string;
  readonly publicUrl?: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ readonly providerMessageId: string }>;
}

export class DevelopmentEmailProvider implements EmailProvider {
  public readonly sent: EmailMessage[] = [];

  public send(message: EmailMessage): Promise<{ readonly providerMessageId: string }> {
    this.sent.push(message);
    return Promise.resolve({
      providerMessageId: `dev-${message.invoiceId ?? message.estimateId ?? "message"}-${this.sent.length.toString()}`
    });
  }
}

export class InvoiceDocumentService {
  private readonly authorization: AuthorizationService;
  private readonly renderer: PdfRenderer;
  private readonly publicHits = new Map<string, { readonly startedAt: number; count: number }>();

  public constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: DocumentStorage,
    private readonly emailProvider: EmailProvider = new DevelopmentEmailProvider(),
    renderer: PdfRenderer = new DeterministicPdfRenderer(),
    private readonly attachmentScanner: AttachmentScanner = new DevelopmentAttachmentScanner(),
    private readonly logoStorage?: LogoStorage,
    private readonly betaRuntime = process.env.CLEARLEDGER_BETA_RUNTIME === "true",
    private readonly emailDeliveryEnabled = !betaRuntime,
    private readonly paymentInstructionService = new PaymentInstructionService(prisma)
  ) {
    this.authorization = new AuthorizationService(prisma);
    this.renderer = renderer;
  }

  public async preview(context: OrganizationContext, invoiceId: string) {
    await this.authorization.assert(context, "invoices:preview", "Invoice", invoiceId);
    const invoice = await this.invoice(context, invoiceId);
    const data = await this.renderData(invoice, context);
    const assets = await this.renderAssets(data, context);
    return {
      invoiceId,
      renderDataHash: renderDataHash(data),
      html: renderInvoiceHtml(data, false, assets)
    };
  }

  public async generatePdf(
    context: OrganizationContext,
    invoiceId: string,
    idempotencyKey: string
  ) {
    await this.authorization.assert(context, "invoices:pdf", "Invoice", invoiceId);
    return runIdempotent(
      this.prisma,
      context,
      "invoice.pdf.generate",
      idempotencyKey,
      { invoiceId },
      async (tx) => {
        const invoice = await tx.invoice.findFirst({
          where: { id: invoiceId, organizationId: context.organizationId },
          include: { lines: { orderBy: { lineNumber: "asc" } } }
        });
        if (!invoice) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
        if (invoice.status === "VOIDED")
          throw new AppError(
            "INVOICE_DOCUMENT_UNAVAILABLE",
            "Voided invoices cannot be delivered.",
            409
          );
        const data = await this.renderDataInTransaction(tx, invoice, context.organizationId);
        const hash = renderDataHash(data);
        const existing = await tx.invoicePdfArtifact.findFirst({
          where: { organizationId: context.organizationId, invoiceId, renderDataHash: hash },
          orderBy: { createdAt: "desc" }
        });
        if (existing)
          return {
            statusCode: 200,
            body: { artifact: artifactDto(existing) },
            resourceId: existing.id
          };
        const assets = await this.renderAssetsInTransaction(tx, data, context.organizationId);
        const pdf = await this.renderer.render(data, assets);
        const checksum = createHash("sha256").update(pdf.data).digest("hex");
        const storageKey = `${context.organizationId}/invoices/${invoiceId}/${hash}.pdf`;
        await this.storage.put(storageKey, pdf.data, "application/pdf");
        const artifact = await tx.invoicePdfArtifact.create({
          data: {
            organizationId: context.organizationId,
            invoiceId,
            storageKey,
            renderDataHash: hash,
            checksum,
            byteSize: pdf.data.length,
            pageCount: pdf.pageCount,
            generatedByUserId: context.user.id
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "INVOICE_PDF_GENERATED",
            targetType: "InvoicePdfArtifact",
            targetId: artifact.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, {
              invoiceId,
              renderDataHash: hash,
              checksum,
              pageCount: pdf.pageCount
            })
          }
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "invoice.pdf.generated",
            aggregateType: "Invoice",
            aggregateId: invoiceId,
            payload: { invoiceId, artifactId: artifact.id, renderDataHash: hash }
          }
        });
        return {
          statusCode: 201,
          body: { artifact: artifactDto(artifact) },
          resourceId: artifact.id
        };
      }
    );
  }

  public async readPdf(context: OrganizationContext, invoiceId: string) {
    await this.authorization.assert(context, "invoices:read", "InvoicePdfArtifact", invoiceId);
    const artifact = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoicePdfArtifact.findFirst({
        where: { organizationId: context.organizationId, invoiceId },
        orderBy: { createdAt: "desc" }
      })
    );
    if (!artifact)
      throw new AppError("INVOICE_PDF_NOT_FOUND", "Generate the invoice PDF first.", 404);
    return { artifact: artifactDto(artifact), data: await this.storage.get(artifact.storageKey) };
  }

  public async queueSend(
    context: OrganizationContext,
    invoiceId: string,
    input: {
      readonly recipientEmail?: string | undefined;
      readonly subject?: string | undefined;
      readonly message?: string | null | undefined;
    },
    idempotencyKey: string,
    permission: "invoices:send" | "invoices:resend" = "invoices:send"
  ) {
    this.assertEmailDeliveryEnabled();
    await this.authorization.assert(context, permission, "Invoice", invoiceId);
    const invoice = await this.invoice(context, invoiceId);
    if (invoice.status === "DRAFT" || invoice.status === "APPROVED")
      throw new AppError("INVOICE_NOT_ISSUED", "Only posted invoices can be sent.", 409);
    const pdf = await this.generatePdf(context, invoiceId, `pdf-for-send:${invoiceId}`);
    const recipientEmail = normalizeEmail(
      input.recipientEmail ?? invoice.customerEmailSnapshot ?? ""
    );
    if (!recipientEmail || !recipientEmail.includes("@"))
      throw new AppError("INVOICE_RECIPIENT_INVALID", "A valid recipient email is required.", 422);
    const subject =
      input.subject?.trim() || `Invoice ${invoice.invoiceNumber ?? invoice.provisionalIdentifier}`;
    if (/[\r\n]/.test(subject) || subject.length > 998)
      throw new AppError("INVOICE_SUBJECT_INVALID", "Email subject is invalid.", 422);
    const message = input.message?.trim() || null;
    return runIdempotent(
      this.prisma,
      context,
      "invoice.email.queue",
      idempotencyKey,
      { invoiceId, recipientEmail, subject, message },
      async (tx) => {
        const delivery = await tx.invoiceDelivery.create({
          data: {
            organizationId: context.organizationId,
            invoiceId,
            recipientEmail,
            subject,
            message,
            createdByUserId: context.user.id
          }
        });
        await tx.invoiceDeliveryEvent.create({
          data: {
            organizationId: context.organizationId,
            deliveryId: delivery.id,
            eventType: "QUEUED",
            metadata: { artifactId: pdf.resourceId ?? null }
          }
        });
        await tx.outboxEvent.create({
          data: {
            organizationId: context.organizationId,
            eventType: "invoice.email.queued",
            aggregateType: "InvoiceDelivery",
            aggregateId: delivery.id,
            payload: { deliveryId: delivery.id, invoiceId, artifactId: pdf.resourceId ?? null }
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "INVOICE_EMAIL_QUEUED",
            targetType: "InvoiceDelivery",
            targetId: delivery.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, {
              invoiceId,
              recipientDomain: recipientEmail.split("@")[1] ?? ""
            })
          }
        });
        return {
          statusCode: 202,
          body: { delivery: deliveryDto(delivery) },
          resourceId: delivery.id
        };
      }
    );
  }

  public async recordManualDelivery(
    context: OrganizationContext,
    invoiceId: string,
    input: {
      readonly recipientEmails: readonly string[];
      readonly subject?: string | undefined;
      readonly message?: string | null | undefined;
    },
    idempotencyKey: string
  ) {
    await this.authorization.assert(context, "invoices:send", "Invoice", invoiceId);
    const invoice = await this.invoice(context, invoiceId);
    if (invoice.status === "DRAFT" || invoice.status === "APPROVED")
      throw new AppError("INVOICE_NOT_ISSUED", "Only posted invoices can be marked as sent.", 409);
    const recipientEmails = [
      ...new Set(input.recipientEmails.map((email) => normalizeEmail(email)))
    ].filter((email) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (!recipientEmails.length || recipientEmails.length > 10)
      throw new AppError(
        "INVOICE_RECIPIENT_INVALID",
        "Provide between one and ten valid recipient email addresses.",
        422
      );
    const subject =
      input.subject?.trim() || `Invoice ${invoice.invoiceNumber ?? invoice.provisionalIdentifier}`;
    if (/[\r\n]/.test(subject) || subject.length > 998)
      throw new AppError("INVOICE_SUBJECT_INVALID", "Email subject is invalid.", 422);
    const message = input.message?.trim() || null;
    const pdf = await this.generatePdf(context, invoiceId, `pdf-for-manual-send:${invoiceId}`);
    return runIdempotent(
      this.prisma,
      context,
      "invoice.email.manual",
      idempotencyKey,
      { invoiceId, recipientEmails, subject, message },
      async (tx) => {
        const occurredAt = new Date();
        const deliveries = [];
        for (const recipientEmail of recipientEmails) {
          const delivery = await tx.invoiceDelivery.create({
            data: {
              organizationId: context.organizationId,
              invoiceId,
              recipientEmail,
              subject,
              message,
              status: "MANUAL",
              sentAt: occurredAt,
              createdByUserId: context.user.id
            }
          });
          await tx.invoiceDeliveryEvent.create({
            data: {
              organizationId: context.organizationId,
              deliveryId: delivery.id,
              eventType: "MANUAL",
              metadata: { channel: "own-email-app", artifactId: pdf.resourceId ?? null }
            }
          });
          await tx.auditEvent.create({
            data: {
              organizationId: context.organizationId,
              actorUserId: context.user.id,
              action: "INVOICE_EMAIL_MANUAL",
              targetType: "InvoiceDelivery",
              targetId: delivery.id,
              requestId: context.requestId,
              metadata: withAuditOrigin(context, {
                invoiceId,
                recipientDomain: recipientEmail.split("@")[1] ?? "",
                channel: "own-email-app"
              })
            }
          });
          deliveries.push(deliveryDto(delivery));
        }
        return {
          statusCode: 201,
          body: { delivery: deliveries[0], deliveries },
          resourceId: deliveries[0]?.id
        };
      }
    );
  }

  public async deliveryHistory(context: OrganizationContext, invoiceId: string) {
    await this.authorization.assert(
      context,
      "invoices:delivery-read",
      "InvoiceDelivery",
      invoiceId
    );
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const deliveries = await tx.invoiceDelivery.findMany({
        where: { organizationId: context.organizationId, invoiceId },
        include: { events: { orderBy: { occurredAt: "asc" } } },
        orderBy: { queuedAt: "desc" }
      });
      return deliveries.map((delivery) => ({
        ...deliveryDto(delivery),
        events: delivery.events.map(eventDto)
      }));
    });
  }

  public async dispatchDelivery(context: OrganizationContext, deliveryId: string) {
    this.assertEmailDeliveryEnabled();
    await this.authorization.assert(context, "invoices:send", "InvoiceDelivery", deliveryId);
    const delivery = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const claimed = await tx.invoiceDelivery.updateMany({
        where: {
          id: deliveryId,
          organizationId: context.organizationId,
          status: { in: ["QUEUED", "FAILED"] },
          attempts: { lt: 5 }
        },
        data: { status: "SENDING", attempts: { increment: 1 }, failedAt: null, lastError: null }
      });
      return tx.invoiceDelivery
        .findFirst({
          where: { id: deliveryId, organizationId: context.organizationId },
          include: { invoice: { include: { lines: true } } }
        })
        .then((current) => ({ current, claimed: claimed.count === 1 }));
    });
    if (!delivery.current)
      throw new AppError("INVOICE_DELIVERY_NOT_FOUND", "Delivery was not found.", 404);
    if (!delivery.claimed) return deliveryDto(delivery.current);
    const claimedDelivery = delivery.current;
    const artifact = await this.readPdf(context, claimedDelivery.invoiceId);
    try {
      const result = await this.emailProvider.send({
        to: claimedDelivery.recipientEmail,
        subject: claimedDelivery.subject,
        message: claimedDelivery.message,
        organizationId: context.organizationId,
        actorUserId: context.user.id,
        requestId: context.requestId,
        pdf: artifact.data,
        invoiceId: claimedDelivery.invoiceId
      });
      return await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        const updated = await tx.invoiceDelivery.update({
          where: { id: claimedDelivery.id },
          data: {
            status: "SENT",
            providerMessageId: result.providerMessageId,
            sentAt: new Date()
          }
        });
        await tx.invoiceDeliveryEvent.create({
          data: {
            organizationId: context.organizationId,
            deliveryId: claimedDelivery.id,
            eventType: "SENT",
            providerReference: result.providerMessageId
          }
        });
        await tx.auditEvent.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.user.id,
            action: "INVOICE_EMAIL_SENT",
            targetType: "InvoiceDelivery",
            targetId: claimedDelivery.id,
            requestId: context.requestId,
            metadata: withAuditOrigin(context, { providerMessageId: result.providerMessageId })
          }
        });
        return deliveryDto(updated);
      });
    } catch (error) {
      await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
        await tx.invoiceDelivery.update({
          where: { id: claimedDelivery.id },
          data: {
            status: "FAILED",
            lastError: "Email provider failed",
            failedAt: new Date()
          }
        });
        await tx.invoiceDeliveryEvent.create({
          data: {
            organizationId: context.organizationId,
            deliveryId: claimedDelivery.id,
            eventType: "FAILED",
            metadata: { reason: "provider_failure" }
          }
        });
      });
      throw new AppError(
        "INVOICE_EMAIL_FAILED",
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
        ? "Email delivery is disabled in this beta. Download the PDF and send it through your own email service."
        : "Email delivery is not configured for this environment. Download the PDF and send it through your own email service.",
      409
    );
  }

  public async addAttachment(
    context: OrganizationContext,
    invoiceId: string,
    input: { readonly fileName: string; readonly mediaType: string; readonly data: Buffer }
  ) {
    await this.authorization.assert(context, "invoices:attachments", "Invoice", invoiceId);
    if (input.data.length === 0 || input.data.length > 10 * 1024 * 1024)
      throw new AppError(
        "INVOICE_ATTACHMENT_SIZE_INVALID",
        "Attachment size is not supported.",
        422
      );
    const fileName = normalizeAttachmentFileName(input.fileName);
    if (!allowedAttachmentMediaTypes.has(input.mediaType))
      throw new AppError(
        "INVOICE_ATTACHMENT_TYPE_INVALID",
        "Attachment type is not supported.",
        422
      );
    if (!inspectAttachmentBytes(input.data, input.mediaType))
      throw new AppError(
        "INVOICE_ATTACHMENT_CONTENT_INVALID",
        "Attachment bytes do not match the declared file type.",
        422
      );
    const scan = await this.attachmentScanner.scan(input.data, input.mediaType);
    if (scan !== "CLEAN")
      throw new AppError(
        "INVOICE_ATTACHMENT_MALWARE_REJECTED",
        "Attachment failed security scanning.",
        422
      );
    const invoice = await this.invoice(context, invoiceId);
    if (invoice.status !== "DRAFT" && invoice.status !== "APPROVED")
      throw new AppError(
        "INVOICE_ATTACHMENT_IMMUTABLE",
        "Attachments must be added before an invoice is issued.",
        409
      );
    const storageKey = `${context.organizationId}/invoices/${invoiceId}/attachments/${randomUUID()}-${fileName}`;
    const checksum = createHash("sha256").update(input.data).digest("hex");
    await this.storage.put(storageKey, input.data, input.mediaType);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const created = await tx.invoiceAttachment.create({
        data: {
          organizationId: context.organizationId,
          invoiceId,
          storageKey,
          fileName,
          mediaType: input.mediaType,
          byteSize: input.data.length,
          checksum,
          scanStatus: "CLEAN",
          createdByUserId: context.user.id
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "INVOICE_ATTACHMENT_ADDED",
          targetType: "InvoiceAttachment",
          targetId: created.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {
            invoiceId,
            mediaType: created.mediaType,
            byteSize: created.byteSize,
            checksum: created.checksum
          })
        }
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: context.organizationId,
          eventType: "invoice.attachment.added",
          aggregateType: "InvoiceAttachment",
          aggregateId: created.id,
          payload: { invoiceId, attachmentId: created.id }
        }
      });
      return { attachment: attachmentDto(created) };
    });
  }

  public async listAttachments(context: OrganizationContext, invoiceId: string) {
    await this.authorization.assert(context, "invoices:read", "Invoice", invoiceId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const attachments = await tx.invoiceAttachment.findMany({
        where: { organizationId: context.organizationId, invoiceId },
        orderBy: { createdAt: "asc" }
      });
      return attachments.map(attachmentDto);
    });
  }

  public async readAttachment(
    context: OrganizationContext,
    invoiceId: string,
    attachmentId: string
  ) {
    await this.authorization.assert(context, "invoices:read", "InvoiceAttachment", attachmentId);
    const attachment = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoiceAttachment.findFirst({
        where: { id: attachmentId, organizationId: context.organizationId, invoiceId }
      })
    );
    if (!attachment)
      throw new AppError("INVOICE_ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);
    return {
      attachment: attachmentDto(attachment),
      data: await this.storage.get(attachment.storageKey)
    };
  }

  public async publicAttachment(token: string, attachmentId: string) {
    const tokenHash = hashOpaqueToken(token);
    this.assertPublicRateLimit(tokenHash);
    return withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
      const link = await tx.publicInvoiceLink.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });
      if (!link)
        throw new AppError(
          "PUBLIC_INVOICE_LINK_INVALID",
          "Invoice link is invalid or expired.",
          404
        );
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
      const attachment = await tx.invoiceAttachment.findFirst({
        where: {
          id: attachmentId,
          organizationId: link.organizationId,
          invoiceId: link.invoiceId,
          customerVisible: true,
          scanStatus: "CLEAN"
        }
      });
      if (!attachment)
        throw new AppError("INVOICE_ATTACHMENT_NOT_FOUND", "Attachment was not found.", 404);
      await tx.auditEvent.create({
        data: {
          organizationId: link.organizationId,
          actorUserId: null,
          action: "PUBLIC_INVOICE_ATTACHMENT_DOWNLOADED",
          targetType: "InvoiceAttachment",
          targetId: attachment.id,
          metadata: { invoiceId: link.invoiceId, mediaType: attachment.mediaType }
        }
      });
      return { attachment, data: await this.storage.get(attachment.storageKey) };
    });
  }

  public async issuePublicLink(context: OrganizationContext, invoiceId: string, expiresAt?: Date) {
    await this.authorization.assert(context, "invoices:public-link", "Invoice", invoiceId);
    if (expiresAt && expiresAt <= new Date())
      throw new AppError(
        "PUBLIC_INVOICE_EXPIRY_INVALID",
        "Public link expiry must be in the future.",
        422
      );
    const invoice = await this.invoice(context, invoiceId);
    if (
      invoice.status !== "POSTED" &&
      invoice.status !== "PARTIALLY_CREDITED" &&
      invoice.status !== "CREDITED"
    )
      throw new AppError("INVOICE_NOT_ISSUED", "Only posted invoices can have public links.", 409);
    await this.generatePdf(context, invoiceId, `pdf-for-public-link:${invoiceId}`);
    const token = createOpaqueToken(32);
    const tokenHash = hashOpaqueToken(token);
    const link = await withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId}::uuid AND "organizationId" = ${context.organizationId}::uuid FOR UPDATE`;
      await tx.publicInvoiceLink.updateMany({
        where: { organizationId: context.organizationId, invoiceId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      const created = await tx.publicInvoiceLink.create({
        data: {
          organizationId: context.organizationId,
          invoiceId,
          tokenHash,
          expiresAt: expiresAt ?? null,
          createdByUserId: context.user.id
        }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PUBLIC_INVOICE_LINK_ISSUED",
          targetType: "PublicInvoiceLink",
          targetId: created.id,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, {
            invoiceId,
            expiresAt: expiresAt?.toISOString() ?? null
          })
        }
      });
      return created;
    });
    return {
      link: publicLinkDto(link),
      token,
      publicUrl: `/public/invoices/${token}`,
      pdfUrl: `/public/invoices/${token}/pdf`
    };
  }

  public async revokePublicLink(context: OrganizationContext, invoiceId: string, linkId: string) {
    await this.authorization.assert(context, "invoices:public-link", "PublicInvoiceLink", linkId);
    return withTenantTransaction(this.prisma, dbContext(context), async (tx) => {
      const result = await tx.publicInvoiceLink.updateMany({
        where: { id: linkId, organizationId: context.organizationId, invoiceId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
      if (result.count !== 1)
        throw new AppError(
          "PUBLIC_INVOICE_LINK_NOT_FOUND",
          "Public invoice link was not found.",
          404
        );
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.user.id,
          action: "PUBLIC_INVOICE_LINK_REVOKED",
          targetType: "PublicInvoiceLink",
          targetId: linkId,
          requestId: context.requestId,
          metadata: withAuditOrigin(context, { invoiceId })
        }
      });
      return { revoked: true };
    });
  }

  public async publicView(token: string) {
    const tokenHash = hashOpaqueToken(token);
    this.assertPublicRateLimit(tokenHash);
    return withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
      const link = await tx.publicInvoiceLink.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });
      if (!link)
        throw new AppError(
          "PUBLIC_INVOICE_LINK_INVALID",
          "Invoice link is invalid or expired.",
          404
        );
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
      const invoice = await tx.invoice.findFirst({
        where: { id: link.invoiceId, organizationId: link.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      });
      if (!invoice) throw new AppError("PUBLIC_INVOICE_NOT_FOUND", "Invoice was not found.", 404);
      const data = await this.renderDataInTransaction(tx, invoice, link.organizationId);
      await tx.publicInvoiceLink.update({
        where: { id: link.id },
        data: { lastViewedAt: new Date() }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: link.organizationId,
          actorUserId: null,
          action: "PUBLIC_INVOICE_VIEWED",
          targetType: "PublicInvoiceLink",
          targetId: link.id,
          metadata: { invoiceId: invoice.id }
        }
      });
      const assets = await this.renderAssetsInTransaction(tx, data, link.organizationId);
      return {
        html: renderInvoiceHtml(data, true, assets),
        invoiceNumber: data.invoice.number
      };
    });
  }

  public async publicPdf(token: string) {
    const tokenHash = hashOpaqueToken(token);
    this.assertPublicRateLimit(tokenHash);
    return withPublicInvoiceTransaction(this.prisma, tokenHash, async (tx) => {
      const link = await tx.publicInvoiceLink.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });
      if (!link)
        throw new AppError(
          "PUBLIC_INVOICE_LINK_INVALID",
          "Invoice link is invalid or expired.",
          404
        );
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${link.organizationId}, true)`;
      const artifact = await tx.invoicePdfArtifact.findFirst({
        where: { organizationId: link.organizationId, invoiceId: link.invoiceId },
        orderBy: { createdAt: "desc" }
      });
      if (!artifact)
        throw new AppError("INVOICE_PDF_NOT_FOUND", "Invoice PDF is not available.", 404);
      await tx.publicInvoiceLink.update({
        where: { id: link.id },
        data: { lastDownloadedAt: new Date() }
      });
      await tx.auditEvent.create({
        data: {
          organizationId: link.organizationId,
          actorUserId: null,
          action: "PUBLIC_INVOICE_PDF_DOWNLOADED",
          targetType: "PublicInvoiceLink",
          targetId: link.id,
          metadata: { invoiceId: link.invoiceId }
        }
      });
      return { artifact, data: await this.storage.get(artifact.storageKey) };
    });
  }

  private async invoice(context: OrganizationContext, invoiceId: string) {
    const invoice = await withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      tx.invoice.findFirst({
        where: { id: invoiceId, organizationId: context.organizationId },
        include: { lines: { orderBy: { lineNumber: "asc" } } }
      })
    );
    if (!invoice) throw new AppError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);
    return invoice;
  }

  private async renderData(
    invoice: InvoiceWithLines,
    context: OrganizationContext
  ): Promise<InvoiceRenderData> {
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      this.renderDataInTransaction(tx, invoice, context.organizationId)
    );
  }

  private async renderDataInTransaction(
    tx: Prisma.TransactionClient,
    invoice: InvoiceWithLines | InvoiceRenderSource,
    organizationId: string
  ): Promise<InvoiceRenderData> {
    const stored = "renderData" in invoice ? parseStoredRenderData(invoice.renderData) : null;
    const durablePaymentLink = invoice.id
      ? await this.durablePaymentLinkInTransaction(tx, organizationId, invoice.id)
      : undefined;
    if (stored) {
      if (
        "renderDataHash" in invoice &&
        typeof invoice.renderDataHash === "string" &&
        renderDataHash(stored) !== invoice.renderDataHash
      )
        throw new AppError(
          "INVOICE_RENDER_DATA_TAMPERED",
          "The preserved invoice render data failed its integrity check.",
          500
        );
      if (durablePaymentLink) return { ...stored, durablePaymentLink };
      const storedWithoutLink = { ...stored };
      Reflect.deleteProperty(storedWithoutLink, "durablePaymentLink");
      return storedWithoutLink;
    }
    const config = await tx.invoiceTemplateConfig.findUnique({ where: { organizationId } });
    const paymentInstructionsSnapshot =
      await this.paymentInstructionService.renderSnapshotInTransaction(
        tx,
        organizationId,
        "paymentMethodSelection" in invoice && Array.isArray(invoice.paymentMethodSelection)
          ? invoice.paymentMethodSelection.filter(
              (value): value is string => typeof value === "string"
            )
          : null
      );
    const source = { ...invoice, paymentInstructionsSnapshot, durablePaymentLink };
    if (!config) return buildInvoiceRenderData(source);
    const definition = getInvoiceTemplate(config.templateKey);
    const configuration = validateTemplateConfiguration(
      definition,
      config.configuration as Partial<InvoiceTemplateConfiguration>
    );
    const assets = await this.assetSnapshotInTransaction(tx, organizationId, configuration);
    return buildInvoiceRenderData(
      source,
      definition.key,
      config.templateVersion,
      configuration,
      assets
    );
  }

  private async durablePaymentLinkInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    invoiceId: string
  ): Promise<InvoiceRenderData["durablePaymentLink"] | undefined> {
    const link = await tx.paymentLink.findFirst({
      where: { organizationId, invoiceId, status: "ACTIVE" },
      include: { paymentAccount: { select: { provider: true } } },
      orderBy: { createdAt: "desc" }
    });
    if (
      !link ||
      (link.paymentAccount.provider !== "STRIPE" && link.paymentAccount.provider !== "SQUARE")
    )
      return undefined;
    assertCustomerFacingPaymentUrl(link.providerLinkUrl);
    return { provider: link.paymentAccount.provider, url: link.providerLinkUrl };
  }

  private async renderAssets(
    data: InvoiceRenderData,
    context: OrganizationContext
  ): Promise<InvoiceRenderAssets> {
    return withTenantTransaction(this.prisma, dbContext(context), (tx) =>
      this.renderAssetsInTransaction(tx, data, context.organizationId)
    );
  }

  private async renderAssetsInTransaction(
    tx: Prisma.TransactionClient,
    data: InvoiceRenderData,
    organizationId: string
  ): Promise<InvoiceRenderAssets> {
    const references = {
      logo: data.assets?.logo ?? data.branding.logoAssetId,
      headerImage: data.assets?.headerImage ?? data.branding.headerImageAssetId
    };
    if (!references.logo && !references.headerImage) return { logo: null, headerImage: null };
    if (!this.logoStorage)
      throw new AppError(
        "INVOICE_RENDER_ASSET_STORAGE_UNAVAILABLE",
        "Invoice image storage is unavailable.",
        500
      );
    const load = async (
      reference: typeof references.logo,
      label: string
    ): Promise<InvoiceRenderAsset | null> => {
      if (!reference) return null;
      const id = typeof reference === "string" ? reference : reference.id;
      const asset = await tx.logoAsset.findFirst({
        where: { id, organizationId, scanStatus: "CLEAN" }
      });
      if (!asset)
        throw new AppError(
          "INVOICE_RENDER_ASSET_NOT_FOUND",
          `The preserved invoice ${label} was not found for this organization.`,
          422
        );
      if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(asset.mediaType))
        throw new AppError(
          "INVOICE_RENDER_ASSET_INVALID",
          `The preserved invoice ${label} has an unsupported media type.`,
          422
        );
      return {
        id: asset.id,
        mediaType: asset.mediaType as InvoiceRenderAsset["mediaType"],
        checksum: asset.checksum,
        width: asset.width,
        height: asset.height,
        data: await this.logoStorage!.get(asset.storageKey)
      };
    };
    return {
      logo: await load(references.logo, "logo"),
      headerImage: await load(references.headerImage, "header image")
    };
  }

  private async assetSnapshotInTransaction(
    tx: Prisma.TransactionClient,
    organizationId: string,
    configuration: InvoiceTemplateConfiguration
  ) {
    const load = async (id: string | null) => {
      if (!id) return null;
      const asset = await tx.logoAsset.findFirst({
        where: { id, organizationId, scanStatus: "CLEAN" }
      });
      if (!asset)
        throw new AppError(
          "INVOICE_RENDER_ASSET_NOT_FOUND",
          "A selected invoice image is unavailable.",
          422
        );
      return {
        id: asset.id,
        mediaType: asset.mediaType as InvoiceRenderAsset["mediaType"],
        checksum: asset.checksum,
        width: asset.width,
        height: asset.height
      };
    };
    return {
      logo: await load(configuration.logoAssetId),
      headerImage: await load(configuration.headerImageAssetId)
    };
  }

  private assertPublicRateLimit(tokenHash: string): void {
    const now = Date.now();
    const existing = this.publicHits.get(tokenHash);
    if (!existing || now - existing.startedAt >= 60_000) {
      this.publicHits.set(tokenHash, { startedAt: now, count: 1 });
      return;
    }
    existing.count += 1;
    if (existing.count > 60)
      throw new AppError("PUBLIC_INVOICE_RATE_LIMITED", "Too many invoice link requests.", 429);
  }
}

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;

function dbContext(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    actorUserId: context.user.id,
    companyId: context.companyId
  };
}

function artifactDto(artifact: {
  id: string;
  invoiceId: string;
  checksum: string;
  renderDataHash: string;
  byteSize: number;
  pageCount: number;
  createdAt: Date;
}) {
  return {
    id: artifact.id,
    invoiceId: artifact.invoiceId,
    checksum: artifact.checksum,
    renderDataHash: artifact.renderDataHash,
    byteSize: artifact.byteSize,
    pageCount: artifact.pageCount,
    createdAt: artifact.createdAt.toISOString(),
    downloadUrl: `/v1/invoices/${artifact.invoiceId}/pdf`
  };
}

function deliveryDto(delivery: {
  id: string;
  invoiceId: string;
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
    invoiceId: delivery.invoiceId,
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

export const allowedAttachmentMediaTypes = new Set([
  "application/pdf",
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp"
]);

export function normalizeAttachmentFileName(value: string): string {
  const fileName = value.trim();
  if (
    fileName.length === 0 ||
    fileName.length > 255 ||
    fileName === "." ||
    fileName === ".." ||
    Array.from(fileName).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || '/\\"'.includes(character);
    })
  )
    throw new AppError("INVOICE_ATTACHMENT_NAME_INVALID", "Attachment file name is invalid.", 422);
  return fileName;
}

export function inspectAttachmentBytes(data: Buffer, mediaType: string): boolean {
  if (mediaType === "application/pdf") return data.subarray(0, 5).toString("ascii") === "%PDF-";
  if (["text/plain", "text/csv", "application/csv"].includes(mediaType)) return !data.includes(0);
  if (mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return (
      data.length >= 4 &&
      data[0] === 0x50 &&
      data[1] === 0x4b &&
      data[2] === 0x03 &&
      data[3] === 0x04
    );
  if (mediaType === "image/png")
    return (
      data.length >= 24 &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  if (mediaType === "image/jpeg")
    return (
      data.length >= 4 &&
      data[0] === 0xff &&
      data[1] === 0xd8 &&
      data[data.length - 2] === 0xff &&
      data[data.length - 1] === 0xd9
    );
  if (mediaType === "image/webp")
    return (
      data.length >= 12 &&
      data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP"
    );
  return false;
}

function attachmentDto(attachment: {
  id: string;
  invoiceId: string;
  fileName: string;
  mediaType: string;
  byteSize: number;
  checksum: string;
  scanStatus: string;
  customerVisible: boolean;
  createdAt: Date;
}) {
  return {
    id: attachment.id,
    invoiceId: attachment.invoiceId,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    byteSize: attachment.byteSize,
    checksum: attachment.checksum,
    scanStatus: attachment.scanStatus,
    customerVisible: attachment.customerVisible,
    createdAt: attachment.createdAt.toISOString(),
    downloadUrl: `/v1/invoices/${attachment.invoiceId}/attachments/${attachment.id}`
  };
}

function eventDto(event: {
  id: string;
  eventType: string;
  providerReference: string | null;
  metadata: Prisma.JsonValue | null;
  occurredAt: Date;
}) {
  return {
    id: event.id,
    eventType: event.eventType,
    providerReference: event.providerReference,
    metadata: event.metadata,
    occurredAt: event.occurredAt.toISOString()
  };
}

function publicLinkDto(link: {
  id: string;
  invoiceId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: link.id,
    invoiceId: link.invoiceId,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    revokedAt: link.revokedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString()
  };
}
