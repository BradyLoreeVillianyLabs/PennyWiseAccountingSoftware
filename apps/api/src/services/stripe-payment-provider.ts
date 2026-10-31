import Stripe from "stripe";
import { AppError } from "@clearledger/shared";
import { paymentWebhookHeader, type PaymentWebhookInput } from "./payment-provider.js";
import type {
  ConnectedAccountInput,
  ConnectedAccountStatus,
  HostedCheckoutInput,
  HostedCheckoutSession,
  NormalizedProviderEvent,
  PaymentProviderAdapter,
  ProviderFeeAndSettlement,
  ProviderPaymentStatus,
  ProviderRefundInput,
  ProviderRefundStatus
} from "./payment-provider.js";

export interface StripePaymentProviderConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly mode: "test" | "live";
}

/**
 * Stripe-hosted Checkout using direct charges on Accounts v2 connected businesses.
 * ClearLedger receives no application fee and never takes custody of payment funds.
 */
export class StripePaymentProviderAdapter implements PaymentProviderAdapter {
  private readonly stripe: Stripe;

  public constructor(private readonly config: StripePaymentProviderConfig) {
    const expectedPrefix = config.mode === "test" ? "sk_test_" : "sk_live_";
    if (!config.secretKey.startsWith(expectedPrefix))
      throw new Error(`Stripe ${config.mode} mode requires a matching secret key.`);
    if (!config.webhookSecret.startsWith("whsec_"))
      throw new Error("A Stripe webhook signing secret is required.");
    this.stripe = new Stripe(config.secretKey, {
      maxNetworkRetries: 2,
      timeout: 20_000
    });
  }

  public async createConnectedAccount(input: ConnectedAccountInput): Promise<string> {
    return this.protectProviderCall(async () => {
      const account = await this.stripe.v2.core.accounts.create(
        {
          contact_email: input.contactEmail,
          display_name: input.displayName,
          dashboard: "express",
          identity: { country: input.country },
          defaults: {
            currency: "cad",
            locales: ["en-CA"],
            responsibilities: {
              fees_collector: "stripe",
              losses_collector: "stripe"
            }
          },
          configuration: {
            merchant: {
              capabilities: {
                card_payments: { requested: true }
              }
            }
          },
          metadata: { clearledger_organization_id: input.organizationId },
          include: ["configuration.merchant", "requirements"]
        },
        { idempotencyKey: input.idempotencyKey }
      );
      this.assertTestMode(account.livemode);
      return account.id;
    });
  }

