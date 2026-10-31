import Stripe from "stripe";
import { SquareClient, SquareEnvironment, type Square } from "square";
import { AppError } from "@clearledger/shared";

export type OwnAccountPaymentProviderKind = "STRIPE" | "SQUARE";

export interface OwnAccountPaymentLinkInput {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly customerEmail: string | null;
  readonly idempotencyKey: string;
}

export interface OwnAccountPaymentLink {
  readonly providerLinkId: string;
  readonly url: string;
  readonly accountId: string;
}

export interface OwnAccountPaymentStatus {
  readonly status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly providerPaymentId?: string | undefined;
  readonly amountMinor: bigint;
  readonly feeMinor: bigint;
  readonly currency: string;
}

export interface OwnAccountConnection {
  readonly accountId: string;
  readonly displayName: string;
  readonly locationId?: string | undefined;
}

export interface OwnAccountPaymentProvider {
  readonly kind: OwnAccountPaymentProviderKind;
  testConnection(): Promise<OwnAccountConnection>;
  createPaymentLink(input: OwnAccountPaymentLinkInput): Promise<OwnAccountPaymentLink>;
  retrievePaymentStatus(providerLinkId: string): Promise<OwnAccountPaymentStatus>;
  deactivatePaymentLink(providerLinkId: string): Promise<void>;
}

export interface OwnAccountPaymentProviderOptions {
  readonly mode: "test" | "live";
  readonly locationId?: string | undefined;
  /** Test-only transport seam; production leaves this unset and uses provider defaults. */
  readonly apiBase?: string | undefined;
}

export type OwnAccountPaymentProviderFactory = (
  provider: OwnAccountPaymentProviderKind,
  credential: string,
  options: OwnAccountPaymentProviderOptions
) => OwnAccountPaymentProvider;

export interface SquareOwnAccountConfig {
  readonly accessToken: string;
  readonly locationId: string;
  readonly mode: "test" | "live";
  readonly baseUrl?: string | undefined;
}

export class SquareOwnAccountPaymentProvider implements OwnAccountPaymentProvider {
  public readonly kind = "SQUARE" as const;
  private readonly client: SquareClient;

  public constructor(private readonly config: SquareOwnAccountConfig) {
    if (!config.accessToken.trim()) throw new Error("Square access token is required.");
    if (!config.locationId.trim()) throw new Error("Square location ID is required.");
    this.client = new SquareClient({
      token: config.accessToken,
      environment:
        config.mode === "test" ? SquareEnvironment.Sandbox : SquareEnvironment.Production,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
      maxRetries: 1,
      timeoutInSeconds: 20
    });
  }

  public async testConnection(): Promise<OwnAccountConnection> {
    const response = await this.client.locations.list();
    const location = response.locations?.find(
      (candidate) => candidate.id === this.config.locationId
    );
    if (!location?.id)
      throw new AppError("PAYMENT_ACCOUNT_INVALID", "The Square location was not found.", 422);
    return {
      accountId: location.merchantId ?? location.id,
      displayName: location.businessName ?? location.name ?? "Square account",
      locationId: location.id
    };
  }

  public async createPaymentLink(
    input: OwnAccountPaymentLinkInput
  ): Promise<OwnAccountPaymentLink> {
    assertPositiveAmount(input.amountMinor);
    const response = await this.client.checkout.paymentLinks.create({
      idempotencyKey: input.idempotencyKey,
      description: `PennyWise invoice ${input.invoiceNumber}`,
      paymentNote: `PennyWise invoice ${input.invoiceId}`,
      quickPay: {
        name: `Invoice ${input.invoiceNumber}`,
        priceMoney: {
          amount: input.amountMinor,
          currency: input.currency.toUpperCase() as Square.Currency
        },
        locationId: this.config.locationId
      }
    });
    const link = response.paymentLink;
    if (!link?.id || !link.url)
      throw new AppError(
        "PAYMENT_PROVIDER_INVALID_RESPONSE",
        "Square did not return a payment link.",
        502
      );
    const connection = await this.testConnection();
    return { providerLinkId: link.id, url: link.url, accountId: connection.accountId };
  }

