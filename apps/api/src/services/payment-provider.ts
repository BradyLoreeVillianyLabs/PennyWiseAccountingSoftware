import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual as cryptoTimingSafeEqual
} from "node:crypto";
import { AppError } from "@clearledger/shared";

export interface PaymentAccountProtector {
  protect(value: string): string;
  reveal(value: string): string;
}

export class AesPaymentAccountProtector implements PaymentAccountProtector {
  private readonly key: Buffer;

  public constructor(secret: string) {
    if (secret.length < 24)
      throw new Error("Payment account encryption secret must contain at least 24 characters.");
    this.key = createHash("sha256").update(secret).digest();
  }

  public protect(value: string): string {
    const iv = Buffer.from(randomUUID().replaceAll("-", ""), "hex").subarray(0, 12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  }

  public reveal(value: string): string {
    const data = Buffer.from(value, "base64url");
    if (data.length < 29)
      throw new AppError(
        "PAYMENT_ACCOUNT_REFERENCE_INVALID",
        "Payment account reference is invalid.",
        500
      );
    const decipher = createDecipheriv("aes-256-gcm", this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  }
}

export interface HostedCheckoutInput {
  readonly connectedAccountId: string;
  readonly idempotencyKey: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly customerEmail: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface HostedCheckoutSession {
  readonly providerSessionId: string;
  readonly url: string;
  readonly expiresAt: Date;
}

export interface ProviderRefundInput {
  readonly connectedAccountId: string;
  readonly providerPaymentId: string;
  readonly amountMinor: bigint;
  readonly idempotencyKey: string;
}

export interface ConnectedAccountInput {
  readonly organizationId: string;
  readonly contactEmail: string;
  readonly displayName: string;
  readonly country: string;
  readonly idempotencyKey: string;
}

export interface ConnectedAccountStatus {
  /** Canonical provider merchant identity, if onboarding began with a tracking ID. */
  readonly providerAccountId?: string;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly requirementsDue: readonly string[];
}

export interface ProviderPaymentStatus {
  readonly status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly providerPaymentId?: string | undefined;
  readonly feeMinor?: bigint | undefined;
}

export interface ProviderRefundStatus {
  readonly status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface ProviderFeeAndSettlement {
  readonly feeMinor: bigint;
  readonly netMinor: bigint;
  readonly settlementId: string | null;
  readonly settlementAvailableAt: Date | null;
}

export interface NormalizedProviderEvent {
  readonly eventId: string;
  readonly eventType:
    | "payment_succeeded"
    | "payment_failed"
    | "refund_succeeded"
    | "refund_failed"
    | "dispute_created"
    | "dispute_updated";
  /** Provider account correlation. PayPal capture payloads may instead expose an order ID. */
  readonly connectedAccountId?: string | undefined;
  readonly providerPaymentId: string;
  readonly providerSessionId?: string | undefined;
  readonly providerRefundId?: string | undefined;
  readonly providerDisputeId?: string | undefined;
  readonly amountMinor: bigint;
  readonly feeMinor: bigint;
  readonly currency: string;
  readonly methodCategory: "CARD" | "OTHER";
  readonly occurredAt: Date;
  readonly reasonCategory?: string | undefined;
  readonly evidenceDueAt?: Date | undefined;
  readonly disputeStatus?:
    | "REVIEW_REQUIRED"
    | "UNDER_REVIEW"
    | "WON"
    | "LOST"
    | "CLOSED"
    | undefined;
}

export type PaymentWebhookHeaders = Readonly<Record<string, string | undefined>>;
/** String signatures remain supported for existing Stripe consumers. Routes use headers. */
export type PaymentWebhookInput = PaymentWebhookHeaders | string | undefined;

export function paymentWebhookHeader(input: PaymentWebhookInput, name: string): string | undefined {
  return typeof input === "string" ? input : input?.[name.toLowerCase()];
}

export interface PaymentProviderAdapter {
  createConnectedAccount(input: ConnectedAccountInput): Promise<string>;
  createOnboardingLink(
    connectedAccountId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string>;
  retrieveAccount(connectedAccountId: string): Promise<ConnectedAccountStatus>;
  createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutSession>;
  /** Provider-side expiry for hosted checkouts. Required before a provider can be enabled with durable expiry. */
  cancelHostedCheckout?(
    connectedAccountId: string,
    providerSessionId: string,
    idempotencyKey: string
  ): Promise<void>;
  retrievePaymentStatus(
    connectedAccountId: string,
    providerPaymentId: string
  ): Promise<ProviderPaymentStatus>;
  verifyWebhook(
    rawBody: Buffer,
    headers: PaymentWebhookInput
  ): NormalizedProviderEvent | Promise<NormalizedProviderEvent>;
  /** Approval is not capture. Only providers requiring an explicit server capture implement this. */
  captureHostedCheckout?(
    connectedAccountId: string,
    providerSessionId: string,
    idempotencyKey: string
  ): Promise<void>;
  createRefund(input: ProviderRefundInput): Promise<{
    readonly providerRefundId: string;
    readonly status: "PENDING" | "SUCCEEDED" | "FAILED";
  }>;
  retrieveRefundStatus(
    connectedAccountId: string,
    providerRefundId: string
  ): Promise<ProviderRefundStatus>;
  retrieveFeeAndSettlementMetadata(
    connectedAccountId: string,
    providerPaymentId: string
  ): Promise<ProviderFeeAndSettlement>;
}

/** Stripe-compatible test-mode adapter. It has no card data surface and signs test events with HMAC-SHA256. */
export class StripeTestModeAdapter implements PaymentProviderAdapter {
  public constructor(private readonly webhookSecret: string) {
    if (webhookSecret.length < 24) throw new Error("Stripe webhook secret is required.");
  }

  public createConnectedAccount(input: ConnectedAccountInput): Promise<string> {
    return Promise.resolve(
      `acct_test_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24)}`
    );
  }

  public createOnboardingLink(connectedAccountId: string, returnUrl: string): Promise<string> {
    return Promise.resolve(
      `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}stripe_account=${encodeURIComponent(connectedAccountId)}`
    );
  }

  public retrieveAccount(connectedAccountId: string): Promise<ConnectedAccountStatus> {
    if (!connectedAccountId.startsWith("acct_test_"))
      throw new AppError("PAYMENT_ACCOUNT_INVALID", "Payment account is invalid.", 422);
    return Promise.resolve({ chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] });
  }

  public createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutSession> {
    const providerSessionId = `cs_test_${createHash("sha256")
      .update(input.idempotencyKey)
      .digest("hex")
      .slice(0, 24)}`;
    return Promise.resolve({
      providerSessionId,
      url: `/provider/stripe-test/checkout/${providerSessionId}`,
      expiresAt: input.expiresAt
    });
  }

  public retrievePaymentStatus(): Promise<ProviderPaymentStatus> {
    return Promise.resolve({
      status: "PROCESSING",
      amountMinor: 0n,
      currency: "CAD"
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
    const [timestampPart, signaturePart] = signature.split(",");
    if (!timestampPart || !signaturePart)
      throw new AppError("PAYMENT_WEBHOOK_SIGNATURE_INVALID", "Webhook signature is invalid.", 401);
    const timestamp = timestampPart.startsWith("t=") ? Number(timestampPart.slice(2)) : Number.NaN;
    const digest = signaturePart.startsWith("v1=") ? signaturePart.slice(3) : "";
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp * 1000) > 300_000)
      throw new AppError("PAYMENT_WEBHOOK_SIGNATURE_STALE", "Webhook signature is stale.", 401);
    const expected = createHmac("sha256", this.webhookSecret)
      .update(`${timestampPart}.${rawBody.toString("utf8")}`)
      .digest("hex");
    if (!timingSafeEqual(expected, digest))
      throw new AppError("PAYMENT_WEBHOOK_SIGNATURE_INVALID", "Webhook signature is invalid.", 401);
    const parsed = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    const payload = parsed.data as Record<string, unknown> | undefined;
    if (!payload || typeof parsed.id !== "string" || typeof parsed.type !== "string")
      throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook payload is invalid.", 422);
    const amount = parseProviderAmount(payload.amount_minor);
    const fee = parseProviderAmount(payload.fee_minor ?? "0");
    const eventType = normalizeEventType(parsed.type);
    const connectedAccountId = requiredString(payload.connected_account_id, "connected_account_id");
    const providerPaymentId = requiredString(payload.payment_id, "payment_id");
    return {
      eventId: parsed.id,
      eventType,
      connectedAccountId,
      providerPaymentId,
      ...(typeof payload.checkout_session_id === "string"
        ? { providerSessionId: payload.checkout_session_id }
        : {}),
      ...(typeof payload.refund_id === "string" ? { providerRefundId: payload.refund_id } : {}),
      ...(typeof payload.dispute_id === "string" ? { providerDisputeId: payload.dispute_id } : {}),
      amountMinor: amount,
      feeMinor: fee,
      currency: requiredString(payload.currency, "currency"),
      methodCategory: "CARD",
      occurredAt: new Date(typeof parsed.created_at === "string" ? parsed.created_at : Date.now()),
      ...(typeof payload.reason_category === "string"
        ? { reasonCategory: payload.reason_category }
        : {}),
      ...(typeof payload.evidence_due_at === "string"
        ? { evidenceDueAt: new Date(payload.evidence_due_at) }
        : {}),
      ...(normalizeDisputeStatus(payload.dispute_status)
        ? { disputeStatus: normalizeDisputeStatus(payload.dispute_status)! }
        : {})
    };
  }

  public createRefund(
    input: ProviderRefundInput
  ): Promise<{ providerRefundId: string; status: "SUCCEEDED" }> {
    return Promise.resolve({
      providerRefundId: `re_test_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24)}`,
      status: "SUCCEEDED"
    });
  }

  public retrieveRefundStatus(): Promise<ProviderRefundStatus> {
    return Promise.resolve({
      status: "SUCCEEDED",
      amountMinor: 0n,
      currency: "CAD"
    });
  }

  public retrieveFeeAndSettlementMetadata(): Promise<ProviderFeeAndSettlement> {
    return Promise.resolve({
      feeMinor: 0n,
      netMinor: 0n,
      settlementId: null,
      settlementAvailableAt: null
    });
  }
}

function normalizeEventType(value: string): NormalizedProviderEvent["eventType"] {
  const eventTypes: Readonly<Record<string, NormalizedProviderEvent["eventType"]>> = {
    "payment_intent.succeeded": "payment_succeeded",
    "payment_intent.payment_failed": "payment_failed",
    "charge.refunded": "refund_succeeded",
    "refund.failed": "refund_failed",
    "charge.dispute.created": "dispute_created",
    "charge.dispute.updated": "dispute_updated"
  };
  const type = eventTypes[value];
  if (!type) throw new AppError("PAYMENT_WEBHOOK_IGNORED", "Webhook event is not supported.", 202);
  return type;
}

function normalizeDisputeStatus(
  value: unknown
): NormalizedProviderEvent["disputeStatus"] | undefined {
  if (typeof value !== "string") return undefined;
  const statuses: Readonly<Record<string, NonNullable<NormalizedProviderEvent["disputeStatus"]>>> =
    {
      warning_needs_response: "REVIEW_REQUIRED",
      warning_under_review: "UNDER_REVIEW",
      needs_response: "REVIEW_REQUIRED",
      under_review: "UNDER_REVIEW",
      won: "WON",
      lost: "LOST"
    };
  return statuses[value];
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new AppError("PAYMENT_WEBHOOK_INVALID", `Webhook ${name} is invalid.`, 422);
  return value;
}

function parseProviderAmount(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new AppError("PAYMENT_WEBHOOK_INVALID", "Webhook amount is invalid.", 422);
  return BigInt(value);
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && cryptoTimingSafeEqual(leftBuffer, rightBuffer);
}
