import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "@clearledger/shared";
import { normalizeWooOrder, privacySafeCommercePayload } from "./commerce-normalization.js";
import type {
  CommerceConnectorAdapter,
  ConnectorCatalogPage,
  ConnectorCatalogProduct,
  ConnectorCatalogRequest,
  ConnectorInventoryWriteRequest,
  ConnectorInventoryWriteResult,
  CommerceSyncPage,
  CommerceSyncRequest,
  CommerceWebhookInput,
  CommerceWebhookResult,
  ConnectorHealthResult,
  ConnectorValidationResult,
  WebhookRegistrationInput,
  WebhookRegistrationResult
} from "./commerce-connector-types.js";
import {
  FetchConnectorHttpClient,
  type ConnectorHttpClient,
  type HostResolver,
  systemHostResolver,
  validatePublicHttpsUrl
} from "./connector-http-client.js";

type JsonRecord = Record<string, unknown>;

export class WooCommerceConnector implements CommerceConnectorAdapter {
  public readonly providerKey = "WOOCOMMERCE" as const;

  public constructor(
    private readonly http: ConnectorHttpClient = new FetchConnectorHttpClient(),
    private readonly resolveHost: HostResolver = systemHostResolver
  ) {}

  public async validateCredentials(
    raw: Readonly<Record<string, unknown>>
  ): Promise<ConnectorValidationResult> {
    const credentials = await this.credentials(raw);
    await this.http.request({
      url: apiUrl(credentials.storeUrl, "/orders", { per_page: "1" }),
      headers: authorizationHeaders(credentials),
      retryLimit: 0
    });
    return {
      externalAccountId: credentials.storeUrl,
      displayName: new URL(credentials.storeUrl).hostname,
      credentials: {
        ...raw,
        storeUrl: credentials.storeUrl,
        consumerKey: credentials.consumerKey,
        consumerSecret: credentials.consumerSecret,
        webhookSecret: credentials.webhookSecret
      }
    };
  }

  public async checkHealth(raw: Readonly<Record<string, unknown>>): Promise<ConnectorHealthResult> {
    const credentials = await this.credentials(raw);
    const response = await this.http.request({
      url: apiUrl(credentials.storeUrl, "/orders", { per_page: "1" }),
      headers: authorizationHeaders(credentials),
      retryLimit: 0
    });
    return {
      healthStatus: "HEALTHY",
      externalAccountId: credentials.storeUrl,
      detail: {
        providerApi: "wc/v3",
        orderCount: numericHeader(response.headers["x-wp-total"])
      }
    };
  }

  public async syncPage(
    raw: Readonly<Record<string, unknown>>,
    request: CommerceSyncRequest
  ): Promise<CommerceSyncPage> {
    if (request.scope === "SETTLEMENTS")
      return {
        events: [],
        nextCursor: null,
        hasMore: false,
        rateLimit: {
          note: "WooCommerce core does not expose universal payout or processor-fee data."
        }
      };
    const credentials = await this.credentials(raw);
    const page = cursorInteger(request.cursor, "page", 1);
    const response = await this.http.request({
      url: apiUrl(credentials.storeUrl, "/orders", {
        per_page: String(Math.max(1, Math.min(100, request.pageSize))),
        page: String(page),
        status: "any",
        modified_after: request.from.toISOString(),
        modified_before: request.to.toISOString(),
        dates_are_gmt: "true",
        orderby: "modified",
        order: "asc"
      }),
      headers: authorizationHeaders(credentials)
    });
    const orders = jsonRecords(response.body, "WooCommerce orders");
    const enriched = await mapConcurrent(orders, 4, async (order) => {
      const id = safeIdentifier(order.id);
      const refundReferences = Array.isArray(order.refunds) ? order.refunds : [];
      if (!id || refundReferences.length === 0) return order;
      const refunds = await this.http.request({
        url: apiUrl(credentials.storeUrl, `/orders/${encodeURIComponent(id)}/refunds`, {
          per_page: "100"
        }),
        headers: authorizationHeaders(credentials)
      });
      return { ...order, _clearledger_refunds: jsonRecords(refunds.body, "WooCommerce refunds") };
    });
    const events = enriched.map((order, index) => {
      const event = normalizeWooOrder(order, credentials.storeUrl, request.mapping);
      // Keep the persisted raw evidence to the provider's order representation.
      // Refund detail is used for normalization but should not make a later
      // webhook of the same Woo revision look like a distinct event.
      return { ...event, rawPayload: privacySafeCommercePayload(orders[index]!) };
    });
    const totalPages = Math.max(1, numericHeader(response.headers["x-wp-totalpages"]) ?? page);
    const hasMore = orders.length > 0 && page < totalPages;
    return {
      events,
      nextCursor: hasMore ? { page: page + 1 } : null,
      hasMore,
      rateLimit: {
        totalPages,
        totalItems: numericHeader(response.headers["x-wp-total"])
      }
    };
  }

