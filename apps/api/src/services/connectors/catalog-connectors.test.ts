import { describe, expect, it } from "vitest";
import type {
  ConnectorHttpClient,
  ConnectorHttpRequest,
  ConnectorHttpResponse
} from "./connector-http-client.js";
import { isCommerceConnectorAdapter } from "./commerce-connector-types.js";
import { EtsyConnector } from "./etsy-connector.js";
import { WooCommerceConnector } from "./woocommerce-connector.js";

const publicHost = (): Promise<readonly string[]> => Promise.resolve(["93.184.216.34"]);
const wooCredentials = {
  storeUrl: "https://shop.example.com",
  consumerKey: `ck_${"a".repeat(32)}`,
  consumerSecret: `cs_${"b".repeat(32)}`,
  webhookSecret: "woo-catalog-test-secret-32-bytes"
};
const etsyCredentials = {
  apiKey: "etsy-catalog-app-key",
  sharedSecret: "etsy-catalog-shared-secret",
  shopId: "24681012",
  accessToken: "24681012.catalog-access-token",
  refreshToken: "24681012.catalog-refresh-token",
  expiresAt: "2099-01-01T00:00:00.000Z"
};

describe("provider catalog and inventory fixtures", () => {
  it("requires every commerce adapter to expose the shared catalog boundary", () => {
    const orderOnlyAdapter = {
      providerKey: "FUTURE",
      validateCredentials: () => Promise.resolve(undefined),
      checkHealth: () => Promise.resolve("HEALTHY" as const),
      syncPage: () => Promise.reject(new Error("not used")),
      verifyWebhook: () => ({ events: [] })
    };
    expect(isCommerceConnectorAdapter(orderOnlyAdapter)).toBe(false);
    expect(isCommerceConnectorAdapter(new WooCommerceConnector(undefined, publicHost))).toBe(true);
    expect(isCommerceConnectorAdapter(new EtsyConnector(undefined, publicHost))).toBe(true);
  });

  it("pages a Woo variable product without dropping later variations", async () => {
    const http = new RecordingHttpClient((request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/products"))
        return response([wooProduct()], { "x-wp-total": "1", "x-wp-totalpages": "1" });
      if (url.pathname.endsWith("/products/91/variations")) {
        expect(url.searchParams.get("page")).toBe("1");
        return response([wooVariation(9101, "BLUE", 7)], { "x-wp-totalpages": "2" });
      }
      throw new Error(`Unexpected Woo request: ${request.url}`);
    });
    const page = await new WooCommerceConnector(http, publicHost).catalogPage(wooCredentials, {
      cursor: null,
      pageSize: 10
    });

    expect(page).toMatchObject({
      hasMore: true,
      nextCursor: { productPage: 1, productIndex: 0, variationPage: 2 },
      products: [
        {
          externalProductId: "91",
          variants: [
            {
              externalVariantId: "9101",
              sku: "SKU-BLUE",
              observedQuantityMicros: "7000000",
              variantSignature: { Colour: "BLUE" }
            }
          ]
        }
      ]
    });
  });

  it("writes an exact whole-unit Woo variation with the durable idempotency key", async () => {
    const http = new RecordingHttpClient((request) => {
      expect(request.method).toBe("PUT");
      expect(request.url).toContain("/products/91/variations/9101");
      expect(request.headers?.["x-clearledger-idempotency-key"]).toBe("operation-hash");
      expect(JSON.parse(request.body ?? "{}")).toEqual({
        manage_stock: true,
        stock_quantity: 11
      });
      return response({ stock_quantity: 11, manage_stock: true }, { "x-request-id": "woo-req-1" });
    });
    const result = await new WooCommerceConnector(http, publicHost).updateInventory(
      wooCredentials,
      {
        externalProductId: "91",
        externalVariantId: "9101",
        quantityMicros: "11000000",
        idempotencyKey: "operation-hash"
      }
    );
    expect(result).toMatchObject({
      externalOperationId: "woo-req-1",
      observedQuantityMicros: "11000000"
    });
  });

  it("polls Etsy listing inventory and image metadata because catalog webhooks are unavailable", async () => {
    const http = new RecordingHttpClient((request) => {
      if (request.url.includes("/listings/active?"))
        return response({ count: 1, results: [etsyListing()] });
      if (request.url.endsWith("/listings/3344/inventory")) return response(etsyInventory());
      if (request.url.endsWith("/listings/3344/images"))
        return response({ count: 1, results: [etsyImage()] });
      throw new Error(`Unexpected Etsy request: ${request.url}`);
    });
    const page = await new EtsyConnector(http, publicHost).catalogPage(etsyCredentials, {
      cursor: null,
      pageSize: 10
    });
    expect(page).toMatchObject({
      products: [
        {
          externalProductId: "3344",
          images: [{ externalImageId: "88", width: 1200, height: 900 }],
          variants: [
            {
              externalVariantId: "9901",
              externalReferenceAliases: ["7701"],
              sku: "ETSY-BLUE",
              observedQuantityMicros: "4000000",
              variantSignature: { Colour: "Blue" }
            }
          ]
        }
      ],
      hasMore: true,
      nextCursor: { stateIndex: 1, offset: 0 }
    });
  });

  it("preserves Etsy inventory structure while changing only the selected offering quantity", async () => {
    const http = new RecordingHttpClient((request, index) => {
      if (index === 0) return response(etsyInventory());
      expect(request.method).toBe("PUT");
      expect(request.headers?.["x-clearledger-idempotency-key"]).toBe("etsy-operation-hash");
      const body = JSON.parse(request.body ?? "{}") as Record<string, unknown>;
      expect(body).toMatchObject({
        products: [
          {
            sku: "ETSY-BLUE",
            offerings: [
              {
                quantity: 9,
                is_enabled: true,
                price: { amount: 2500, divisor: 100, currency_code: "CAD" }
              }
            ]
          }
        ]
      });
      return response({}, { "x-request-id": "etsy-req-1" });
    });
    const result = await new EtsyConnector(http, publicHost).updateInventory(etsyCredentials, {
      externalProductId: "3344",
      externalVariantId: "9901",
      quantityMicros: "9000000",
      expectedQuantityMicros: "4000000",
      idempotencyKey: "etsy-operation-hash"
    });
    expect(result).toMatchObject({
      externalOperationId: "etsy-req-1",
      observedQuantityMicros: "9000000"
    });
  });

  it("blocks an Etsy full-inventory replacement when the reviewed quantity is stale", async () => {
    const http = new RecordingHttpClient((request) => {
      expect(request.method ?? "GET").toBe("GET");
      return response(etsyInventory());
    });

    await expect(
      new EtsyConnector(http, publicHost).updateInventory(etsyCredentials, {
        externalProductId: "3344",
        externalVariantId: "9901",
        quantityMicros: "9000000",
        expectedQuantityMicros: "3000000",
        idempotencyKey: "etsy-stale-operation-hash"
      })
    ).rejects.toMatchObject({ code: "CONNECTOR_INVENTORY_CHANGED", statusCode: 409 });
    expect(http.requests).toHaveLength(1);
  });

  it("rejects fractional provider stock rather than rounding it", async () => {
    const connector = new WooCommerceConnector(
      new RecordingHttpClient(() => {
        throw new Error("Fractional stock must be rejected before provider I/O.");
      }),
      publicHost
    );
    await expect(
      connector.updateInventory(wooCredentials, {
        externalProductId: "91",
        externalVariantId: "91",
        quantityMicros: "1500000",
        idempotencyKey: "operation-hash"
      })
    ).rejects.toMatchObject({ code: "CONNECTOR_QUANTITY_UNSUPPORTED", statusCode: 422 });
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

function response(
  body: unknown,
  headers: Readonly<Record<string, string>> = {}
): ConnectorHttpResponse {
  return { status: 200, headers, body };
}

function wooProduct() {
  return {
    id: 91,
    type: "variable",
    name: "Trail shoe",
    status: "publish",
    permalink: "https://shop.example.com/product/trail-shoe",
    date_modified_gmt: "2026-08-03T12:00:00",
    variations: [9101, 9102],
    images: [{ id: 81, src: "https://shop.example.com/media/shoe.jpg", alt: "Trail shoe" }]
  };
}

function wooVariation(id: number, colour: string, stock: number) {
  return {
    id,
    sku: `SKU-${colour}`,
    name: `Trail shoe - ${colour}`,
    status: "publish",
    stock_quantity: stock,
    manage_stock: true,
    date_modified_gmt: "2026-08-03T12:00:00",
    attributes: [{ name: "Colour", option: colour }]
  };
}

function etsyListing() {
  return {
    listing_id: 3344,
    title: "Etsy trail shoe",
    description: "Fixture listing",
    url: "https://www.etsy.com/listing/3344/fixture",
    updated_timestamp: 1_786_000_000
  };
}

function etsyInventory() {
  return {
    products: [
      {
        product_id: 7701,
        sku: "ETSY-BLUE",
        property_values: [
          {
            property_id: 200,
            property_name: "Colour",
            scale_id: null,
            value_ids: [1001],
            values: ["Blue"]
          }
        ],
        offerings: [
          {
            offering_id: 9901,
            quantity: 4,
            is_enabled: true,
            price: { amount: 2500, divisor: 100, currency_code: "CAD" }
          }
        ]
      }
    ]
  };
}

function etsyImage() {
  return {
    listing_image_id: 88,
    url_fullxfull: "https://i.etsystatic.com/123/fixture.jpg",
    full_width: 1200,
    full_height: 900,
    rank: 1
  };
}
