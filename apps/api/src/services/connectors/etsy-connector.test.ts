import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ConnectorHttpClient,
  ConnectorHttpRequest,
  ConnectorHttpResponse
} from "./connector-http-client.js";
import { EtsyConnector } from "./etsy-connector.js";

const signingKey = Buffer.from("sanitized-etsy-signing-key-32byte", "utf8");
const webhookSecret = `whsec_${signingKey.toString("base64")}`;
const credentials = {
  apiKey: "etsy-sanitized-app-key",
  sharedSecret: "etsy-sanitized-shared-secret",
  shopId: "24681012",
  accessToken: "24681012.sanitized-access-token",
  refreshToken: "24681012.sanitized-refresh-token",
  expiresAt: "2099-01-01T00:00:00.000Z",
  webhookSecret
};
const webhookMapping = {
  customerStrategy: "INDIVIDUAL",
  skuMappings: { "SKU-USD": "etsy-sales-item-usd" },
  taxMappings: { "Sales tax": "etsy-marketplace-tax" },
  taxRemittanceResponsibility: "MARKETPLACE"
} as const;

const publicHost = (): Promise<readonly string[]> => Promise.resolve(["93.184.216.34"]);

describe("EtsyConnector", () => {
  it("builds an OAuth authorization request with a verifiable PKCE S256 challenge", async () => {
    const http = new RecordingHttpClient(() => {
      throw new Error("Starting OAuth must not call Etsy.");
    });
    const connector = new EtsyConnector(http, publicHost);

    const started = await connector.beginOAuth({
      apiKey: credentials.apiKey,
      sharedSecret: credentials.sharedSecret,
      redirectUri: "https://ledger.example.com/integrations/etsy/callback"
    });
    const authorizationUrl = new URL(started.authorizationUrl);
    const oauthPending = requiredRecord(started.pendingCredentials.oauthPending);
    const verifier = requiredString(oauthPending.verifier);
    const state = requiredString(authorizationUrl.searchParams.get("state"));

    expect(authorizationUrl.origin).toBe("https://www.etsy.com");
    expect(authorizationUrl.pathname).toBe("/oauth/connect");
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      "shops_r listings_r listings_w transactions_r"
    );
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier, "ascii").digest("base64url")
    );
    expect(oauthPending.stateHash).toBe(createHash("sha256").update(state, "utf8").digest("hex"));
    expect(http.requests).toEqual([]);
  });

  it("accepts Etsy's documented api.etsy.com resource URL and verifies its signature", async () => {
    const resourceUrl = "https://api.etsy.com/v3/application/shops/24681012/receipts/13579";
    const http = new RecordingHttpClient((request) => {
      if (request.url === resourceUrl) return response(etsyReceipt());
      if (
        request.url ===
        "https://openapi.etsy.com/v3/application/shops/24681012/receipts/13579/payments"
      )
        return response({ count: 1, results: [etsyPayment()] });
      throw new Error(`Unexpected Etsy request: ${request.url}`);
    });
    const connector = new EtsyConnector(http, publicHost);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const webhook = signedWebhook(resourceUrl, now);

    const result = await connector.verifyWebhook(credentials, {
      rawBody: webhook.rawBody,
      headers: webhook.headers,
      now,
      mapping: webhookMapping,
      mappingVersion: 9
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      externalEventId: "poll:receipt:13579:2025-07-31T11:00:00.000Z",
      eventType: "order.paid",
      shopExternalId: "24681012",
      resourceId: "13579",
      sourceCurrency: "USD",
      normalizationIssues: [],
      normalizedPayload: {
        mapping: {
          customerStrategy: "INDIVIDUAL",
          itemStatus: "MAPPED",
          taxStatus: "MAPPED",
          taxRemittanceResponsibility: "MARKETPLACE"
        },
        issues: [],
        money: {
          total: { currency: "USD", units: "12625", divisor: "100", decimal: "126.25" }
        },
        payments: [
          {
            externalId: "97531",
            amount: { currency: "USD", units: "12625", decimal: "126.25" }
          }
        ],
        reconciliation: {
          componentTotal: { units: "12625", decimal: "126.25" },
          difference: { units: "0", decimal: "0.00" },
          balanced: true
        }
      },
      rawPayload: {
        receipt: {
          buyer_email: "[REDACTED]",
          buyer_user_id: "[REDACTED]",
          name: "[REDACTED]",
          first_line: "[REDACTED]"
        }
      }
    });
    expect(JSON.stringify(result.events[0]?.rawPayload)).not.toMatch(
      /buyer@example|Private Etsy Buyer|24689999/
    );
    expect(http.requests.map((request) => request.url)).toEqual([
      resourceUrl,
      "https://openapi.etsy.com/v3/application/shops/24681012/receipts/13579/payments"
    ]);
  });

  it("uses the same receipt/version identity for polling and webhook observations", async () => {
    const resourceUrl = "https://api.etsy.com/v3/application/shops/24681012/receipts/13579";
    const http = new RecordingHttpClient((request) => {
      if (request.url === resourceUrl) return response(etsyReceipt());
      if (
        request.url ===
        "https://openapi.etsy.com/v3/application/shops/24681012/receipts/13579/payments"
      )
        return response({ count: 1, results: [etsyPayment()] });
      if (
        request.url.startsWith("https://openapi.etsy.com/v3/application/shops/24681012/receipts?")
      )
        return response({ count: 1, results: [etsyReceipt()] });
      throw new Error(`Unexpected Etsy request: ${request.url}`);
    });
    const connector = new EtsyConnector(http, publicHost);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const webhook = signedWebhook(resourceUrl, now);

    const polled = await connector.syncPage(credentials, {
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-08-01T00:00:00.000Z"),
      cursor: null,
      pageSize: 50,
      scope: "ORDERS",
      mapping: webhookMapping
    });
    const observed = await connector.verifyWebhook(credentials, {
      rawBody: webhook.rawBody,
      headers: webhook.headers,
      now,
      mapping: webhookMapping,
      mappingVersion: 9
    });

    expect(polled.events[0]).toBeDefined();
    expect(observed.events[0]).toBeDefined();
    expect(observed.events[0]).toMatchObject({
      externalEventId: polled.events[0]!.externalEventId,
      eventVersion: polled.events[0]!.eventVersion,
      resourceId: polled.events[0]!.resourceId
    });
    expect(observed.events[0]!.rawPayload).toMatchObject({
      webhook: { event_type: "order.paid" },
      receipt: { receipt_id: 13579 }
    });
  });

  it("rejects a correctly signed webhook outside Etsy's five-minute timestamp window", async () => {
    const http = new RecordingHttpClient(() => {
      throw new Error("A stale webhook must be rejected before provider I/O.");
    });
    const connector = new EtsyConnector(http, publicHost);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const staleTime = new Date(now.getTime() - 301_000);
    const webhook = signedWebhook(
      "https://api.etsy.com/v3/application/shops/24681012/receipts/13579",
      staleTime
    );

    await expect(
      connector.verifyWebhook(credentials, {
        rawBody: webhook.rawBody,
        headers: webhook.headers,
        now,
        mapping: webhookMapping,
        mappingVersion: 9
      })
    ).rejects.toMatchObject({ code: "COMMERCE_WEBHOOK_INVALID", statusCode: 400 });
    expect(http.requests).toEqual([]);
  });

  it("rejects webhook body tampering even inside the timestamp window", async () => {
    const http = new RecordingHttpClient(() => {
      throw new Error("A bad signature must be rejected before provider I/O.");
    });
    const connector = new EtsyConnector(http, publicHost);
    const now = new Date("2026-08-01T12:00:00.000Z");
    const webhook = signedWebhook(
      "https://api.etsy.com/v3/application/shops/24681012/receipts/13579",
      now
    );
    const tamperedBody = Buffer.from(
      webhook.rawBody.toString("utf8").replace("order.paid", "order.canceled"),
      "utf8"
    );

    await expect(
      connector.verifyWebhook(credentials, {
        rawBody: tamperedBody,
        headers: webhook.headers,
        now,
        mapping: webhookMapping,
        mappingVersion: 9
      })
    ).rejects.toMatchObject({ code: "COMMERCE_WEBHOOK_INVALID", statusCode: 400 });
    expect(http.requests).toEqual([]);
  });

  it("refreshes an expired token and returns the rotated credentials", async () => {
    const http = new RecordingHttpClient((request) => {
      if (request.url === "https://api.etsy.com/v3/public/oauth/token") {
        expect(request.method).toBe("POST");
        const body = new URLSearchParams(request.body);
        expect(Object.fromEntries(body)).toEqual({
          grant_type: "refresh_token",
          client_id: credentials.apiKey,
          refresh_token: credentials.refreshToken
        });
        return response({
          access_token: "24681012.rotated-access-token",
          refresh_token: "24681012.rotated-refresh-token",
          expires_in: 3600
        });
      }
      if (
        request.url.startsWith("https://openapi.etsy.com/v3/application/shops/24681012/receipts?")
      ) {
        expect(request.headers).toMatchObject({
          authorization: "Bearer 24681012.rotated-access-token",
          "x-api-key": `${credentials.apiKey}:${credentials.sharedSecret}`
        });
        return response({ count: 0, results: [] });
      }
      throw new Error(`Unexpected Etsy request: ${request.url}`);
    });
    const connector = new EtsyConnector(http, publicHost);
    const before = Date.now();

    const validated = await connector.validateCredentials({
      ...credentials,
      expiresAt: "2020-01-01T00:00:00.000Z"
    });

    expect(validated).toMatchObject({
      externalAccountId: "24681012",
      credentials: {
        accessToken: "24681012.rotated-access-token",
        refreshToken: "24681012.rotated-refresh-token"
      }
    });
    const rotated = requiredRecord(validated.credentials);
    expect(new Date(requiredString(rotated.expiresAt)).getTime()).toBeGreaterThan(
      before + 59 * 60_000
    );
    expect(http.requests).toHaveLength(2);
  });
});