  /**
   * Catalog continuation is deliberately product-aware. A page returns one
   * complete simple product or one bounded variation page, so stores with very
   * large variable products can resume without silently dropping variants.
   */
  public async catalogPage(
    raw: Readonly<Record<string, unknown>>,
    request: ConnectorCatalogRequest
  ): Promise<ConnectorCatalogPage> {
    const credentials = await this.credentials(raw);
    const productPage = cursorInteger(request.cursor, "productPage", 1);
    const productIndex = cursorNonnegativeInteger(request.cursor, "productIndex", 0);
    const variationPage = cursorInteger(request.cursor, "variationPage", 1);
    const productPageSize = Math.max(1, Math.min(25, request.pageSize));
    const response = await this.http.request({
      url: apiUrl(credentials.storeUrl, "/products", {
        per_page: String(productPageSize),
        page: String(productPage),
        status: "any",
        orderby: "id",
        order: "asc"
      }),
      headers: authorizationHeaders(credentials)
    });
    const products = jsonRecords(response.body, "WooCommerce products");
    const source = products[productIndex];
    const totalPages = Math.max(
      1,
      numericHeader(response.headers["x-wp-totalpages"]) ?? productPage
    );
    if (!source) {
      const hasNextProductPage = products.length > 0 && productPage < totalPages;
      return {
        products: [],
        nextCursor: hasNextProductPage
          ? { productPage: productPage + 1, productIndex: 0, variationPage: 1 }
          : null,
        hasMore: hasNextProductPage,
        rateLimit: { totalPages, totalItems: numericHeader(response.headers["x-wp-total"]) }
      };
    }
    const productId = requiredProviderIdentifier(source.id, "WooCommerce product ID");
    const variationIds = Array.isArray(source.variations) ? source.variations : [];
    let variants: JsonRecord[];
    let variationHasMore = false;
    if (variationIds.length > 0 || source.type === "variable") {
      const variationResponse = await this.http.request({
        url: apiUrl(credentials.storeUrl, `/products/${encodeURIComponent(productId)}/variations`, {
          per_page: "100",
          page: String(variationPage),
          orderby: "id",
          order: "asc"
        }),
        headers: authorizationHeaders(credentials)
      });
      variants = jsonRecords(variationResponse.body, "WooCommerce product variations");
      const variationTotalPages = Math.max(
        1,
        numericHeader(variationResponse.headers["x-wp-totalpages"]) ?? variationPage
      );
      variationHasMore = variants.length > 0 && variationPage < variationTotalPages;
    } else {
      variants = [source];
    }
    const product = wooCatalogProduct(credentials.storeUrl, source, variants);
    const nextCursor = variationHasMore
      ? { productPage, productIndex, variationPage: variationPage + 1 }
      : productIndex + 1 < products.length
        ? { productPage, productIndex: productIndex + 1, variationPage: 1 }
        : productPage < totalPages
          ? { productPage: productPage + 1, productIndex: 0, variationPage: 1 }
          : null;
    return {
      products: [product],
      nextCursor,
      hasMore: nextCursor !== null,
      rateLimit: { totalPages, totalItems: numericHeader(response.headers["x-wp-total"]) }
    };
  }

