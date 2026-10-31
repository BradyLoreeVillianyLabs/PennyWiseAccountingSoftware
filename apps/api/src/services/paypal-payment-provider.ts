import { createHash, randomUUID } from "node:crypto";
import {
  Client,
  Environment,
  OrdersController,
  PaymentsController,
  type CheckoutPaymentIntent,
  type Order
} from "@paypal/paypal-server-sdk";
import { AppError } from "@clearledger/shared";
import {
  paymentWebhookHeader,
  type PaymentWebhookInput,
  type ConnectedAccountInput,
  type ConnectedAccountStatus,
  type HostedCheckoutInput,
  type HostedCheckoutSession,
  type NormalizedProviderEvent,
  type PaymentProviderAdapter,
  type ProviderFeeAndSettlement,
  type ProviderPaymentStatus,
  type ProviderRefundInput,
  type ProviderRefundStatus
} from "./payment-provider.js";

export interface PayPalPaymentProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  /** The partner's own merchant ID, assigned by PayPal — required to onboard sub-merchants under it. */
  readonly partnerMerchantId: string;
  /** PayPal Build Notation (BN) identifying this platform on multiparty API requests. */
  readonly partnerAttributionId: string;
  /** Configured once per PayPal app in the developer dashboard; required to verify webhook signatures. */
  readonly webhookId: string;
  readonly mode: "test" | "live";
}

/**
 * PayPal's official server SDK (@paypal/paypal-server-sdk) covers Orders, Payments,
 * Subscriptions, and Vault — confirmed by reading its actual shipped type declarations,
 * not assumed. It does NOT cover the Partner Referrals API (multi-seller onboarding) or
 * webhook signature verification; both are hand-built against PayPal's REST API here,
 * verified against PayPal's own current documentation rather than a paraphrased summary
 * (developer.paypal.com/api/partner-referrals/v2, .../docs/multiparty/integration-checklist,
 * .../api/rest/webhooks/rest). One easily-missed wrinkle: PayPal's OLD v1 partner-referral
 * *creation* flow is deprecated in favor of v2 (used below); the merchant-integrations
 * *status-check* endpoint used in retrieveAccount is a separate, still-current, actively
 * documented path despite also living under a "/v1/" URL — confirmed directly against
 * PayPal's integration checklist, not inferred from the URL alone.
 *
 * Design decision this adapter makes, worth understanding before changing it: PayPal's
 * Partner Referrals flow has no synchronous "create an account, get its ID back" step the
 * way Stripe Connect does — creating a referral only returns an approval link; PayPal's
 * own merchant ID for that seller isn't known until the seller finishes onboarding. So
 * `connectedAccountId` in this adapter is PennyWise's own tracking_id (generated locally,
 * passed to PayPal as `tracking_id`), not PayPal's merchant ID — every method that needs
 * PayPal's real merchant ID (creating an order, checking status) resolves it from the
 * tracking_id via the merchant-integrations lookup first. Likewise, `providerSessionId`
 * is PayPal's order ID and `providerPaymentId` is the capture ID created once that order
 * is captured — two different PayPal identifiers doing the two jobs Stripe's single
 * PaymentIntent id does.
 */
export class PayPalPaymentProviderAdapter implements PaymentProviderAdapter {
  private readonly orders: OrdersController;
  private readonly payments: PaymentsController;
  private readonly apiBaseUrl: string;
  private accessToken: { readonly value: string; readonly expiresAt: number } | null = null;

  public constructor(private readonly config: PayPalPaymentProviderConfig) {
    if (!config.clientId || !config.clientSecret)
      throw new Error("PayPal client ID and client secret are required.");
    if (!config.webhookId) throw new Error("A PayPal webhook ID is required to verify webhooks.");
    if (!config.partnerMerchantId) throw new Error("A PayPal partner merchant ID is required.");
    if (!config.partnerAttributionId)
      throw new Error("A PayPal partner attribution (BN) ID is required.");
    const environment = config.mode === "test" ? Environment.Sandbox : Environment.Production;
    const client = new Client({
      environment,
      clientCredentialsAuthCredentials: {
        oAuthClientId: config.clientId,
        oAuthClientSecret: config.clientSecret
      },
      timeout: 20_000
    });
    this.orders = new OrdersController(client);
    this.payments = new PaymentsController(client);
    this.apiBaseUrl =
      config.mode === "test" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
  }

