import { describe, expect, it } from "vitest";
import { rankCatalogCandidates } from "./services/catalog-mapping-service.js";
import { normalizeWooOrder } from "./services/connectors/commerce-normalization.js";
import type { CommerceConnectorEvent } from "./services/connectors/commerce-connector-types.js";
import type {
  ConnectorHttpClient,
  ConnectorHttpRequest,
  ConnectorHttpResponse
} from "./services/connectors/connector-http-client.js";
import { WooCommerceConnector } from "./services/connectors/woocommerce-connector.js";

const credentials = {
  storeUrl: "https://shop.example.test",
  consumerKey: `ck_${"a".repeat(32)}`,
  consumerSecret: `cs_${"b".repeat(32)}`,
  webhookSecret: "woo-matching-regression-webhook-secret"
};
const publicHost = (): Promise<readonly string[]> => Promise.resolve(["93.184.216.34"]);

describe("WooCommerce catalog and order matching regressions", () => {
  it("uses the parent identity for a simple product and the variation identity for a variable product", async () => {
    const simplePage = await catalogConnector(simpleProduct()).catalogPage(credentials, {
      cursor: null,
      pageSize: 10
    });
    const variablePage = await catalogConnector(variableProduct(), [
      variableProductVariation()
    ]).catalogPage(credentials, { cursor: null, pageSize: 10 });

    const simple = simplePage.products[0]!;
    const variable = variablePage.products[0]!;
    const simpleVariant = simple.variants[0]!;
    const variableVariant = variable.variants[0]!;

    expect(simple).toMatchObject({ externalProductId: "101" });
    expect(simpleVariant).toMatchObject({
      externalVariantId: "101",
      sku: "SIMPLE-101",
      safeMetadata: { productId: "101" }
    });
    expect(variable).toMatchObject({ externalProductId: "200" });
    expect(variableVariant).toMatchObject({
      externalVariantId: "201",
      sku: "VARIABLE-BLUE",
      variantSignature: { Colour: "Blue" },
      safeMetadata: { productId: "200" }
    });

    const event = normalizeWooOrder(
      wooOrder({
        id: 7001,
        modifiedAt: "2026-08-10T10:05:00.000Z",
        total: "20.00",
        lines: [
          wooLine({ id: 1, productId: 101, variationId: 0, name: "Simple product" }),
          wooLine({ id: 2, productId: 200, variationId: 201, name: "Blue variation" })
        ]
      }),
      credentials.storeUrl,
      {
        catalogProductMappings: { [simple.externalProductId]: "local-simple" },
        catalogVariantMappings: { [variableVariant.externalVariantId]: "local-blue" }
      }
    );

    expect(event.normalizedPayload.lines).toMatchObject([
      {
        productExternalId: "101",
        variationExternalId: null,
        mappingStatus: "MAPPED"
      },
      {
        productExternalId: "200",
        variationExternalId: "201",
        mappingStatus: "MAPPED"
      }
    ]);
    expect(event.normalizedPayload.mapping.itemStatus).toBe("MAPPED");
    expect(event.normalizationIssues).not.toContainEqual(
      expect.objectContaining({ code: "SKU_MISSING" })
    );
  });

  it("does not let a duplicate SKU override independently approved variation identities", () => {
    const duplicateSkuLines = [
      wooLine({
        id: 1,
        productId: 200,
        variationId: 201,
        sku: "DUPLICATE-SKU",
        name: "Blue variation"
      }),
      wooLine({
        id: 2,
        productId: 200,
        variationId: 202,
        sku: "DUPLICATE-SKU",
        name: "Red variation"
      })
    ];
    const approvedByVariant = normalizeWooOrder(
      wooOrder({
        id: 7002,
        modifiedAt: "2026-08-10T10:06:00.000Z",
        total: "20.00",
        lines: duplicateSkuLines
      }),
      credentials.storeUrl,
      { catalogVariantMappings: { "201": "local-blue", "202": "local-red" } }
    );
    const conflictingSkuFallback = normalizeWooOrder(
      wooOrder({
        id: 7003,
        modifiedAt: "2026-08-10T10:07:00.000Z",
        total: "20.00",
        lines: duplicateSkuLines
      }),
      credentials.storeUrl,
      {
        catalogVariantMappings: { "201": "local-blue", "202": "local-red" },
        catalogSkuMappings: { "DUPLICATE-SKU": "local-blue" }
      }
    );
    const skuOnly = normalizeWooOrder(
      wooOrder({
        id: 7009,
        modifiedAt: "2026-08-10T10:07:30.000Z",
        total: "10.00",
        lines: [duplicateSkuLines[0]!]
      }),
      credentials.storeUrl,
      { catalogSkuMappings: { "DUPLICATE-SKU": "local-blue" } }
    );
    const parentOnly = normalizeWooOrder(
      wooOrder({
        id: 7010,
        modifiedAt: "2026-08-10T10:07:45.000Z",
        total: "10.00",
        lines: [duplicateSkuLines[0]!]
      }),
      credentials.storeUrl,
      { catalogProductMappings: { "200": "local-blue" } }
    );

    expect(approvedByVariant.normalizedPayload.lines.map((line) => line.mappingStatus)).toEqual([
      "MAPPED",
      "MAPPED"
    ]);
    expect(
      conflictingSkuFallback.normalizedPayload.lines.map((line) => line.mappingStatus)
    ).toEqual(["MAPPED", "REVIEW_REQUIRED"]);
    expect(conflictingSkuFallback.normalizationIssues).toContainEqual(
      expect.objectContaining({
        code: "ITEM_MAPPING_CONFLICT",
        severity: "BLOCKING",
        path: "line_items.1.sku"
      })
    );
    expect(skuOnly.normalizedPayload.lines[0]?.mappingStatus).toBe("REVIEW_REQUIRED");
    expect(skuOnly.normalizationIssues).toContainEqual(
      expect.objectContaining({
        code: "ITEM_PROVIDER_ID_MAPPING_REQUIRED",
        severity: "BLOCKING",
        path: "line_items.0.product_id"
      })
    );
    expect(parentOnly.normalizedPayload.lines[0]?.mappingStatus).toBe("REVIEW_REQUIRED");
    expect(parentOnly.normalizationIssues).toContainEqual(
      expect.objectContaining({
        code: "ITEM_VARIANT_MAPPING_REQUIRED",
        severity: "BLOCKING",
        path: "line_items.0.variation_id"
      })
    );
  });

  it("permits a missing SKU only when a previously approved provider identity exists", () => {
    const mapped = normalizeWooOrder(
      wooOrder({
        id: 7004,
        modifiedAt: "2026-08-10T10:08:00.000Z",
        total: "10.00",
        lines: [wooLine({ id: 1, productId: 200, variationId: 201, name: "Blue variation" })]
      }),
      credentials.storeUrl,
      { catalogVariantMappings: { "201": "local-blue" } }
    );
    const unmapped = normalizeWooOrder(
      wooOrder({
        id: 7005,
        modifiedAt: "2026-08-10T10:09:00.000Z",
        total: "10.00",
        lines: [wooLine({ id: 1, productId: 200, variationId: 202, name: "Red variation" })]
      }),
      credentials.storeUrl,
      {}
    );

    expect(mapped.normalizedPayload.lines[0]?.mappingStatus).toBe("MAPPED");
    expect(mapped.normalizationIssues).not.toContainEqual(
      expect.objectContaining({ code: "SKU_MISSING" })
    );
    expect(unmapped.normalizedPayload.lines[0]?.mappingStatus).toBe("REVIEW_REQUIRED");
    expect(unmapped.normalizationIssues).toContainEqual(
      expect.objectContaining({
        code: "SKU_MISSING",
        severity: "BLOCKING",
        path: "line_items.0.sku"
      })
    );
  });

  it("requires an approved exact mapping; fuzzy catalog suggestions do not process an order line", () => {
    const fuzzy = rankCatalogCandidates(
      {
        normalizedName: "waterproof trail boot",
        normalizedDescription: "leather hiking boot",
        normalizedSku: "BOOT100",
        normalizedGtin: null,
        normalizedManufacturer: null,
        normalizedManufacturerPartNumber: null
      },
      [
        {
          id: "local-near-match",
          name: "Waterproof trail boots",
          description: "Leather hiking boots",
          normalizedSku: "BOOT101",
          normalizedGtin: null,
          normalizedManufacturer: null,
          normalizedManufacturerPartNumber: null
        }
      ]
    );
    const withoutApprovedMapping = normalizeWooOrder(
      wooOrder({
        id: 7006,
        modifiedAt: "2026-08-10T10:10:00.000Z",
        total: "10.00",
        lines: [
          wooLine({
            id: 1,
            productId: 200,
            variationId: 203,
            sku: "BOOT100",
            name: "Waterproof trail boot"
          })
        ]
      }),
      credentials.storeUrl,
      {}
    );
    const withApprovedMapping = normalizeWooOrder(
      wooOrder({
        id: 7007,
        modifiedAt: "2026-08-10T10:11:00.000Z",
        total: "10.00",
        lines: [
          wooLine({
            id: 1,
            productId: 200,
            variationId: 203,
            sku: "BOOT100",
            name: "Waterproof trail boot"
          })
        ]
      }),
      credentials.storeUrl,
      { catalogVariantMappings: { "203": "local-near-match" } }
    );

    expect(fuzzy[0]).toMatchObject({
      productItemId: "local-near-match",
      reason: { matchMethod: "FUZZY", autoConfirmEligible: false, decisionState: "SUGGESTED" }
    });
    expect(withoutApprovedMapping.normalizedPayload.lines[0]?.mappingStatus).toBe(
      "REVIEW_REQUIRED"
    );
    expect(withoutApprovedMapping.normalizationIssues).toContainEqual(
      expect.objectContaining({ code: "ITEM_MAPPING_REQUIRED", severity: "BLOCKING" })
    );
    expect(withApprovedMapping.normalizedPayload.lines[0]?.mappingStatus).toBe("MAPPED");
  });

  it("makes duplicate payloads replay-identical and retains distinct out-of-order revisions as evidence", () => {
    const earlier = normalizedOrderRevision("2026-08-10T10:12:00.000Z");
    const later = normalizedOrderRevision("2026-08-10T10:13:00.000Z");
    const replay = normalizedOrderRevision("2026-08-10T10:13:00.000Z");

    expect(replay.externalEventId).toBe(later.externalEventId);
    expect(replay.eventVersion).toBe(later.eventVersion);
    expect(replay.normalizedPayload).toEqual(later.normalizedPayload);
    expect(earlier.externalEventId).not.toBe(later.externalEventId);
    expect(earlier.eventVersion).toBe("2026-08-10T10:12:00.000Z");
    expect(later.eventVersion).toBe("2026-08-10T10:13:00.000Z");
    expect(earlier.normalizedPayload.sourceModifiedAt).toBe(earlier.eventVersion);
    expect(later.normalizedPayload.sourceModifiedAt).toBe(later.eventVersion);
  });
});