  public async updateInventory(
    raw: Readonly<Record<string, unknown>>,
    request: ConnectorInventoryWriteRequest
  ): Promise<ConnectorInventoryWriteResult> {
    const credentials = await this.credentials(raw);
    const quantity = wholeUnits(request.quantityMicros);
    const productId = requiredProviderIdentifier(
      request.externalProductId,
      "WooCommerce product ID"
    );
    const variantId = requiredProviderIdentifier(
      request.externalVariantId,
      "WooCommerce variant ID"
    );
    const variation = variantId !== productId;
    const path = variation
      ? `/products/${encodeURIComponent(productId)}/variations/${encodeURIComponent(variantId)}`
      : `/products/${encodeURIComponent(productId)}`;
    const response = await this.http.request({
      method: "PUT",
      url: apiUrl(credentials.storeUrl, path),
      headers: {
        ...authorizationHeaders(credentials),
        "content-type": "application/json",
        "x-clearledger-idempotency-key": request.idempotencyKey
      },
      body: JSON.stringify({ manage_stock: true, stock_quantity: quantity }),
      retryLimit: 0
    });
    const result = requiredRecord(response.body, "WooCommerce inventory update");
    const observed = providerInteger(result.stock_quantity, "WooCommerce stock quantity");
    return {
      externalOperationId: response.headers["x-request-id"] ?? null,
      observedQuantityMicros: (BigInt(observed) * 1_000_000n).toString(),
      safeMetadata: { provider: "WOOCOMMERCE", manageStock: result.manage_stock === true }
    };
  }

  public async verifyWebhook(
    raw: Readonly<Record<string, unknown>>,
    input: CommerceWebhookInput
  ): Promise<CommerceWebhookResult> {
    const bodyText = input.rawBody.toString("utf8");
    if (/^webhook_id=\d+$/.test(bodyText)) return { ping: true, events: [] };
    const credentials = await this.credentials(raw);
    const supplied = input.headers["x-wc-webhook-signature"]?.trim();
    if (!supplied || !validWooSignature(input.rawBody, credentials.webhookSecret, supplied))
      throw invalidWebhook();
    const topic = input.headers["x-wc-webhook-topic"]?.trim().toLowerCase();
    if (!topic || !["order.created", "order.updated", "order.deleted"].includes(topic))
      throw invalidWebhook();
    const source = input.headers["x-wc-webhook-source"]?.trim();
    if (source && canonicalOrigin(source) !== canonicalOrigin(credentials.storeUrl))
      throw invalidWebhook();
    const payload = parseJsonRecord(input.rawBody);
    const event = normalizeWooOrder(payload, credentials.storeUrl, input.mapping);
    return {
      events: [
        {
          ...event,
          // Inbox idempotency is a provider-resource revision, not a delivery
          // attempt. Webhook and polling copies of one Woo revision therefore
          // coalesce; mismatched content for that identity fails closed in the
          // commerce inbox instead of creating two review records.
          externalEventId: event.externalEventId,
          eventType: topic,
          rawPayload: privacySafeCommercePayload(payload)
        }
      ]
    };
  }

  public async registerWebhooks(
    raw: Readonly<Record<string, unknown>>,
    input: WebhookRegistrationInput
  ): Promise<WebhookRegistrationResult> {
    const credentials = await this.credentials(raw);
    const deliveryUrl = (
      await validatePublicHttpsUrl(
        input.deliveryUrl,
        this.resolveHost,
        "CONNECTOR_WEBHOOK_URL_INVALID"
      )
    ).toString();
    const listed = await this.http.request({
      url: apiUrl(credentials.storeUrl, "/webhooks", { per_page: "100", status: "active" }),
      headers: authorizationHeaders(credentials)
    });
    const existing = jsonRecords(listed.body, "WooCommerce webhooks");
    let created = 0;
    let matched = 0;
    for (const topic of ["order.created", "order.updated", "order.deleted"] as const) {
      if (
        existing.some(
          (webhook) =>
            webhook.topic === topic &&
            canonicalUrl(webhook.delivery_url) === canonicalUrl(deliveryUrl)
        )
      ) {
        matched += 1;
        continue;
      }
      await this.http.request({
        method: "POST",
        url: apiUrl(credentials.storeUrl, "/webhooks"),
        headers: { ...authorizationHeaders(credentials), "content-type": "application/json" },
        body: JSON.stringify({
          name: `PennyWise Accounting ${topic}`,
          topic,
          delivery_url: deliveryUrl,
          secret: credentials.webhookSecret,
          status: "active"
        }),
        retryLimit: 0
      });
      created += 1;
    }
    return { status: "ACTIVE", created, existing: matched };
  }