  public async retrievePaymentStatus(providerLinkId: string): Promise<OwnAccountPaymentStatus> {
    const linkResponse = await this.client.checkout.paymentLinks.get({ id: providerLinkId });
    const orderId = linkResponse.paymentLink?.orderId;
    if (!orderId)
      return {
        status: "PENDING",
        amountMinor: 0n,
        feeMinor: 0n,
        currency: "CAD"
      };
    const page = await this.client.payments.list({
      locationId: this.config.locationId,
      beginTime: new Date(Date.now() - 366 * 24 * 60 * 60_000).toISOString(),
      limit: 100
    });
    const payments: Square.Payment[] = [];
    for await (const candidate of page) payments.push(candidate);
    const payment = payments.find((candidate) => candidate.orderId === orderId);
    if (!payment)
      return {
        status: "PENDING",
        amountMinor: 0n,
        feeMinor: 0n,
        currency: "CAD"
      };
    const amount = providerMinorToBigInt(payment.amountMoney?.amount);
    const fee = (payment.processingFee ?? []).reduce(
      (sum: bigint, item: Square.ProcessingFee) =>
        sum + providerMinorToBigInt(item.amountMoney?.amount),
      0n
    );
    return {
      status: squarePaymentStatus(payment.status),
      ...(payment.id ? { providerPaymentId: payment.id } : {}),
      amountMinor: amount,
      feeMinor: fee,
      currency: payment.amountMoney?.currency ?? "CAD"
    };
  }

  public async deactivatePaymentLink(providerLinkId: string): Promise<void> {
    const current = await this.client.checkout.paymentLinks.get({ id: providerLinkId });
    if (!current.paymentLink?.id) return;
    await this.client.checkout.paymentLinks.delete({ id: providerLinkId });
  }
}

export interface StripeOwnAccountConfig {
  readonly secretKey: string;
  readonly mode: "test" | "live";
  readonly apiBase?: string | undefined;
}

export class StripeOwnAccountPaymentProvider implements OwnAccountPaymentProvider {
  public readonly kind = "STRIPE" as const;
  private readonly stripe: Stripe;

  public constructor(private readonly config: StripeOwnAccountConfig) {
    const expectedPrefix = config.mode === "test" ? "sk_test_" : "sk_live_";
    if (!config.secretKey.startsWith(expectedPrefix))
      throw new Error(`Stripe ${config.mode} mode requires a matching secret key.`);
    this.stripe = new Stripe(config.secretKey, {
      maxNetworkRetries: 1,
      ...(config.apiBase
        ? {
            host: new URL(config.apiBase).hostname,
            port: Number(new URL(config.apiBase).port || 443),
            protocol: new URL(config.apiBase).protocol.replace(":", "") as "http" | "https"
          }
        : {})
    });
  }

  public async testConnection(): Promise<OwnAccountConnection> {
    const account = (await this.stripe.rawRequest("GET", "/v1/account")) as {
      id?: string;
      email?: string | null;
      business_profile?: { name?: string | null } | null;
      settings?: { dashboard?: { display_name?: string | null } | null } | null;
    };
    return {
      accountId: account.id ?? "stripe-own-account",
      displayName:
        account.business_profile?.name ??
        account.settings?.dashboard?.display_name ??
        account.email ??
        "Stripe account"
    };
  }

