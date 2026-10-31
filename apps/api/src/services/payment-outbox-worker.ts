import { Prisma, withPaymentWebhookTransaction, type PrismaClient } from "@clearledger/db";
import { PaymentService } from "./payment-service.js";

export interface ReceiptEmailMessage {
  readonly idempotencyKey: string;
  readonly recipientEmail: string;
  readonly receiptNumber: string;
  readonly renderData: Prisma.JsonValue;
}

export interface ReceiptEmailProvider {
  sendReceipt(message: ReceiptEmailMessage): Promise<{ readonly providerMessageId: string }>;
}

export class DevelopmentReceiptEmailProvider implements ReceiptEmailProvider {
  public readonly sent: ReceiptEmailMessage[] = [];

  public sendReceipt(
    message: ReceiptEmailMessage
  ): Promise<{ readonly providerMessageId: string }> {
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: `dev-receipt-${message.idempotencyKey}` });
  }
}

/**
 * A process host invokes this worker with an organization-scoped service actor.
 * Claiming uses SKIP LOCKED so concurrent workers cannot execute the same job.
 */
export class PaymentOutboxWorker {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly payments: PaymentService,
    private readonly receiptEmailProvider: ReceiptEmailProvider = new DevelopmentReceiptEmailProvider()
  ) {}

  public async processPendingWebhookEvents(
    organizationId: string,
    actorUserId: string,
    limit = 20
  ): Promise<number> {
    const jobs = await withPaymentWebhookTransaction(
      this.prisma,
      { organizationId, actorUserId },
      async (tx) => {
        const rows = await tx.$queryRaw<readonly { id: string; payload: Prisma.JsonValue }[]>`
          SELECT "id", "payload"
          FROM "OutboxEvent"
          WHERE "organizationId" = ${organizationId}::uuid
            AND "eventType" = 'payment.webhook-received'
            AND "status" IN ('PENDING', 'FAILED')
            AND "attempts" < 5
          ORDER BY "occurredAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        `;
        for (const row of rows)
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { status: "DISPATCHED", attempts: { increment: 1 }, dispatchedAt: new Date() }
          });
        return rows;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    for (const job of jobs) {
      const webhookEventId = readWebhookEventId(job.payload);
      try {
        await this.payments.processWebhookEvent(organizationId, actorUserId, webhookEventId);
      } catch {
        await withPaymentWebhookTransaction(this.prisma, { organizationId, actorUserId }, (tx) =>
          tx.outboxEvent.update({ where: { id: job.id }, data: { status: "FAILED" } })
        );
      }
    }
    return jobs.length;
  }

  public async processPendingReceiptEmails(
    organizationId: string,
    actorUserId: string,
    limit = 20
  ): Promise<number> {
    const jobs = await withPaymentWebhookTransaction(
      this.prisma,
      { organizationId, actorUserId },
      async (tx) => {
        const rows = await tx.$queryRaw<
          readonly {
            id: string;
            aggregateId: string;
          }[]
        >`
          SELECT "id", "aggregateId"
          FROM "OutboxEvent"
          WHERE "organizationId" = ${organizationId}::uuid
            AND "eventType" = 'payment.receipt-email-requested'
            AND "status" IN ('PENDING', 'FAILED')
            AND "attempts" < 5
          ORDER BY "occurredAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        `;
        for (const row of rows)
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { status: "DISPATCHED", attempts: { increment: 1 }, dispatchedAt: new Date() }
          });
        return rows;
      }
    );
    for (const job of jobs) {
      try {
        const message = await withPaymentWebhookTransaction(
          this.prisma,
          { organizationId, actorUserId },
          async (tx) => {
            const receipt = await tx.paymentReceipt.findFirst({
              where: { id: job.aggregateId, organizationId },
              include: { payment: { include: { customer: true } } }
            });
            if (!receipt?.payment.customer.email)
              throw new Error("Receipt delivery recipient is unavailable.");
            return {
              idempotencyKey: job.id,
              recipientEmail: receipt.payment.customer.email,
              receiptNumber: receipt.receiptNumber,
              renderData: receipt.renderData
            };
          }
        );
        await this.receiptEmailProvider.sendReceipt(message);
      } catch {
        await withPaymentWebhookTransaction(this.prisma, { organizationId, actorUserId }, (tx) =>
          tx.outboxEvent.update({
            where: { id: job.id },
            data: { status: "FAILED", dispatchedAt: null }
          })
        );
      }
    }
    return jobs.length;
  }
}

function readWebhookEventId(payload: Prisma.JsonValue): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Payment webhook outbox payload is invalid.");
  const webhookEventId = (payload as Record<string, unknown>).webhookEventId;
  if (typeof webhookEventId !== "string")
    throw new Error("Payment webhook outbox payload is invalid.");
  return webhookEventId;
}