  private async credentials(raw: Readonly<Record<string, unknown>>) {
    const consumerKey = requiredCredential(raw.consumerKey, "consumer key");
    const consumerSecret = requiredCredential(raw.consumerSecret, "consumer secret");
    if (!/^ck_[A-Za-z0-9]{20,}$/.test(consumerKey) || !/^cs_[A-Za-z0-9]{20,}$/.test(consumerSecret))
      throw new AppError(
        "CONNECTOR_CREDENTIAL_INVALID",
        "Enter valid WooCommerce consumer credentials.",
        422
      );
    const store = await validatePublicHttpsUrl(
      raw.storeUrl,
      this.resolveHost,
      "WOOCOMMERCE_STORE_URL_INVALID"
    );
    const webhookSecret =
      typeof raw.webhookSecret === "string" && raw.webhookSecret.length >= 24
        ? raw.webhookSecret
        : randomBytes(32).toString("base64url");
    return {
      storeUrl: store.toString().replace(/\/$/, ""),
      consumerKey,
      consumerSecret,
      webhookSecret
    };
  }
}

function authorizationHeaders(credentials: { consumerKey: string; consumerSecret: string }) {
  return {
    accept: "application/json",
    authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`, "utf8").toString("base64")}`,
    "user-agent": "PennyWise-Accounting-Commerce-Connector/1.0"
  };
}