class RecordingHttpClient implements ConnectorHttpClient {
  public readonly requests: ConnectorHttpRequest[] = [];

  public constructor(
    private readonly respond: (
      request: ConnectorHttpRequest,
      index: number
    ) => ConnectorHttpResponse
  ) {}

  public request(request: ConnectorHttpRequest): Promise<ConnectorHttpResponse> {
    this.requests.push(request);
    return Promise.resolve(this.respond(request, this.requests.length - 1));
  }
}

function signedWebhook(
  resourceUrl: string,
  emittedAt: Date
): {
  rawBody: Buffer;
  headers: Readonly<Record<string, string>>;
} {
  const webhookId = "etsy-delivery-101";
  const timestamp = String(Math.floor(emittedAt.getTime() / 1000));
  const rawBody = Buffer.from(
    JSON.stringify({
      event_type: "order.paid",
      shop_id: 24681012,
      resource_url: resourceUrl
    }),
    "utf8"
  );
  const signature = createHmac("sha256", signingKey)
    .update(webhookId)
    .update(".")
    .update(timestamp)
    .update(".")
    .update(rawBody)
    .digest("base64");
  return {
    rawBody,
    headers: {
      "webhook-id": webhookId,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`
    }
  };
}

function etsyReceipt(): Record<string, unknown> {
  return {
    receipt_id: 13579,
    status: "paid",
    is_paid: true,
    is_canceled: false,
    buyer_email: "buyer@example.invalid",
    buyer_user_id: 24689999,
    name: "Private buyer",
    first_line: "Private Etsy Buyer",
    create_timestamp: 1_753_873_200,
    update_timestamp: 1_753_959_600,
    grandtotal: money(12_625, "USD"),
    subtotal: money(10_000, "USD"),
    total_shipping_cost: money(2_000, "USD"),
    total_tax_cost: money(625, "USD"),
    transactions: [
      {
        transaction_id: 1122,
        listing_id: 3344,
        title: "Sanitized USD item",
        quantity: 1,
        sku: ["SKU-USD"],
        price: money(10_000, "USD")
      }
    ]
  };
}

function etsyPayment(): Record<string, unknown> {
  return {
    payment_id: 97531,
    status: "settled",
    payment_method: "etsy_payments",
    create_timestamp: 1_753_959_600,
    amount_gross: money(12_625, "USD"),
    amount_fees: money(825, "USD"),
    amount_net: money(11_800, "USD")
  };
}

function money(amount: number, currency: "CAD" | "USD"): Record<string, unknown> {
  return { amount, divisor: 100, currency_code: currency };
}

function response(
  body: unknown,
  headers: Readonly<Record<string, string>> = {}
): ConnectorHttpResponse {
  return { status: 200, headers, body };
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a test record.");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Expected a test string.");
  return value;
}