  public async createPaymentLink(
    input: OwnAccountPaymentLinkInput
  ): Promise<OwnAccountPaymentLink> {
    assertPositiveAmount(input.amountMinor);
    const link = await this.stripe.paymentLinks.create(
      {
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: toStripeInteger(input.amountMinor),
              product_data: { name: `Invoice ${input.invoiceNumber}` }
            }
          }
        ],
        metadata: { invoice_id: input.invoiceId },
        payment_intent_data: { metadata: { invoice_id: input.invoiceId } },
        restrictions: { completed_sessions: { limit: 1 } },
        inactive_message:
          "This invoice payment link is no longer active. Contact the business for a new link.",
        ...(input.customerEmail ? { customer_creation: "if_required" as const } : {})
      },
      { idempotencyKey: input.idempotencyKey }
    );
    return {
      providerLinkId: link.id,
      url: link.url,
      accountId: (await this.testConnection()).accountId
    };
  }

  public async retrievePaymentStatus(providerLinkId: string): Promise<OwnAccountPaymentStatus> {
    const link = await this.stripe.paymentLinks.retrieve(providerLinkId);
    const sessions = await this.stripe.checkout.sessions.list({
      payment_link: providerLinkId,
      limit: 1
    });
    const session = sessions.data.find((candidate) => candidate.payment_status === "paid");
    if (!session) {
      return {
        status: link.active ? "PENDING" : "CANCELLED",
        amountMinor: 0n,
        feeMinor: 0n,
        currency: link.currency.toUpperCase()
      };
    }
    const paymentIntent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    let feeMinor = 0n;
    if (paymentIntent) {
      const intent = await this.stripe.paymentIntents.retrieve(paymentIntent, {
        expand: ["latest_charge.balance_transaction"]
      });
      const charge =
        typeof intent.latest_charge === "object" && intent.latest_charge
          ? intent.latest_charge
          : null;
      const transaction =
        charge && typeof charge.balance_transaction === "object" && charge.balance_transaction
          ? charge.balance_transaction
          : null;
      feeMinor = BigInt(transaction?.fee ?? 0);
    }
    return {
      status: "SUCCEEDED",
      ...(paymentIntent ? { providerPaymentId: paymentIntent } : {}),
      amountMinor: BigInt(session.amount_total ?? 0),
      feeMinor,
      currency: (session.currency ?? link.currency).toUpperCase()
    };
  }

  public async deactivatePaymentLink(providerLinkId: string): Promise<void> {
    await this.stripe.paymentLinks.update(providerLinkId, { active: false });
  }
}

export function createOwnAccountPaymentProvider(
  provider: OwnAccountPaymentProviderKind,
  credential: string,
  options: OwnAccountPaymentProviderOptions
): OwnAccountPaymentProvider {
  if (provider === "STRIPE")
    return new StripeOwnAccountPaymentProvider({
      secretKey: credential,
      mode: options.mode,
      apiBase: options.apiBase
    });
  if (!options.locationId)
    throw new AppError("PAYMENT_ACCOUNT_INVALID", "Square requires a location ID.", 422);
  return new SquareOwnAccountPaymentProvider({
    accessToken: credential,
    locationId: options.locationId,
    mode: options.mode,
    baseUrl: options.apiBase
  });
}

function assertPositiveAmount(amountMinor: bigint): void {
  if (amountMinor <= 0n)
    throw new AppError("PAYMENT_AMOUNT_INVALID", "Payment amount must be positive.", 422);
}

function toStripeInteger(amountMinor: bigint): number {
  const value = Number(amountMinor);
  if (!Number.isSafeInteger(value))
    throw new AppError("PAYMENT_AMOUNT_INVALID", "Payment amount is too large.", 422);
  return value;
}

function providerMinorToBigInt(value: bigint | number | string | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "number" && !Number.isSafeInteger(value))
    throw new AppError(
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      "The provider returned an invalid amount.",
      502
    );
  const text = value.toString();
  if (!/^-?\d+$/.test(text))
    throw new AppError(
      "PAYMENT_PROVIDER_INVALID_RESPONSE",
      "The provider returned an invalid amount.",
      502
    );
  return BigInt(text);
}

function squarePaymentStatus(value: string | undefined): OwnAccountPaymentStatus["status"] {
  switch (value) {
    case "COMPLETED":
      return "SUCCEEDED";
    case "APPROVED":
      return "PROCESSING";
    case "CANCELED":
      return "CANCELLED";
    case "FAILED":
      return "FAILED";
    default:
      return "PENDING";
  }
}