  public async createOnboardingLink(
    connectedAccountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string> {
    return this.protectProviderCall(async () => {
      const link = await this.stripe.v2.core.accountLinks.create({
        account: connectedAccountId,
        use_case: {
          type: "account_onboarding",
          account_onboarding: {
            configurations: ["merchant"],
            refresh_url: refreshUrl,
            return_url: returnUrl,
            collection_options: {
              fields: "eventually_due",
              future_requirements: "include"
            }
          }
        }
      });
      this.assertTestMode(link.livemode);
      return link.url;
    });
  }

  public async retrieveAccount(connectedAccountId: string): Promise<ConnectedAccountStatus> {
    return this.protectProviderCall(async () => {
      const [account, payoutStatus] = await Promise.all([
        this.stripe.v2.core.accounts.retrieve(connectedAccountId, {
          include: ["configuration.merchant", "requirements"]
        }),
        this.stripe.accounts.retrieve(connectedAccountId)
      ]);
      this.assertTestMode(account.livemode);
      const chargesEnabled =
        account.configuration?.merchant?.capabilities?.card_payments?.status === "active";
      const payoutsEnabled = payoutStatus.payouts_enabled;
      const requirementsDue =
        account.requirements?.entries
          ?.filter(
            (entry) =>
              entry.awaiting_action_from === "user" &&
              entry.minimum_deadline.status !== "eventually_due"
          )
          .map((entry) => entry.description) ?? [];
      return { chargesEnabled, payoutsEnabled, requirementsDue };
    });
  }

  public async createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutSession> {
    return this.protectProviderCall(async () => {
      const session = await this.stripe.checkout.sessions.create(
        {
          mode: "payment",
          ...(input.metadata.checkout_session_id
            ? { client_reference_id: input.metadata.checkout_session_id }
            : {}),
          ...(input.customerEmail ? { customer_email: input.customerEmail } : {}),
          expires_at: Math.floor(input.expiresAt.getTime() / 1000),
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.currency.toLowerCase(),
                unit_amount: toStripeInteger(input.amountMinor),
                product_data: { name: "Invoice payment" }
              }
            }
          ],
          metadata: { ...input.metadata },
          payment_intent_data: { metadata: { ...input.metadata } }
        },
        {
          stripeAccount: input.connectedAccountId,
          idempotencyKey: input.idempotencyKey
        }
      );
      if (!session.url)
        throw new AppError(
          "PAYMENT_PROVIDER_INVALID_RESPONSE",
          "The payment provider did not return a checkout URL.",
          502
        );
      return {
        providerSessionId: session.id,
        url: session.url,
        expiresAt: new Date(session.expires_at * 1000)
      };
    });
  }

  public async retrievePaymentStatus(
    connectedAccountId: string,
    providerPaymentId: string
  ): Promise<ProviderPaymentStatus> {
    return this.protectProviderCall(async () => {
      const intent = await this.stripe.paymentIntents.retrieve(
        providerPaymentId,
        {},
        { stripeAccount: connectedAccountId }
      );
      return {
        status: paymentStatus(intent.status),
        amountMinor: BigInt(intent.amount_received || intent.amount),
        currency: intent.currency.toUpperCase()
      };
    });
  }

  public verifyWebhook(rawBody: Buffer, headers: PaymentWebhookInput): NormalizedProviderEvent {
    const signature = paymentWebhookHeader(headers, "stripe-signature");
    if (!signature)
      throw new AppError(
        "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
        "Webhook signature is required.",
        401
      );
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.webhookSecret,
        300
      );
    } catch {
      throw new AppError(
        "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
        "Webhook signature is invalid or stale.",
        401
      );
    }
    return normalizeStripeEvent(event);
  }

  public async createRefund(
    input: ProviderRefundInput
  ): Promise<{ providerRefundId: string; status: "PENDING" | "SUCCEEDED" | "FAILED" }> {
    return this.protectProviderCall(async () => {
      const refund = await this.stripe.refunds.create(
        {
          payment_intent: input.providerPaymentId,
          amount: toStripeInteger(input.amountMinor),
          metadata: { clearledger_refund_key: input.idempotencyKey }
        },
        {
          stripeAccount: input.connectedAccountId,
          idempotencyKey: input.idempotencyKey
        }
      );
      return {
        providerRefundId: refund.id,
        status:
          refund.status === "succeeded"
            ? "SUCCEEDED"
            : refund.status === "failed" || refund.status === "canceled"
              ? "FAILED"
              : "PENDING"
      };
    });
  }

  public async retrieveRefundStatus(
    connectedAccountId: string,
    providerRefundId: string
  ): Promise<ProviderRefundStatus> {
    return this.protectProviderCall(async () => {
      const refund = await this.stripe.refunds.retrieve(
        providerRefundId,
        {},
        { stripeAccount: connectedAccountId }
      );
      return {
        status: refundStatus(refund.status),
        amountMinor: BigInt(refund.amount),
        currency: refund.currency.toUpperCase()
      };
    });
  }

  public async retrieveFeeAndSettlementMetadata(
    connectedAccountId: string,
    providerPaymentId: string
  ): Promise<ProviderFeeAndSettlement> {
    return this.protectProviderCall(async () => {
      const intent = await this.stripe.paymentIntents.retrieve(
        providerPaymentId,
        { expand: ["latest_charge.balance_transaction"] },
        { stripeAccount: connectedAccountId }
      );
      const charge =
        typeof intent.latest_charge === "object" && intent.latest_charge
          ? intent.latest_charge
          : null;
      const transaction =
        charge && typeof charge.balance_transaction === "object" && charge.balance_transaction
          ? charge.balance_transaction
          : null;
      return {
        feeMinor: BigInt(transaction?.fee ?? 0),
        netMinor: BigInt(transaction?.net ?? intent.amount_received),
        settlementId: transaction?.id ?? null,
        settlementAvailableAt: transaction?.available_on
          ? new Date(transaction.available_on * 1000)
          : null
      };
    });
  }

  private assertTestMode(livemode: boolean): void {
    if ((this.config.mode === "test") === livemode)
      throw new AppError(
        "PAYMENT_PROVIDER_MODE_MISMATCH",
        "The payment provider returned a resource from the wrong environment.",
        502
      );
  }

  private async protectProviderCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        "The payment provider could not complete the request.",
        502
      );
    }
  }
}