function normalizedOrderRevision(modifiedAt: string): CommerceConnectorEvent {
  return normalizeWooOrder(
    wooOrder({
      id: 7008,
      modifiedAt,
      total: "10.00",
      lines: [
        wooLine({
          id: 1,
          productId: 200,
          variationId: 201,
          sku: "VARIABLE-BLUE",
          name: "Blue variation"
        })
      ]
    }),
    credentials.storeUrl,
    { catalogVariantMappings: { "201": "local-blue" } }
  );
}

function catalogConnector(
  product: Record<string, unknown>,
  variations: readonly Record<string, unknown>[] = []
): WooCommerceConnector {
  return new WooCommerceConnector(
    new FixtureHttpClient((request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/products"))
        return response([product], { "x-wp-total": "1", "x-wp-totalpages": "1" });
      if (url.pathname.endsWith(`/products/${String(product.id)}/variations`))
        return response(variations, {
          "x-wp-total": String(variations.length),
          "x-wp-totalpages": "1"
        });
      throw new Error(`Unexpected WooCommerce catalog request: ${request.url}`);
    }),
    publicHost
  );
}

function simpleProduct(): Record<string, unknown> {
  return {
    id: 101,
    type: "simple",
    name: "Simple product",
    sku: "SIMPLE-101",
    status: "publish",
    stock_quantity: 3,
    manage_stock: true,
    date_modified_gmt: "2026-08-10T09:00:00.000Z"
  };
}

