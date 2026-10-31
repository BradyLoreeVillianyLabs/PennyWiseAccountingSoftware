import { Prisma, withPaymentWebhookTransaction, type PrismaClient } from "@clearledger/db";
import { AppError } from "@clearledger/shared";
import type { PaymentAccountProtector, PaymentProviderAdapter } from "./payment-provider.js";
import type { HostedPaymentProvider } from "./payment-service.js";

const DEFAULT_CLAIM_LEASE_MS = 5 * 60_000;
const MAX_SWEEP_LIMIT = 100;

export interface PaymentCheckoutExpiryResult {
  readonly claimed: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly skipped: number;
}

interface DueCheckoutSession {
  readonly id: string;
  readonly paymentAccountId: string;
  readonly providerSessionId: string;
  readonly providerAccountCiphertext: string | null;
  readonly cancellationClaimedAt: Date;
}

/**
 * Cancels expired hosted checkouts without scanning outside a tenant context.
 *
 * The worker deliberately receives one organization at a time. A process host
 * must enumerate organizations through its existing authorized control plane;
 * this class never uses a blank-context query or a database superuser. Provider
 * calls happen after the short claim transaction commits, and a lease lets a
 * later run recover sessions abandoned by a crash.
 */
export class PaymentCheckoutExpiryWorker {
  public constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: PaymentProviderAdapter,
    private readonly providerKind: HostedPaymentProvider,
    private readonly protector: PaymentAccountProtector,
    private readonly now: () => Date = () => new Date(),
    private readonly claimLeaseMs = DEFAULT_CLAIM_LEASE_MS
  ) {
    if (!Number.isSafeInteger(claimLeaseMs) || claimLeaseMs < 1_000)
      throw new Error("Payment checkout claim lease must be at least one second.");
  }

  public async sweep(
    organizationId: string,
    actorUserId: string,
    limit = 20
  ): Promise<PaymentCheckoutExpiryResult> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SWEEP_LIMIT)
      throw new Error(
        `Payment checkout expiry limit must be between 1 and ${String(MAX_SWEEP_LIMIT)}.`
      );
    const claimedAt = this.now();
    const claimBefore = new Date(claimedAt.getTime() - this.claimLeaseMs);
    const candidates = await withPaymentWebhookTransaction(
      this.prisma,
      { organizationId, actorUserId },
      async (tx) => {
        const rows = await tx.$queryRaw<
          readonly {
            id: string;
            paymentAccountId: string;
            providerSessionId: string;
            providerAccountCiphertext: string | null;
          }[]
        >`
          SELECT session."id", session."paymentAccountId", session."providerSessionId",
                 account."providerAccountCiphertext"
          FROM "PaymentCheckoutSession" AS session
          INNER JOIN "PaymentAccount" AS account
            ON account."organizationId" = session."organizationId"
           AND account."id" = session."paymentAccountId"
          WHERE session."organizationId" = ${organizationId}::uuid
            AND account."provider" = ${this.providerKind}::"PaymentProvider"
            AND session."completedAt" IS NULL
            AND session."cancelledAt" IS NULL
            AND session."expiresAt" <= ${claimedAt}
            AND (
              session."cancellationClaimedAt" IS NULL
              OR session."cancellationClaimedAt" <= ${claimBefore}
            )
          ORDER BY session."expiresAt" ASC, session."id" ASC
          LIMIT ${limit}
          FOR UPDATE OF session SKIP LOCKED
        `;
        const claimed: DueCheckoutSession[] = [];
        for (const row of rows) {
          const result = await tx.paymentCheckoutSession.updateMany({
            where: {
              organizationId,
              id: row.id,
              completedAt: null,
              cancelledAt: null
            },
            data: {
              cancellationClaimedAt: claimedAt,
              cancellationAttempts: { increment: 1 },
              cancellationLastError: null
            }
          });
          if (result.count === 1)
            claimed.push({
              ...row,
              cancellationClaimedAt: claimedAt
            });
        }
        return claimed;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    let cancelled = 0;
    let failed = 0;
    let skipped = 0;
    for (const candidate of candidates) {
      try {
        if (!candidate.providerAccountCiphertext)
          throw new AppError(
            "PAYMENT_ACCOUNT_REFERENCE_INVALID",
            "Payment account reference is unavailable.",
            500
          );
        if (!this.provider.cancelHostedCheckout)
          throw new AppError(
            "PAYMENT_CHECKOUT_CANCELLATION_UNSUPPORTED",
            "This payment provider does not support provider-side checkout cancellation.",
            500
          );
        await this.provider.cancelHostedCheckout(
          this.protector.reveal(candidate.providerAccountCiphertext),
          candidate.providerSessionId,
          `checkout-expiry:${candidate.id}`
        );
        const completedAt = this.now();
        const result = await withPaymentWebhookTransaction(
          this.prisma,
          { organizationId, actorUserId },
          (tx) =>
            tx.paymentCheckoutSession.updateMany({
              where: {
                organizationId,
                id: candidate.id,
                completedAt: null,
                cancelledAt: null,
                cancellationClaimedAt: candidate.cancellationClaimedAt
              },
              data: {
                cancelledAt: completedAt,
                cancellationClaimedAt: null,
                cancellationLastError: null
              }
            })
        );
        if (result.count === 1) cancelled++;
        else skipped++;
      } catch (error) {
        failed++;
        await withPaymentWebhookTransaction(this.prisma, { organizationId, actorUserId }, (tx) =>
          tx.paymentCheckoutSession.updateMany({
            where: {
              organizationId,
              id: candidate.id,
              completedAt: null,
              cancelledAt: null,
              cancellationClaimedAt: candidate.cancellationClaimedAt
            },
            data: {
              cancellationLastError: cancellationErrorCode(error),
              cancellationClaimedAt: this.now()
            }
          })
        );
      }
    }
    return { claimed: candidates.length, cancelled, failed, skipped };
  }
}

function cancellationErrorCode(error: unknown): string {
  if (error instanceof AppError) return error.code.slice(0, 500);
  return "PAYMENT_CHECKOUT_CANCELLATION_FAILED";
}
