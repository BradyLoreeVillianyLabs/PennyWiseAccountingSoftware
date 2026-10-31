import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  ConnectorHttpClient,
  ConnectorHttpRequest,
  ConnectorHttpResponse
} from "./connector-http-client.js";
import { WooCommerceConnector } from "./woocommerce-connector.js";

const credentials = {
  storeUrl: "https://shop.example.com",
  consumerKey: `ck_${"a".repeat(32)}`,
  consumerSecret: `cs_${"b".repeat(32)}`,
  webhookSecret: "woo-unit-test-webhook-secret-32-bytes"
};
const webhookMapping = {
  customerStrategy: "POOLED",
  productMappings: { "91": "sales-item-cad" },
  taxMappings: { GST: "gst-tax-code" },
  taxRemittanceResponsibility: "SELLER"
} as const;

const publicHost = (): Promise<readonly string[]> => Promise.resolve(["93.184.216.34"]);

describe("WooCommerceConnector", () => {
  it("verifies the raw-body HMAC and normalizes a signed order webhook", async () => {
    const http = new RecordingHttpClient(() => {
      throw new Error("Webhook verification must not make a provider request.");
    });
    const connector = new WooCommerceConnector(http, publicHost);
    const rawBody = Buffer.from(JSON.stringify(wooOrder()), "utf8");
    const result = await connector.verifyWebhook(credentials, {
      rawBody,
      headers: wooHeaders(rawBody),
      now: new Date("2026-08-01T12:00:00.000Z"),
      mapping: webhookMapping,
      mappingVersion: 7
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      externalEventId: "poll:order:7301:2026-07-31T12:00:00.000Z",
      eventType: "order.updated",
      resourceId: "7301",
      sourceCurrency: "CAD",
      normalizationIssues: [],
      normalizedPayload: {
        provider: "WOOCOMMERCE",
        status: "processing",
        mapping: {
          customerStrategy: "POOLED",
          itemStatus: "MAPPED",
          taxStatus: "MAPPED",
          taxRemittanceResponsibility: "SELLER"
        },
        issues: [],
        money: {
          total: { units: "12925", divisor: "100", decimal: "129.25" }
        }
      },
      rawPayload: { billing: "[REDACTED]" }
    });
    expect(result.events[0]?.rawPayload).toMatchObject({
      customer_ip_address: "[REDACTED]",
      customer_note: "[REDACTED]",
      meta_data: "[REDACTED]"
    });
    expect(JSON.stringify(result.events[0]?.rawPayload)).not.toMatch(
      /Private Buyer Company|buyer@example|alternate@example|192\.0\.2\.10|private side door/
    );
    expect(http.requests).toEqual([]);
  });

  it("rejects a tampered payload when the original signature is reused", async () => {
    const connector = new WooCommerceConnector(
      new RecordingHttpClient(() => {
        throw new Error("Unexpected provider request.");
      }),
      publicHost
    );
    const original = Buffer.from(JSON.stringify(wooOrder()), "utf8");
    const tampered = Buffer.from(
      original.toString("utf8").replace('"total":"129.25"', '"total":"129.26"'),
      "utf8"
    );

    await expect(
      connector.verifyWebhook(credentials, {
        rawBody: tampered,
        headers: wooHeaders(original),
        now: new Date("2026-08-01T12:00:00.000Z"),
        mapping: webhookMapping,
        mappingVersion: 7
      })
    ).rejects.toMatchObject({ code: "COMMERCE_WEBHOOK_INVALID", statusCode: 400 });
  });

  it("acknowledges WooCommerce's unsigned creation ping as a no-op", async () => {
    const http = new RecordingHttpClient(() => {
      throw new Error("A creation ping must not make a provider request.");
    });
    const connector = new WooCommerceConnector(http, publicHost);

    await expect(
      connector.verifyWebhook(
        {},
        {
          rawBody: Buffer.from("webhook_id=42", "utf8"),
          headers: {},
          now: new Date("2026-08-01T12:00:00.000Z"),
          mapping: {},
          mappingVersion: 1
        }
      )
    ).resolves.toEqual({ ping: true, events: [] });
    expect(http.requests).toEqual([]);
  });

  it("fetches detailed refunds and keeps a CAD order reconciliation exact", async () => {
    const http = new RecordingHttpClient((request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/orders"))
        return response([wooOrder()], {
          "x-wp-total": "1",
          "x-wp-totalpages": "1"
        });
      if (url.pathname.endsWith("/orders/7301/refunds"))
        return response([
          {
            id: 9001,
            amount: "12.34",
            reason: "Returned item",
            date_created_gmt: "2026-07-31T14:00:00"
          }
        ]);
      throw new Error(`Unexpected WooCommerce request: ${request.url}`);
    });
    const connector = new WooCommerceConnector(http, publicHost);

    const page = await connector.syncPage(credentials, {
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-08-01T00:00:00.000Z"),
      cursor: null,
      pageSize: 50,
      scope: "ORDERS",
      mapping: {
        customerStrategy: "POOLED",
        productMappings: { "91": "sales-item-cad" },
        taxMappings: { GST: "gst-tax-code" },
        taxRemittanceResponsibility: "SELLER"
      }
    });

    expect(page).toMatchObject({ hasMore: false, nextCursor: null });
    expect(page.events[0]?.normalizedPayload).toMatchObject({
      currencies: { source: "CAD", payment: "CAD", settlement: null },
      money: {
        total: { units: "12925", decimal: "129.25" },
        refunded: { units: "1234", decimal: "12.34" }
      },
      refunds: [
        {
          externalId: "9001",
          amount: { currency: "CAD", units: "1234", decimal: "12.34" },
          reason: "Returned item"
        }
      ],
      reconciliation: {
        componentTotal: { units: "12925", decimal: "129.25" },
        difference: { units: "0", decimal: "0.00" },
        balanced: true
      }
    });
    expect(http.requests).toHaveLength(2);
    expect(http.requests[1]?.url).toContain("/wp-json/wc/v3/orders/7301/refunds");
  });

  it("uses one canonical revision identity for a polled and signed webhook order", async () => {
    const http = new RecordingHttpClient((request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/orders"))
        return response([wooOrder()], { "x-wp-total": "1", "x-wp-totalpages": "1" });
      if (url.pathname.endsWith("/orders/7301/refunds")) return response([]);
      throw new Error(`Unexpected WooCommerce request: ${request.url}`);
    });
    const connector = new WooCommerceConnector(http, publicHost);
    const polled = await connector.syncPage(credentials, {
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-08-01T00:00:00.000Z"),
      cursor: null,
      pageSize: 50,
      scope: "ORDERS",
      mapping: webhookMapping
    });
    const rawBody = Buffer.from(JSON.stringify(wooOrder()), "utf8");
    const webhook = await connector.verifyWebhook(credentials, {
      rawBody,
      headers: wooHeaders(rawBody),
      now: new Date("2026-08-01T12:00:00.000Z"),
      mapping: webhookMapping,
      mappingVersion: 7
    });

    expect(polled.events[0]?.externalEventId).toBe(webhook.events[0]?.externalEventId);
    expect(polled.events[0]?.eventVersion).toBe(webhook.events[0]?.eventVersion);
    expect(polled.events[0]?.rawPayload).toEqual(webhook.events[0]?.rawPayload);
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

function wooHeaders(rawBody: Buffer): Readonly<Record<string, string>> {
  return {
    "x-wc-webhook-signature": createHmac("sha256", credentials.webhookSecret)
      .update(rawBody)
      .digest("base64"),
    "x-wc-webhook-topic": "order.updated",
    "x-wc-webhook-source": "https://shop.example.com/",
    "x-wc-webhook-id": "71",
    "x-wc-webhook-delivery-id": "delivery-9001"
  };
}

function response(
  body: unknown,
  headers: Readonly<Record<string, string>> = {}
): ConnectorHttpResponse {
  return { status: 200, headers, body };
}

function wooOrder(): Record<string, unknown> {
  return {
    id: 7301,
    status: "processing",
    currency: "CAD",
    currency_minor_unit: 2,
    total: "129.25",
    discount_total: "10.00",
    shipping_total: "20.00",
    total_tax: "6.25",
    date_created_gmt: "2026-07-30T10:00:00",
    date_modified_gmt: "2026-07-31T12:00:00",
    date_paid_gmt: "2026-07-30T10:01:00",
    payment_method: "stripe",
    transaction_id: "txn-cad-7301",
    prices_include_tax: false,
    billing: {
      first_name: "Test",
      last_name: "Buyer",
      company: "Private Buyer Company",
      email: "buyer@example.invalid",
      phone: "+1-555-0100"
    },
    customer_ip_address: "192.0.2.10",
    customer_note: "Leave at the private side door",
    meta_data: [{ key: "_billing_email", value: "alternate@example.invalid" }],
    line_items: [
      {
        id: 11,
        product_id: 91,
        variation_id: 0,
        sku: "SKU-CAD",
        name: "Sanitized CAD item",
        quantity: 1,
        subtotal: "110.00",
        total: "100.00",
        total_tax: "5.00"
      }
    ],
    tax_lines: [
      {
        id: 5,
        rate_id: 5,
        label: "GST",
        tax_total: "6.25",
        shipping_tax_total: "1.00"
      }
    ],
    shipping_lines: [
      {
        id: 12,
        method_title: "Sanitized shipping",
        total: "20.00",
        total_tax: "1.00"
      }
    ],
    fee_lines: [
      {
        id: 13,
        name: "Service fee",
        total: "3.00",
        total_tax: "0.25"
      }
    ],
    coupon_lines: [
      {
        id: 14,
        code: "TEST10",
        discount: "10.00",
        discount_tax: "0.00"
      }
    ],
    refunds: [{ id: 9001, total: "-12.34" }]
  };
}