function variableProduct(): Record<string, unknown> {
  return {
    id: 200,
    type: "variable",
    name: "Variable product",
    status: "publish",
    variations: [201],
    date_modified_gmt: "2026-08-10T09:00:00.000Z"
  };
}

function variableProductVariation(): Record<string, unknown> {
  return {
    id: 201,
    sku: "VARIABLE-BLUE",
    name: "Variable product - Blue",
    status: "publish",
    stock_quantity: 4,
    manage_stock: true,
    date_modified_gmt: "2026-08-10T09:00:00.000Z",
    attributes: [{ name: "Colour", option: "Blue" }]
  };
}

function wooOrder(input: {
  readonly id: number;
  readonly modifiedAt: string;
  readonly total: string;
  readonly lines: readonly Record<string, unknown>[];
}): Record<string, unknown> {
  return {
    id: input.id,
    status: "processing",
    currency: "CAD",
    currency_minor_unit: 2,
    total: input.total,
    discount_total: "0.00",
    shipping_total: "0.00",
    total_tax: "0.00",
    date_created_gmt: "2026-08-10T10:00:00.000Z",
    date_modified_gmt: input.modifiedAt,
    line_items: input.lines,
    tax_lines: [],
    shipping_lines: [],
    fee_lines: [],
    coupon_lines: [],
    refunds: []
  };
}

function wooLine(input: {
  readonly id: number;
  readonly productId: number;
  readonly variationId: number;
  readonly name: string;
  readonly sku?: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    product_id: input.productId,
    variation_id: input.variationId,
    ...(input.sku ? { sku: input.sku } : {}),
    name: input.name,
    quantity: 1,
    subtotal: "10.00",
    total: "10.00",
    total_tax: "0.00"
  };
}

class FixtureHttpClient implements ConnectorHttpClient {
  public constructor(
    private readonly responder: (request: ConnectorHttpRequest) => ConnectorHttpResponse
  ) {}

  public request(request: ConnectorHttpRequest): Promise<ConnectorHttpResponse> {
    return Promise.resolve(this.responder(request));
  }
}

function response(
  body: unknown,
  headers: Readonly<Record<string, string>> = {}
): ConnectorHttpResponse {
  return { status: 200, headers, body };
}