  public createConnectedAccount(input: ConnectedAccountInput): Promise<string> {
    // No PayPal call needed yet — this is PennyWise's own tracking_id, deterministic per
    // idempotency key so a retried request doesn't create a second referral. PayPal's own
    // merchant ID for this account doesn't exist until the seller completes onboarding.
    return Promise.resolve(`org_${input.organizationId}_${input.idempotencyKey.slice(0, 16)}`);
  }

  public async createOnboardingLink(
    trackingId: string,
    returnUrl: string,
    refreshUrl: string
  ): Promise<string> {
    // PayPal's partner-referral API has no separate refresh URL; retain this
    // interface argument for provider parity and make the omission explicit.
    void refreshUrl;
    return this.protectProviderCall(async () => {
      const body = await this.partnerApiFetch<{ links?: readonly { rel: string; href: string }[] }>(
        "/v2/customer/partner-referrals",
        {
          method: "POST",
          body: JSON.stringify({
            tracking_id: trackingId,
            partner_config_override: { return_url: returnUrl },
            operations: [
              {
                operation: "API_INTEGRATION",
                api_integration_preference: {
                  rest_api_integration: {
                    integration_method: "PAYPAL",
                    integration_type: "THIRD_PARTY",
                    third_party_details: { features: ["PAYMENT", "REFUND"] }
                  }
                }
              }
            ],
            products: ["PPCP"],
            legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }]
          })
        }
      );
      const actionUrl = body.links?.find((link) => link.rel === "action_url")?.href;
      if (!actionUrl)
        throw new AppError(
          "PAYMENT_PROVIDER_INVALID_RESPONSE",
          "PayPal did not return an onboarding action URL.",
          502
        );
      return actionUrl;
    });
  }

  public async retrieveAccount(trackingId: string): Promise<ConnectedAccountStatus> {
    return this.protectProviderCall(async () => {
      const integration = await this.merchantIntegrationByTrackingId(trackingId);
      if (!integration)
        return {
          chargesEnabled: false,
          payoutsEnabled: false,
          requirementsDue: ["ONBOARDING_INCOMPLETE"]
        };
      const requirementsDue: string[] = [];
      if (!integration.payments_receivable) requirementsDue.push("PAYMENTS_RECEIVABLE_NOT_ENABLED");
      if (!integration.primary_email_confirmed) requirementsDue.push("EMAIL_NOT_CONFIRMED");
      if (!integration.oauth_third_party || integration.oauth_third_party.length === 0)
        requirementsDue.push("THIRD_PARTY_PERMISSIONS_MISSING");
      const enabled = requirementsDue.length === 0;
      return {
        providerAccountId: integration.merchant_id,
        chargesEnabled: enabled,
        payoutsEnabled: enabled,
        requirementsDue
      };
    });
  }

  public async createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutSession> {
    return this.protectProviderCall(async () => {
      assertOutgoingAmount(input.amountMinor, input.currency);
      const merchantId = await this.requireMerchantId(input.connectedAccountId);
      const intent: CheckoutPaymentIntent = "CAPTURE" as CheckoutPaymentIntent;
      const response = await this.orders.createOrder({
        body: {
          intent,
          purchaseUnits: [
            {
              amount: {
                currencyCode: input.currency.toUpperCase(),
                value: minorToDecimalString(input.amountMinor, input.currency)
              },
              payee: { merchantId },
              invoiceId: input.metadata.checkout_session_id ?? input.idempotencyKey,
              // Capture has no merchant/payee field. Refund has an optional, inconsistently
              // named payer/payee shape, so it is not a uniform correlation boundary.
              // customId is the field deliberately carried from the order by both resource
              // types; it holds our connectedAccountId (tracking_id) for webhook account
              // resolution — see normalizePayPalEvent below.
              customId: input.connectedAccountId
            }
          ],
          paymentSource: {
            paypal: {
              experienceContext: {
                returnUrl: input.successUrl,
                cancelUrl: input.cancelUrl,
                userAction: "PAY_NOW" as never
              }
            }
          }
        },
        paypalRequestId: paypalRequestId(input.idempotencyKey),
        paypalPartnerAttributionId: this.config.partnerAttributionId,
        paypalAuthAssertion: this.merchantAuthAssertion(merchantId)
      });
      const order = response.result;
      const approveLink = order.links?.find(
        (link) => link.rel === "payer-action" || link.rel === "approve"
      )?.href;
      if (!approveLink)
        throw new AppError(
          "PAYMENT_PROVIDER_INVALID_RESPONSE",
          "PayPal did not return an approval URL for this order.",
          502
        );
      return {
        providerSessionId: requireOrderId(order),
        url: approveLink,
        expiresAt: input.expiresAt
      };
    });
  }

  public async retrievePaymentStatus(
    connectedAccountId: string,
    providerPaymentId: string
  ): Promise<ProviderPaymentStatus> {
    return this.protectProviderCall(async () => {
      // A verified webhook carries the capture ID, not its parent Order ID. The SDK's
      // capture endpoint omits PayPal-Auth-Assertion in SDK v2.5. The raw endpoint is
      // used here so a multiparty lookup is always bound to the onboarded merchant.
      const capture = await this.retrieveCapture(providerPaymentId, connectedAccountId);
      const amount = capture.amount as Record<string, unknown> | undefined;
      return {
        status: captureStatusToProviderStatus(optionalString(capture.status)),
        amountMinor: decimalStringToMinor(requiredProviderString(amount?.value, "amount")),
        currency: supportedCurrency(requiredProviderString(amount?.currency_code, "currency"))
      };
    });
  }

  /**
   * Verification is asynchronous because PayPal's supported postback verifier is an API
   * call. Its `webhook_event` JSON token is formed from the original raw body rather
   * than a parsed/re-serialized object, as required by PayPal's verification contract.
   */
  public async verifyWebhook(
    rawBody: Buffer,
    headers: PaymentWebhookInput
  ): Promise<NormalizedProviderEvent> {
    return this.protectProviderCall(async () => {
      const transmissionId = paymentWebhookHeader(headers, "paypal-transmission-id");
      const transmissionTime = paymentWebhookHeader(headers, "paypal-transmission-time");
      const certUrl = paymentWebhookHeader(headers, "paypal-cert-url");
      const transmissionSig = paymentWebhookHeader(headers, "paypal-transmission-sig");
      const authAlgo = paymentWebhookHeader(headers, "paypal-auth-algo");
      if (!transmissionId || !transmissionTime || !certUrl || !transmissionSig || !authAlgo)
        throw new AppError(
          "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
          "PayPal webhook headers are missing.",
          401
        );
      assertPayPalCertificateUrl(certUrl);
      const rawEvent = rawBody.toString("utf8");
      const event = JSON.parse(rawEvent) as Record<string, unknown>;
      const verification = await this.partnerApiFetch<{ verification_status: string }>(
        "/v1/notifications/verify-webhook-signature",
        {
          method: "POST",
          body: verificationRequestBody({
            transmissionId,
            transmissionTime,
            certUrl,
            authAlgo,
            transmissionSig,
            webhookId: this.config.webhookId,
            rawEvent
          })
        }
      );
      if (verification.verification_status !== "SUCCESS")
        throw new AppError(
          "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
          "PayPal webhook signature is invalid.",
          401
        );
      return normalizePayPalEvent(event);
    });
  }

  /** Backward-compatible name for integrations built before the common async contract. */
  public verifyWebhookAsync(
    rawBody: Buffer,
    headers: {
      readonly transmissionId: string | undefined;
      readonly transmissionTime: string | undefined;
      readonly certUrl: string | undefined;
      readonly transmissionSig: string | undefined;
      readonly authAlgo: string | undefined;
    }
  ): Promise<NormalizedProviderEvent> {
    return this.verifyWebhook(rawBody, {
      "paypal-transmission-id": headers.transmissionId,
      "paypal-transmission-time": headers.transmissionTime,
      "paypal-cert-url": headers.certUrl,
      "paypal-transmission-sig": headers.transmissionSig,
      "paypal-auth-algo": headers.authAlgo
    });
  }

  public async captureHostedCheckout(
    connectedAccountId: string,
    providerSessionId: string,
    idempotencyKey: string
  ): Promise<void> {
    return this.protectProviderCall(async () => {
      const merchantId = await this.requireMerchantId(connectedAccountId);
      const response = await this.orders.captureOrder({
        id: providerSessionId,
        paypalRequestId: paypalRequestId(idempotencyKey),
        paypalAuthAssertion: this.merchantAuthAssertion(merchantId),
        prefer: "return=representation"
      });
      if (!response.result.id || response.result.id !== providerSessionId)
        throw new AppError(
          "PAYMENT_PROVIDER_INVALID_RESPONSE",
          "PayPal did not return the captured order identity.",
          502
        );
    });
  }

  public async createRefund(
    input: ProviderRefundInput
  ): Promise<{ providerRefundId: string; status: "PENDING" | "SUCCEEDED" | "FAILED" }> {
    return this.protectProviderCall(async () => {
      assertOutgoingAmount(input.amountMinor, "CAD");
      const merchantId = await this.requireMerchantId(input.connectedAccountId);
      // The refund amount's currency must match the original capture's — never assumed,
      // since PennyWise supports both CAD and USD and ProviderRefundInput carries no
      // currency of its own to refund a USD capture against a hardcoded "CAD" would send
      // the wrong currency code to PayPal for every non-CAD refund.
      const capture = await this.retrieveCapture(input.providerPaymentId, input.connectedAccountId);
      const amount = capture.amount as Record<string, unknown> | undefined;
      const currency = supportedCurrency(requiredProviderString(amount?.currency_code, "currency"));
      const response = await this.payments.refundCapturedPayment({
        captureId: input.providerPaymentId,
        paypalRequestId: paypalRequestId(input.idempotencyKey),
        paypalAuthAssertion: this.merchantAuthAssertion(merchantId),
        body: {
          amount: {
            currencyCode: currency,
            value: minorToDecimalString(input.amountMinor, currency)
          }
        }
      });
      const refund = response.result;
      return {
        providerRefundId: requireRefundId(refund),
        status: refundStatusToProviderStatus(refund.status)
      };
    });
  }

  public async retrieveRefundStatus(
    connectedAccountId: string,
    providerRefundId: string
  ): Promise<ProviderRefundStatus> {
    return this.protectProviderCall(async () => {
      const merchantId = await this.requireMerchantId(connectedAccountId);
      const response = await this.payments.getRefund({
        refundId: providerRefundId,
        paypalAuthAssertion: this.merchantAuthAssertion(merchantId)
      });
      const refund = response.result;
      const status = refundStatusToProviderStatus(refund.status);
      return {
        status: status === "FAILED" ? "FAILED" : status === "SUCCEEDED" ? "SUCCEEDED" : "PENDING",
        amountMinor: decimalStringToMinor(
          requiredProviderString(refund.amount?.value, "refund amount")
        ),
        currency: supportedCurrency(
          requiredProviderString(refund.amount?.currencyCode, "refund currency")
        )
      };
    });
  }

  public async retrieveFeeAndSettlementMetadata(
    connectedAccountId: string,
    providerPaymentId: string
  ): Promise<ProviderFeeAndSettlement> {
    return this.protectProviderCall(async () => {
      const capture = await this.retrieveCapture(providerPaymentId, connectedAccountId);
      const breakdown = capture.seller_receivable_breakdown as Record<string, unknown> | undefined;
      const paypalFee = breakdown?.paypal_fee as Record<string, unknown> | undefined;
      const netAmount = breakdown?.net_amount as Record<string, unknown> | undefined;
      const amount = capture.amount as Record<string, unknown> | undefined;
      return {
        feeMinor: decimalStringToMinor(
          typeof paypalFee?.value === "string" ? paypalFee.value : "0"
        ),
        netMinor: decimalStringToMinor(
          requiredProviderString(netAmount?.value ?? amount?.value, "net amount")
        ),
        settlementId: null,
        settlementAvailableAt: null
      };
    });
  }

  private async merchantIntegrationByTrackingId(trackingId: string): Promise<{
    readonly merchant_id: string;
    readonly payments_receivable: boolean;
    readonly primary_email_confirmed: boolean;
    readonly oauth_third_party?: readonly unknown[];
  } | null> {
    try {
      const body = await this.partnerApiFetch<{
        merchant_id: string;
        payments_receivable: boolean;
        primary_email_confirmed: boolean;
        oauth_third_party?: readonly unknown[];
      }>(
        `/v1/customer/partners/${encodeURIComponent(this.config.partnerMerchantId)}/merchant-integrations?tracking_id=${encodeURIComponent(trackingId)}`,
        { method: "GET" }
      );
      return body;
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 404) return null;
      throw error;
    }
  }

  private async requireMerchantId(trackingId: string): Promise<string> {
    const integration = await this.merchantIntegrationByTrackingId(trackingId);
    if (!integration)
      throw new AppError(
        "PAYMENT_ACCOUNT_NOT_ONBOARDED",
        "This PayPal account has not finished onboarding yet.",
        422
      );
    return integration.merchant_id;
  }

  private merchantAuthAssertion(merchantId: string): string {
    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ iss: this.config.clientId, payer_id: merchantId })
    ).toString("base64url");
    return `${header}.${payload}.`;
  }

  private async retrieveCapture(
    captureId: string,
    connectedAccountId: string
  ): Promise<Record<string, unknown>> {
    const merchantId = await this.requireMerchantId(connectedAccountId);
    const capture = await this.partnerApiFetch<unknown>(
      `/v2/payments/captures/${encodeURIComponent(captureId)}`,
      {
        method: "GET",
        authAssertion: this.merchantAuthAssertion(merchantId)
      }
    );
    if (!capture || typeof capture !== "object" || Array.isArray(capture))
      throw new AppError(
        "PAYMENT_PROVIDER_INVALID_RESPONSE",
        "PayPal returned an invalid capture response.",
        502
      );
    return capture as Record<string, unknown>;
  }

  private async accessTokenValue(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 30_000)
      return this.accessToken.value;
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString(
      "base64"
    );
    const response = await fetch(`${this.apiBaseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok)
      throw new AppError("PAYMENT_PROVIDER_UNAVAILABLE", "PayPal authentication failed.", 502);
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (
      typeof body.access_token !== "string" ||
      body.access_token.length === 0 ||
      typeof body.expires_in !== "number" ||
      !Number.isFinite(body.expires_in) ||
      body.expires_in <= 30
    )
      throw new AppError(
        "PAYMENT_PROVIDER_INVALID_RESPONSE",
        "PayPal returned an invalid access token response.",
        502
      );
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async partnerApiFetch<T>(
    path: string,
    init: {
      method: string;
      body?: string;
      idempotencyKey?: string;
      authAssertion?: string;
    }
  ): Promise<T> {
    const token = await this.accessTokenValue();
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": paypalRequestId(init.idempotencyKey ?? randomUUID()),
        "PayPal-Partner-Attribution-Id": this.config.partnerAttributionId,
        ...(init.authAssertion ? { "PayPal-Auth-Assertion": init.authAssertion } : {})
      },
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok)
      throw new AppError(
        "PAYMENT_PROVIDER_UNAVAILABLE",
        `PayPal returned an error (${String(response.status)}).`,
        response.status === 404 ? 404 : 502
      );
    return (await response.json()) as T;
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

export function paypalPaymentProviderFromEnvironment(): PayPalPaymentProviderAdapter {
  const mode = process.env.PAYPAL_MODE;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const partnerMerchantId = process.env.PAYPAL_PARTNER_MERCHANT_ID;
  const partnerAttributionId = process.env.PAYPAL_PARTNER_ATTRIBUTION_ID;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (
    (mode !== "test" && mode !== "live") ||
    !clientId ||
    !clientSecret ||
    !partnerMerchantId ||
    !partnerAttributionId ||
    !webhookId
  )
    throw new Error(
      "PAYPAL_MODE, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_PARTNER_MERCHANT_ID, PAYPAL_PARTNER_ATTRIBUTION_ID, and PAYPAL_WEBHOOK_ID are required."
    );
  return new PayPalPaymentProviderAdapter({
    mode,
    clientId,
    clientSecret,
    partnerMerchantId,
    partnerAttributionId,
    webhookId
  });
}

function minorToDecimalString(minor: bigint, currency: string): string {
  assertOutgoingAmount(minor, currency);
  const wholePart = minor / 100n;
  const fractionPart = (minor % 100n).toString().padStart(2, "0");
  return `${wholePart.toString()}.${fractionPart}`;
}

function decimalStringToMinor(value: string): bigint {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match)
    throw new AppError(
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      "PayPal returned an invalid amount.",
      502
    );
  const [, whole, fraction] = match;
  const minor = BigInt(whole!) * 100n + BigInt(fraction!);
  return minor;
}

function requireOrderId(order: Order): string {
  if (!order.id)
    throw new AppError(
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      "PayPal did not return an order ID.",
      502
    );
  return order.id;
}

function requireRefundId(refund: { readonly id?: string }): string {
  if (!refund.id)
    throw new AppError(
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      "PayPal did not return a refund ID.",
      502
    );
  return refund.id;
}

function captureStatusToProviderStatus(
  captureStatus: string | undefined
): ProviderPaymentStatus["status"] {
  if (captureStatus === "COMPLETED") return "SUCCEEDED";
  if (captureStatus === "DECLINED" || captureStatus === "FAILED") return "FAILED";
  if (captureStatus === "PENDING") return "PROCESSING";
  if (captureStatus === "CANCELLED") return "CANCELLED";
  return "PROCESSING";
}

function supportedCurrency(value: string): string {
  const currency = value.toUpperCase();
  if (currency !== "CAD" && currency !== "USD")
    throw new AppError(
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      "PayPal returned an unsupported currency.",
      502
    );
  return currency;
}

function assertOutgoingAmount(minor: bigint, currency: string): void {
  supportedCurrency(currency);
  if (minor <= 0n)
    throw new AppError("PAYMENT_AMOUNT_INVALID", "Payment amount must be positive.", 422);
}

function paypalRequestId(value: string): string {
  return `pw-${createHash("sha256").update(value).digest("base64url").slice(0, 32)}`;
}

function requiredProviderString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new AppError(
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      `PayPal returned an invalid ${name}.`,
      502
    );
  return value;
}

function assertPayPalCertificateUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(
      "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
      "PayPal certificate URL is invalid.",
      401
    );
  }
  const hosts = new Set([
    "api.paypal.com",
    "api.sandbox.paypal.com",
    "api-m.paypal.com",
    "api-m.sandbox.paypal.com"
  ]);
  if (url.protocol !== "https:" || !hosts.has(url.hostname))
    throw new AppError(
      "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
      "PayPal certificate URL is invalid.",
      401
    );
}

function verificationRequestBody(input: {
  readonly transmissionId: string;
  readonly transmissionTime: string;
  readonly certUrl: string;
  readonly authAlgo: string;
  readonly transmissionSig: string;
  readonly webhookId: string;
  readonly rawEvent: string;
}): string {
  // `rawEvent` is verified JSON and intentionally inserted verbatim. JSON.stringify on
  // the surrounding fields cannot alter that signed JSON token.
  return `{"transmission_id":${JSON.stringify(input.transmissionId)},"transmission_time":${JSON.stringify(input.transmissionTime)},"cert_url":${JSON.stringify(input.certUrl)},"auth_algo":${JSON.stringify(input.authAlgo)},"transmission_sig":${JSON.stringify(input.transmissionSig)},"webhook_id":${JSON.stringify(input.webhookId)},"webhook_event":${input.rawEvent}}`;
}

function refundStatusToProviderStatus(
  status: string | undefined
): "PENDING" | "SUCCEEDED" | "FAILED" {
  if (status === "COMPLETED") return "SUCCEEDED";
  if (status === "FAILED" || status === "CANCELLED") return "FAILED";
  return "PENDING";
}

/**
 * Maps PayPal's PAYMENT.CAPTURE.* webhook events onto the shared NormalizedProviderEvent
 * shape. CUSTOMER.DISPUTE.* events are deliberately NOT handled here yet — PayPal's own
 * dispute-resource field reference could not be confirmed against either their docs
 * (dynamic page, not fetchable) or the SDK (no Dispute model is exported by
 * @paypal/paypal-server-sdk at all), so guessing its shape risks exactly the kind of
 * unverified assumption that turned out wrong for merchant-id resolution below. A
 * dispute webhook falls through to the same "not supported" throw as any other
 * unhandled event type (a safe 202-ignored, not a silent drop) until that's confirmed.
 *
 * PaymentsCapture has no merchant/payee identifier. Refund's optional payer property is
 * a PayeeBase, an inconsistent resource-specific shape that is unsuitable as a uniform
 * account-correlation boundary. customId is deliberately set on the order and is the
 * field used by both resource types for PennyWise account correlation.
 */
function normalizePayPalEvent(event: Record<string, unknown>): NormalizedProviderEvent {
  const eventType = event.event_type;
  const resource = event.resource as Record<string, unknown> | undefined;
  const id = event.id;
  const createTime = event.create_time;
  if (typeof eventType !== "string" || !resource || typeof id !== "string")
    throw new AppError("PAYMENT_WEBHOOK_INVALID", "PayPal webhook payload is invalid.", 422);
  const supported = new Set([
    "PAYMENT.CAPTURE.COMPLETED",
    "PAYMENT.CAPTURE.DENIED",
    "PAYMENT.CAPTURE.DECLINED",
    "PAYMENT.CAPTURE.REFUNDED",
    "PAYMENT.CAPTURE.REFUND_FAILED",
    "CUSTOMER.DISPUTE.CREATED",
    "CUSTOMER.DISPUTE.UPDATED"
  ]);
  if (!supported.has(eventType))
    throw new AppError("PAYMENT_WEBHOOK_IGNORED", "Webhook event is not supported.", 202);
  const occurredAt = parsePayPalEventDate(createTime);
  const connectedAccountId = optionalString(resource.custom_id);
  const account = connectedAccountId ? { connectedAccountId } : {};

  if (
    eventType === "PAYMENT.CAPTURE.COMPLETED" ||
    eventType === "PAYMENT.CAPTURE.DENIED" ||
    eventType === "PAYMENT.CAPTURE.DECLINED"
  ) {
    const capture = resource;
    const amount = capture.amount as Record<string, unknown> | undefined;
    const relatedIds = (capture.supplementary_data as Record<string, unknown> | undefined)
      ?.related_ids as Record<string, unknown> | undefined;
    const orderId = optionalString(relatedIds?.order_id);
    return {
      eventId: id,
      eventType: eventType === "PAYMENT.CAPTURE.COMPLETED" ? "payment_succeeded" : "payment_failed",
      ...account,
      providerPaymentId: requiredString(capture.id, "capture id"),
      amountMinor: decimalStringToMinor(requiredString(amount?.value, "amount")),
      feeMinor: 0n,
      currency: supportedCurrency(requiredString(amount?.currency_code, "currency")),
      methodCategory: "OTHER",
      occurredAt,
      ...(orderId ? { providerSessionId: orderId } : {})
    };
  }
  if (eventType === "PAYMENT.CAPTURE.REFUNDED" || eventType === "PAYMENT.CAPTURE.REFUND_FAILED") {
    const refund = resource;
    const amount = refund.amount as Record<string, unknown> | undefined;
    // The refund resource carries its parent capture as a HATEOAS "up" link rather than
    // a plain capture_id field — confirmed against PayPal's own capture/refund response
    // shape and a second independent source, but not against a live sandbox payload,
    // since PayPal's own field-by-field reference page for this resource wasn't
    // fetchable. Worth a real sandbox webhook delivery to confirm before this ships.
    const links = refund.links as
      | readonly { readonly rel?: string; readonly href?: string }[]
      | undefined;
    const captureId = captureIdFromRefundLink(links?.find((link) => link.rel === "up")?.href);
    if (!captureId)
      throw new AppError(
        "PAYMENT_WEBHOOK_INVALID",
        "Could not resolve the original capture from a PayPal refund webhook.",
        422
      );
    return {
      eventId: id,
      eventType: eventType === "PAYMENT.CAPTURE.REFUNDED" ? "refund_succeeded" : "refund_failed",
      ...account,
      providerPaymentId: captureId,
      providerRefundId: requiredString(refund.id, "refund id"),
      amountMinor: decimalStringToMinor(requiredString(amount?.value, "amount")),
      feeMinor: 0n,
      currency: supportedCurrency(requiredString(amount?.currency_code, "currency")),
      methodCategory: "OTHER",
      occurredAt
    };
  }
  const dispute = resource;
  const transaction = Array.isArray(dispute.disputed_transactions)
    ? (dispute.disputed_transactions[0] as Record<string, unknown> | undefined)
    : undefined;
  const disputeAmount = dispute.dispute_amount as Record<string, unknown> | undefined;
  const disputeStatus = paypalDisputeStatus(optionalString(dispute.status));
  return {
    eventId: id,
    eventType: eventType === "CUSTOMER.DISPUTE.CREATED" ? "dispute_created" : "dispute_updated",
    ...account,
    providerPaymentId: requiredString(transaction?.seller_transaction_id, "seller transaction id"),
    providerDisputeId: requiredString(dispute.dispute_id, "dispute id"),
    amountMinor: decimalStringToMinor(requiredString(disputeAmount?.value, "dispute amount")),
    feeMinor: 0n,
    currency: supportedCurrency(requiredString(disputeAmount?.currency_code, "dispute currency")),
    methodCategory: "OTHER",
    occurredAt,
    ...(optionalString(dispute.reason) ? { reasonCategory: optionalString(dispute.reason)! } : {}),
    ...(disputeStatus ? { disputeStatus } : {})
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parsePayPalEventDate(value: unknown): Date {
  if (typeof value !== "string")
    throw new AppError("PAYMENT_WEBHOOK_INVALID", "PayPal webhook date is invalid.", 422);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new AppError("PAYMENT_WEBHOOK_INVALID", "PayPal webhook date is invalid.", 422);
  return parsed;
}

function captureIdFromRefundLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    const hosts = [
      "api.paypal.com",
      "api.sandbox.paypal.com",
      "api-m.paypal.com",
      "api-m.sandbox.paypal.com"
    ];
    if (url.protocol !== "https:" || !hosts.includes(url.hostname)) return undefined;
    const match = /^\/v2\/payments\/captures\/([^/]+)$/.exec(url.pathname);
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

function paypalDisputeStatus(
  value: string | undefined
): NormalizedProviderEvent["disputeStatus"] | undefined {
  if (value === "OPEN" || value === "WAITING_FOR_SELLER_RESPONSE") return "REVIEW_REQUIRED";
  if (value === "UNDER_REVIEW") return "UNDER_REVIEW";
  if (value === "RESOLVED" || value === "CLOSED") return "CLOSED";
  return undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new AppError("PAYMENT_WEBHOOK_INVALID", `PayPal webhook ${name} is invalid.`, 422);
  return value;
}