function apiUrl(
  storeUrl: string,
  path: string,
  query: Readonly<Record<string, string>> = {}
): string {
  const url = new URL(`${storeUrl.replace(/\/$/, "")}/wp-json/wc/v3${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

function validWooSignature(rawBody: Buffer, secret: string, supplied: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  let actual: Buffer;
  try {
    actual = Buffer.from(supplied, "base64");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseJsonRecord(value: Buffer): JsonRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value.toString("utf8")) as unknown;
  } catch {
    throw invalidWebhook();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalidWebhook();
  return parsed as JsonRecord;
}

function jsonRecords(value: unknown, label: string): JsonRecord[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))
  )
    throw new AppError("CONNECTOR_RESPONSE_INVALID", `${label} response is invalid.`, 502);
  return value as JsonRecord[];
}

function requiredRecord(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("CONNECTOR_RESPONSE_INVALID", `${label} response is invalid.`, 502);
  return value as JsonRecord;
}

function wooCatalogProduct(
  storeUrl: string,
  product: JsonRecord,
  variants: readonly JsonRecord[]
): ConnectorCatalogProduct {
  const productId = requiredProviderIdentifier(product.id, "WooCommerce product ID");
  const productImages = wooImages(product.images);
  return {
    externalProductId: productId,
    name: requiredProviderText(product.name, "WooCommerce product name"),
    description: optionalProviderText(product.description),
    sourceStatus: optionalProviderText(product.status),
    sourceUrl: providerHttpsUrl(product.permalink, storeUrl),
    providerUpdatedAt: providerDate(product.date_modified_gmt ?? product.date_modified),
    images: productImages,
    variants: variants.map((variant) => {
      const variantId = requiredProviderIdentifier(variant.id, "WooCommerce variant ID");
      const attributes = Array.isArray(variant.attributes) ? variant.attributes : [];
      const signature = Object.fromEntries(
        attributes.flatMap((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const row = value as JsonRecord;
          const name = optionalProviderText(row.name);
          const option = optionalProviderText(row.option);
          return name && option ? [[name, option] as const] : [];
        })
      );
      const stock = nullableProviderInteger(variant.stock_quantity);
      return {
        externalVariantId: variantId,
        name:
          optionalProviderText(variant.name) ??
          `${requiredProviderText(product.name, "WooCommerce product name")} ${Object.values(signature).join(" ")}`.trim(),
        sku: optionalProviderText(variant.sku),
        gtin: optionalProviderText(variant.global_unique_id),
        variantSignature: signature,
        sourceStatus: optionalProviderText(variant.status ?? product.status),
        providerUpdatedAt: providerDate(variant.date_modified_gmt ?? variant.date_modified),
        observedQuantityMicros: stock === null ? null : (BigInt(stock) * 1_000_000n).toString(),
        images: wooImages(variant.image ? [variant.image] : []),
        safeMetadata: { productId, managesStock: variant.manage_stock === true }
      };
    })
  };
}

function wooImages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const image = entry as JsonRecord;
    const id = safeIdentifier(image.id);
    const src = providerHttpsUrl(image.src, null);
    if (!id || !src) return [];
    return [
      {
        externalImageId: id,
        remoteUrl: src,
        position: index,
        safeMetadata: { alt: optionalProviderText(image.alt) }
      }
    ];
  });
}

function providerHttpsUrl(value: unknown, expectedOrigin: string | null): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (expectedOrigin && url.origin !== new URL(expectedOrigin).origin) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function requiredProviderIdentifier(value: unknown, label: string): string {
  const result = safeIdentifier(value);
  if (!result || result.length > 200)
    throw new AppError("CONNECTOR_RESPONSE_INVALID", `${label} is invalid.`, 502);
  return result;
}

function requiredProviderText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 500)
    throw new AppError("CONNECTOR_RESPONSE_INVALID", `${label} is invalid.`, 502);
  return value.trim();
}

function optionalProviderText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 20_000) : null;
}

function providerDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const normalized = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function providerInteger(value: unknown, label: string): number {
  const result = nullableProviderInteger(value);
  if (result === null)
    throw new AppError("CONNECTOR_RESPONSE_INVALID", `${label} is invalid.`, 502);
  return result;
}

function nullableProviderInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function wholeUnits(quantityMicros: string): number {
  if (!/^-?\d+$/.test(quantityMicros))
    throw new AppError("EXACT_QUANTITY_INVALID", "Inventory quantity is invalid.", 422);
  const micros = BigInt(quantityMicros);
  if (micros < 0n || micros % 1_000_000n !== 0n)
    throw new AppError(
      "CONNECTOR_QUANTITY_UNSUPPORTED",
      "WooCommerce stock requires a non-negative whole-unit quantity.",
      422
    );
  const quantity = Number(micros / 1_000_000n);
  if (!Number.isSafeInteger(quantity))
    throw new AppError("EXACT_QUANTITY_INVALID", "Inventory quantity is too large.", 422);
  return quantity;
}

function requiredCredential(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512)
    throw new AppError("CONNECTOR_CREDENTIAL_INVALID", `Enter the WooCommerce ${label}.`, 422);
  return value.trim();
}

function cursorInteger(
  cursor: Readonly<Record<string, unknown>> | null,
  key: string,
  fallback: number
): number {
  const value = cursor?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function cursorNonnegativeInteger(
  cursor: Readonly<Record<string, unknown>> | null,
  key: string,
  fallback: number
): number {
  const value = cursor?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function numericHeader(value: string | undefined): number | null {
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

function safeIdentifier(value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string" && value.trim()
      ? value.trim()
      : null;
}

function canonicalOrigin(value: string): string | null {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

function canonicalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function invalidWebhook(): AppError {
  return new AppError("COMMERCE_WEBHOOK_INVALID", "Webhook verification failed.", 400);
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  work: (value: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (next < values.length) {
        const index = next;
        next += 1;
        results[index] = await work(values[index]!);
      }
    })
  );
  return results;
}