export function stripePaymentProviderFromEnvironment(): StripePaymentProviderAdapter {
  const mode = process.env.STRIPE_MODE;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if ((mode !== "test" && mode !== "live") || !secretKey || !webhookSecret)
    throw new Error("STRIPE_MODE, STRIPE_SECRET_KEY, and STRIPE_WEBHOOK_SECRET are required.");
  return new StripePaymentProviderAdapter({ mode, secretKey, webhookSecret });
}

function toStripeInteger(value: bigint): number {
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new AppError("PAYMENT_AMOUNT_INVALID", "Payment amount is outside provider limits.", 422);
  return Number(value);
}

function paymentStatus(status: Stripe.PaymentIntent.Status): ProviderPaymentStatus["status"] {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "canceled") return "CANCELLED";
  if (status === "processing") return "PROCESSING";
  if (status === "requires_payment_method") return "FAILED";
  return "PENDING";
}

function refundStatus(status: string | null): ProviderRefundStatus["status"] {
  if (status === "succeeded") return "SUCCEEDED";
  if (status === "failed") return "FAILED";
  if (status === "canceled") return "CANCELLED";
  return "PENDING";
}

function normalizeStripeEvent(event: Stripe.Event): NormalizedProviderEvent {
  const connectedAccountId = event.account;
  if (!connectedAccountId)
    throw new AppError(
      "PAYMENT_WEBHOOK_ACCOUNT_INVALID",
      "Webhook connected account is missing.",
      422
    );
  const occurredAt = new Date(event.created * 1000);
  if (event.type === "payment_intent.succeeded" || event.type === "payment_intent.payment_failed") {
    const intent = event.data.object;
    return {
      eventId: event.id,
      eventType: event.type === "payment_intent.succeeded" ? "payment_succeeded" : "payment_failed",
      connectedAccountId,
      providerPaymentId: intent.id,
      amountMinor: BigInt(intent.amount_received || intent.amount),
      feeMinor: 0n,
      currency: intent.currency.toUpperCase(),
      methodCategory: "CARD",
      occurredAt,
      ...(intent.metadata.checkout_session_id
        ? { providerSessionId: intent.metadata.checkout_session_id }
        : {})
    };
  }
  if (event.type === "refund.updated" || event.type === "refund.failed") {
    const refund = event.data.object;
    if (event.type === "refund.updated" && refund.status !== "succeeded")
      throw new AppError(
        "PAYMENT_WEBHOOK_IGNORED",
        "Webhook refund has not reached a terminal status.",
        202
      );
    if (!refund.payment_intent || typeof refund.payment_intent !== "string")
      throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook payment identifier is missing.", 422);
    return {
      eventId: event.id,
      eventType: event.type === "refund.failed" ? "refund_failed" : "refund_succeeded",
      connectedAccountId,
      providerPaymentId: refund.payment_intent,
      providerRefundId: refund.id,
      amountMinor: BigInt(refund.amount),
      feeMinor: 0n,
      currency: refund.currency.toUpperCase(),
      methodCategory: "CARD",
      occurredAt
    };
  }
  if (event.type === "charge.dispute.created" || event.type === "charge.dispute.updated") {
    const dispute = event.data.object;
    if (!dispute.payment_intent || typeof dispute.payment_intent !== "string")
      throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook payment identifier is missing.", 422);
    return {
      eventId: event.id,
      eventType: event.type === "charge.dispute.created" ? "dispute_created" : "dispute_updated",
      connectedAccountId,
      providerPaymentId: dispute.payment_intent,
      providerDisputeId: dispute.id,
      amountMinor: BigInt(dispute.amount),
      feeMinor: 0n,
      currency: dispute.currency.toUpperCase(),
      methodCategory: "CARD",
      occurredAt,
      reasonCategory: dispute.reason,
      disputeStatus: stripeDisputeStatus(dispute.status),
      ...(dispute.evidence_details.due_by
        ? { evidenceDueAt: new Date(dispute.evidence_details.due_by * 1000) }
        : {})
    };
  }
  throw new AppError("PAYMENT_WEBHOOK_IGNORED", "Webhook event is not supported.", 202);
}

function stripeDisputeStatus(
  status: Stripe.Dispute.Status
): NonNullable<NormalizedProviderEvent["disputeStatus"]> {
  if (status === "won") return "WON";
  if (status === "lost") return "LOST";
  if (status === "under_review" || status === "warning_under_review") return "UNDER_REVIEW";
  return "REVIEW_REQUIRED";
}
