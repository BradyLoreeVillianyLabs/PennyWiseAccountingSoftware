import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "@clearledger/shared";
import {
  normalizeEtsyLedgerEntry,
  normalizeEtsyReceipt,
  privacySafeCommercePayload
} from "./commerce-normalization.js";
import type {
  CommerceConnectorAdapter,
  ConnectorCatalogImage,
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
  EtsyOAuthCompleteInput,
  EtsyOAuthStartInput,
  EtsyOAuthStartResult
} from "./commerce-connector-types.js";
import {
  ConnectorHttpError,
  FetchConnectorHttpClient,
  type ConnectorHttpClient,
  type HostResolver,
  systemHostResolver,
  validatePublicHttpsUrl
} from "./connector-http-client.js";

type JsonRecord = Record<string, unknown>;

const etsyApiOrigin = "https://openapi.etsy.com";
const etsyTokenUrl = "https://api.etsy.com/v3/public/oauth/token";
const etsyWebhookResourceOrigins = new Set([etsyApiOrigin, "https://api.etsy.com"]);

interface EtsyCredentials {
  readonly [key: string]: unknown;
  readonly apiKey: string;
  readonly sharedSecret: string;
  readonly shopId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly webhookSecret?: string;
}

export class EtsyConnector implements CommerceConnectorAdapter {
  public readonly providerKey = "ETSY" as const;

  public constructor(
    private readonly http: ConnectorHttpClient = new FetchConnectorHttpClient(),
    private readonly resolveHost: HostResolver = systemHostResolver
  ) {}

  public async beginOAuth(input: EtsyOAuthStartInput): Promise<EtsyOAuthStartResult> {
    const apiKey = requiredText(input.apiKey, "Etsy app key", 256);
    const sharedSecret = requiredText(input.sharedSecret, "Etsy shared secret", 512);
    const redirectUri = (
      await validatePublicHttpsUrl(input.redirectUri, this.resolveHost, "ETSY_REDIRECT_URI_INVALID")
    ).toString();
    const state = randomBytes(32).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const authorizationUrl = new URL("https://www.etsy.com/oauth/connect");
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", "shops_r listings_r listings_w transactions_r");
    authorizationUrl.searchParams.set("client_id", apiKey);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    return {
      authorizationUrl: authorizationUrl.toString(),
      expiresAt,
      pendingCredentials: {
        apiKey,
        sharedSecret,
        ...(input.shopId?.trim() ? { shopId: input.shopId.trim() } : {}),
        oauthPending: {
          stateHash: hash(state),
          verifier,
          redirectUri,
          expiresAt: expiresAt.toISOString()
        }
      }
    };
  }

  public async completeOAuth(
    pending: Readonly<Record<string, unknown>>,
    input: EtsyOAuthCompleteInput
  ): Promise<ConnectorValidationResult> {
    const apiKey = requiredText(pending.apiKey, "Etsy app key", 256);
    const sharedSecret = requiredText(pending.sharedSecret, "Etsy shared secret", 512);
    const oauthPending = requiredRecord(pending.oauthPending, "OAuth state");
    const expectedStateHash = requiredText(oauthPending.stateHash, "OAuth state", 64);
    if (!constantTimeTextEqual(hash(input.state), expectedStateHash)) throw oauthInvalid();
    const expiresAt = new Date(requiredText(oauthPending.expiresAt, "OAuth expiry", 64));
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) throw oauthInvalid();
    const verifier = requiredText(oauthPending.verifier, "OAuth verifier", 256);
    const redirectUri = requiredText(oauthPending.redirectUri, "OAuth redirect URI", 2048);
    const token = await this.tokenRequest({
      grant_type: "authorization_code",
      client_id: apiKey,
      redirect_uri: redirectUri,
      code: requiredText(input.code, "authorization code", 2048),
      code_verifier: verifier
    });
    const accessToken = requiredText(token.access_token, "access token", 4096);
    const refreshToken = requiredText(token.refresh_token, "refresh token", 4096);
    const tokenExpiresAt = tokenExpiry(token.expires_in);
    const userResponse = await this.http.request({
      url: `${etsyApiOrigin}/v3/application/users/me`,
      headers: etsyHeaders({ apiKey, sharedSecret, accessToken })
    });
    const user = requiredRecord(userResponse.body, "Etsy user");
    const shopId =
      optionalIdentifier(pending.shopId) ??
      optionalIdentifier(user.shop_id) ??
      optionalIdentifier(record(user.primary_shop)?.shop_id);
    if (!shopId)
      throw new AppError(
        "ETSY_SHOP_ID_REQUIRED",
        "Etsy did not return a shop ID. Enter the shop ID and reconnect.",
        422
      );
    const credentials: EtsyCredentials = {
      apiKey,
      sharedSecret,
      shopId,
      accessToken,
      refreshToken,
      expiresAt: tokenExpiresAt.toISOString(),
      ...(typeof pending.webhookSecret === "string" ? { webhookSecret: pending.webhookSecret } : {})
    };
    await this.assertShop(credentials);
    return { externalAccountId: shopId, displayName: `Etsy shop ${shopId}`, credentials };
  }

  public async validateCredentials(
    raw: Readonly<Record<string, unknown>>
  ): Promise<ConnectorValidationResult> {
    const current = parseCredentials(raw);
    const refreshed = await this.ensureAccess(current);
    await this.assertShop(refreshed.credentials);
    return {
      externalAccountId: refreshed.credentials.shopId,
      displayName: `Etsy shop ${refreshed.credentials.shopId}`,
      ...(refreshed.changed ? { credentials: refreshed.credentials } : {})
    };
  }

  public async checkHealth(raw: Readonly<Record<string, unknown>>): Promise<ConnectorHealthResult> {
    const refreshed = await this.ensureAccess(parseCredentials(raw));
    const response = await this.assertShop(refreshed.credentials);
    return {
      healthStatus: "HEALTHY",
      externalAccountId: refreshed.credentials.shopId,
      ...(refreshed.changed ? { credentials: refreshed.credentials } : {}),
      detail: { providerApi: "etsy-v3", rateLimit: rateLimitMetadata(response.headers) }
    };
  }

  public async syncPage(
    raw: Readonly<Record<string, unknown>>,
    request: CommerceSyncRequest
  ): Promise<CommerceSyncPage> {
    const refreshed = await this.ensureAccess(parseCredentials(raw));
    const credentials = refreshed.credentials;
    const offset = cursorInteger(request.cursor, "offset", 0);
    if (request.scope === "SETTLEMENTS") {
      const response = await this.http.request({
        url: etsyApiUrl(
          `/v3/application/shops/${encodeURIComponent(credentials.shopId)}/payment-account/ledger-entries`,
          {
            min_created: unixSeconds(request.from),
            max_created: unixSeconds(request.to),
            limit: String(Math.max(1, Math.min(100, request.pageSize))),
            offset: String(offset)
          }
        ),
        headers: etsyHeaders(credentials)
      });
      const page = pagedResults(response.body, "Etsy ledger");
      const events = page.results.map((entry) => {
        const event = normalizeEtsyLedgerEntry(entry, credentials.shopId);
        return { ...event, rawPayload: privacySafeCommercePayload(entry) };
      });
      const nextOffset = offset + page.results.length;
      const hasMore = nextOffset < page.count && page.results.length > 0;
      return {
        events,
        nextCursor: hasMore ? { offset: nextOffset } : null,
        hasMore,
        ...(refreshed.changed ? { updatedCredentials: credentials } : {}),
        rateLimit: rateLimitMetadata(response.headers)
      };
    }
    const response = await this.http.request({
      url: etsyApiUrl(`/v3/application/shops/${encodeURIComponent(credentials.shopId)}/receipts`, {
        min_last_modified: unixSeconds(request.from),
        max_last_modified: unixSeconds(request.to),
        sort_on: "updated",
        sort_order: "asc",
        limit: String(Math.max(1, Math.min(100, request.pageSize))),
        offset: String(offset)
      }),
      headers: etsyHeaders(credentials)
    });
    const page = pagedResults(response.body, "Etsy receipts");
    const enriched = await mapConcurrent(page.results, 4, async (receipt) => {
      const receiptId = optionalIdentifier(receipt.receipt_id);
      if (!receiptId) return receipt;
      try {
        const payments = await this.http.request({
          url: `${etsyApiOrigin}/v3/application/shops/${encodeURIComponent(credentials.shopId)}/receipts/${encodeURIComponent(receiptId)}/payments`,
          headers: etsyHeaders(credentials)
        });
        return { ...receipt, _clearledger_payments: pagedOrArray(payments.body, "Etsy payments") };
      } catch (error) {
        // Etsy may not expose a payment until fulfilment. Preserve the paid sale
        // and let scheduled reconciliation add payment evidence later.
        if (error instanceof ConnectorHttpError && error.status === 404) return receipt;
        throw error;
      }
    });
    const events = enriched.map((receipt) => {
      const event = normalizeEtsyReceipt(receipt, credentials.shopId, request.mapping);
      return { ...event, rawPayload: privacySafeCommercePayload(receipt) };
    });
    const nextOffset = offset + page.results.length;
    const hasMore = nextOffset < page.count && page.results.length > 0;
    return {
      events,
      nextCursor: hasMore ? { offset: nextOffset } : null,
      hasMore,
      ...(refreshed.changed ? { updatedCredentials: credentials } : {}),
      rateLimit: rateLimitMetadata(response.headers)
    };
  }

  /** Etsy does not provide catalog webhooks on the generally available surface. */
  public async catalogPage(
    raw: Readonly<Record<string, unknown>>,
    request: ConnectorCatalogRequest
  ): Promise<ConnectorCatalogPage> {
    const refreshed = await this.ensureAccess(parseCredentials(raw));
    const credentials = refreshed.credentials;
    const states = ["active", "draft", "inactive"] as const;
    const stateIndex = cursorInteger(request.cursor, "stateIndex", 0);
    const offset = cursorInteger(request.cursor, "offset", 0);
    const state = states[stateIndex];
    if (!state)
      return {
        products: [],
        nextCursor: null,
        hasMore: false,
        ...(refreshed.changed ? { updatedCredentials: credentials } : {})
      };
    const response = await this.http.request({
      url: etsyApiUrl(
        `/v3/application/shops/${encodeURIComponent(credentials.shopId)}/listings/${state}`,
        {
          limit: String(Math.max(1, Math.min(25, request.pageSize))),
          offset: String(offset),
          sort_on: "updated",
          sort_order: "asc"
        }
      ),
      headers: etsyHeaders(credentials)
    });
    const page = pagedResults(response.body, `Etsy ${state} listings`);
    const products = await mapConcurrent(page.results, 4, async (listing) =>
      this.catalogListing(credentials, listing, state)
    );
    const nextOffset = offset + page.results.length;
    const moreInState = page.results.length > 0 && nextOffset < page.count;
    const nextCursor = moreInState
      ? { stateIndex, offset: nextOffset }
      : stateIndex + 1 < states.length
        ? { stateIndex: stateIndex + 1, offset: 0 }
        : null;
    return {
      products,
      nextCursor,
      hasMore: nextCursor !== null,
      ...(refreshed.changed ? { updatedCredentials: credentials } : {}),
      rateLimit: rateLimitMetadata(response.headers)
    };
  }

  public async updateInventory(
    raw: Readonly<Record<string, unknown>>,
    request: ConnectorInventoryWriteRequest
  ): Promise<ConnectorInventoryWriteResult> {
    const refreshed = await this.ensureAccess(parseCredentials(raw));
    const credentials = refreshed.credentials;
    const listingId = requiredText(request.externalProductId, "Etsy listing ID", 200);
    const offeringId = requiredText(request.externalVariantId, "Etsy offering ID", 200);
    const quantity = wholeUnits(request.quantityMicros);
    const expectedQuantity = request.expectedQuantityMicros
      ? wholeUnits(request.expectedQuantityMicros)
      : null;
    const inventoryResponse = await this.http.request({
      url: `${etsyApiOrigin}/v3/application/listings/${encodeURIComponent(listingId)}/inventory`,
      headers: etsyHeaders(credentials)
    });
    const inventory = requiredRecord(inventoryResponse.body, "Etsy listing inventory");
    const products = arrayRecords(inventory.products, "Etsy inventory products");
    const matchedOffering = products
      .flatMap((product) => arrayRecords(product.offerings, "Etsy offerings"))
      .find((offering) => optionalIdentifier(offering.offering_id) === offeringId);
    const updateProducts = products.map((product) => ({
      sku: optionalText(product.sku) ?? "",
      property_values: arrayRecords(product.property_values ?? [], "Etsy property values").map(
        (property) => ({
          property_id: requiredInteger(property.property_id, "Etsy property ID"),
          property_name: optionalText(property.property_name) ?? "",
          scale_id: nullableInteger(property.scale_id),
          value_ids: integerArray(property.value_ids),
          values: stringArray(property.values)
        })
      ),
      offerings: arrayRecords(product.offerings, "Etsy offerings").map((offering) => {
        const currentId = optionalIdentifier(offering.offering_id);
        const target = currentId === offeringId;
        return {
          price: requiredRecord(offering.price, "Etsy offering price"),
          quantity: target ? quantity : requiredInteger(offering.quantity, "Etsy quantity"),
          is_enabled: offering.is_enabled !== false
        };
      })
    }));
    if (!matchedOffering)
      throw new AppError(
        "CONNECTOR_VARIANT_NOT_FOUND",
        "The Etsy inventory offering was not found.",
        409
      );
    const currentQuantity = requiredInteger(matchedOffering.quantity, "Etsy quantity");
    if (expectedQuantity !== null && currentQuantity !== expectedQuantity)
      throw new AppError(
        "CONNECTOR_INVENTORY_CHANGED",
        "Etsy inventory changed after the reviewed observation. Refresh and review the new quantity before writing.",
        409
      );
    const response = await this.http.request({
      method: "PUT",
      url: `${etsyApiOrigin}/v3/application/listings/${encodeURIComponent(listingId)}/inventory`,
      headers: {
        ...etsyHeaders(credentials),
        "content-type": "application/json",
        "x-clearledger-idempotency-key": request.idempotencyKey
      },
      body: JSON.stringify({ products: updateProducts }),
      retryLimit: 0
    });
    return {
      externalOperationId: response.headers["x-request-id"] ?? null,
      observedQuantityMicros: (BigInt(quantity) * 1_000_000n).toString(),
      ...(refreshed.changed ? { updatedCredentials: credentials } : {}),
      safeMetadata: { provider: "ETSY", listingId, offeringId }
    };
  }

  private async catalogListing(
    credentials: EtsyCredentials,
    listing: JsonRecord,
    state: string
  ): Promise<ConnectorCatalogProduct> {
    const listingId = requiredProviderIdentifier(listing.listing_id, "Etsy listing ID");
    const [inventoryResponse, imageResponse] = await Promise.all([
      this.http.request({
        url: `${etsyApiOrigin}/v3/application/listings/${encodeURIComponent(listingId)}/inventory`,
        headers: etsyHeaders(credentials)
      }),
      this.http.request({
        url: `${etsyApiOrigin}/v3/application/listings/${encodeURIComponent(listingId)}/images`,
        headers: etsyHeaders(credentials)
      })
    ]);
    const inventory = requiredRecord(inventoryResponse.body, "Etsy listing inventory");
    const images = pagedOrArray(imageResponse.body, "Etsy listing images").flatMap(etsyImage);
    const variants = arrayRecords(inventory.products, "Etsy inventory products").flatMap(
      (product) => {
        const signature = etsyVariantSignature(product.property_values);
        const productId = optionalIdentifier(product.product_id);
        return arrayRecords(product.offerings, "Etsy offerings").map((offering) => {
          const offeringId = requiredProviderIdentifier(offering.offering_id, "Etsy offering ID");
          const quantity = requiredInteger(offering.quantity, "Etsy inventory quantity");
          return {
            externalVariantId: offeringId,
            ...(productId ? { externalReferenceAliases: [productId] } : {}),
            name: `${requiredText(listing.title, "Etsy listing title", 500)} ${Object.values(signature).join(" ")}`.trim(),
            sku: optionalText(product.sku),
            variantSignature: signature,
            sourceStatus: offering.is_enabled === false ? "disabled" : state,
            providerUpdatedAt: unixDate(listing.updated_timestamp),
            observedQuantityMicros: (BigInt(quantity) * 1_000_000n).toString(),
            images,
            safeMetadata: {
              productId,
              isEnabled: offering.is_enabled !== false
            }
          };
        });
      }
    );
    if (!variants.length)
      throw new AppError(
        "CONNECTOR_RESPONSE_INVALID",
        "Etsy listing inventory did not contain an offering.",
        502
      );
    return {
      externalProductId: listingId,
      name: requiredText(listing.title, "Etsy listing title", 500),
      description: optionalText(listing.description),
      sourceStatus: state,
      sourceUrl: etsyListingUrl(listing.url),
      providerUpdatedAt: unixDate(listing.updated_timestamp),
      images,
      variants
    };
  }

  public async verifyWebhook(
    raw: Readonly<Record<string, unknown>>,
    input: CommerceWebhookInput
  ): Promise<CommerceWebhookResult> {
    const initial = parseCredentials(raw);
    if (!initial.webhookSecret) throw invalidWebhook();
    verifyEtsySignature(input, initial.webhookSecret);
    const payload = parseJsonRecord(input.rawBody);
    const shopId = optionalIdentifier(payload.shop_id);
    const eventType = typeof payload.event_type === "string" ? payload.event_type.trim() : "";
    const resourceUrl = typeof payload.resource_url === "string" ? payload.resource_url.trim() : "";
    if (
      shopId !== initial.shopId ||
      !["order.paid", "order.canceled", "order.shipped", "order.delivered"].includes(eventType) ||
      !validEtsyResourceUrl(resourceUrl, initial.shopId)
    )
      throw invalidWebhook();
    const refreshed = await this.ensureAccess(initial);
    const receiptResponse = await this.http.request({
      url: resourceUrl,
      headers: etsyHeaders(refreshed.credentials)
    });
    const receipt = requiredRecord(receiptResponse.body, "Etsy receipt");
    const receiptId = optionalIdentifier(receipt.receipt_id);
    let enriched = receipt;
    if (receiptId) {
      try {
        const paymentResponse = await this.http.request({
          url: `${etsyApiOrigin}/v3/application/shops/${encodeURIComponent(initial.shopId)}/receipts/${encodeURIComponent(receiptId)}/payments`,
          headers: etsyHeaders(refreshed.credentials)
        });
        enriched = {
          ...receipt,
          _clearledger_payments: pagedOrArray(paymentResponse.body, "Etsy payments")
        };
      } catch (error) {
        if (!(error instanceof ConnectorHttpError && error.status === 404)) throw error;
      }
    }
    const event = normalizeEtsyReceipt(enriched, initial.shopId, input.mapping);
    return {
      ...(refreshed.changed ? { updatedCredentials: refreshed.credentials } : {}),
      events: [
        {
          ...event,
          eventType,
          rawPayload: privacySafeCommercePayload({ webhook: payload, receipt: enriched })
        }
      ]
    };
  }

  private async assertShop(credentials: EtsyCredentials) {
    return this.http.request({
      url: etsyApiUrl(`/v3/application/shops/${encodeURIComponent(credentials.shopId)}/receipts`, {
        limit: "1",
        offset: "0"
      }),
      headers: etsyHeaders(credentials),
      retryLimit: 0
    });
  }

  private async ensureAccess(
    credentials: EtsyCredentials
  ): Promise<{ credentials: EtsyCredentials; changed: boolean }> {
    if (new Date(credentials.expiresAt).getTime() > Date.now() + 60_000)
      return { credentials, changed: false };
    const token = await this.tokenRequest({
      grant_type: "refresh_token",
      client_id: credentials.apiKey,
      refresh_token: credentials.refreshToken
    });
    const refreshed: EtsyCredentials = {
      ...credentials,
      accessToken: requiredText(token.access_token, "access token", 4096),
      refreshToken: requiredText(
        token.refresh_token ?? credentials.refreshToken,
        "refresh token",
        4096
      ),
      expiresAt: tokenExpiry(token.expires_in).toISOString()
    };
    return { credentials: refreshed, changed: true };
  }

  private async tokenRequest(fields: Readonly<Record<string, string>>): Promise<JsonRecord> {
    const response = await this.http.request({
      method: "POST",
      url: etsyTokenUrl,
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "PennyWise-Accounting-Commerce-Connector/1.0"
      },
      body: new URLSearchParams(fields).toString(),
      retryLimit: 0
    });
    return requiredRecord(response.body, "Etsy token");
  }
}

function parseCredentials(raw: Readonly<Record<string, unknown>>): EtsyCredentials {
  const apiKey = requiredText(raw.apiKey, "Etsy app key", 256);
  const sharedSecret = requiredText(raw.sharedSecret, "Etsy shared secret", 512);
  const shopId = requiredText(raw.shopId, "Etsy shop ID", 200);
  const accessToken = requiredText(raw.accessToken, "Etsy access token", 4096);
  const refreshToken = requiredText(raw.refreshToken, "Etsy refresh token", 4096);
  const expiresAt = requiredText(raw.expiresAt, "Etsy token expiry", 64);
  if (Number.isNaN(new Date(expiresAt).getTime()))
    throw new AppError("CONNECTOR_CREDENTIAL_INVALID", "Etsy token expiry is invalid.", 422);
  return {
    apiKey,
    sharedSecret,
    shopId,
    accessToken,
    refreshToken,
    expiresAt,
    ...(typeof raw.webhookSecret === "string" && raw.webhookSecret.trim()
      ? { webhookSecret: raw.webhookSecret.trim() }
      : {})
  };
}

function etsyHeaders(
  credentials: Pick<EtsyCredentials, "apiKey" | "sharedSecret" | "accessToken">
) {
  return {
    accept: "application/json",
    authorization: `Bearer ${credentials.accessToken}`,
    "x-api-key": `${credentials.apiKey}:${credentials.sharedSecret}`,
    "user-agent": "PennyWise-Accounting-Commerce-Connector/1.0"
  };
}

function etsyApiUrl(path: string, query: Readonly<Record<string, string>>): string {
  const url = new URL(path, etsyApiOrigin);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.toString();
}

function verifyEtsySignature(input: CommerceWebhookInput, secret: string): void {
  const id = input.headers["webhook-id"]?.trim();
  const timestamp = input.headers["webhook-timestamp"]?.trim();
  const signatures = input.headers["webhook-signature"]?.trim();
  if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) throw invalidWebhook();
  const timestampDate = new Date(Number(timestamp) * 1000);
  if (Math.abs(input.now.getTime() - timestampDate.getTime()) > 5 * 60_000) throw invalidWebhook();
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  } catch {
    throw invalidWebhook();
  }
  if (key.length < 16) throw invalidWebhook();
  const expected = createHmac("sha256", key)
    .update(id)
    .update(".")
    .update(timestamp)
    .update(".")
    .update(input.rawBody)
    .digest();
  const candidates = signatures
    .split(/\s+/)
    .map((entry) => (entry.includes(",") ? entry.slice(entry.indexOf(",") + 1) : entry))
    .filter(Boolean);
  const valid = candidates.some((entry) => {
    try {
      const actual = Buffer.from(entry, "base64");
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  });
  if (!valid) throw invalidWebhook();
}

function validEtsyResourceUrl(value: string, shopId: string): boolean {
  try {
    const url = new URL(value);
    return (
      etsyWebhookResourceOrigins.has(url.origin) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.startsWith(`/v3/application/shops/${encodeURIComponent(shopId)}/receipts/`)
    );
  } catch {
    return false;
  }
}

function pagedResults(value: unknown, label: string): { count: number; results: JsonRecord[] } {
  const envelope = requiredRecord(value, label);
  const results = arrayRecords(envelope.results, label);
  const count =
    typeof envelope.count === "number" && Number.isSafeInteger(envelope.count)
      ? envelope.count
      : results.length;
  return { count: Math.max(count, results.length), results };
}

function pagedOrArray(value: unknown, label: string): JsonRecord[] {
  if (Array.isArray(value)) return arrayRecords(value, label);
  return pagedResults(value, label).results;
}

function arrayRecords(value: unknown, label: string): JsonRecord[] {
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

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function parseJsonRecord(value: Buffer): JsonRecord {
  try {
    return requiredRecord(JSON.parse(value.toString("utf8")) as unknown, "Etsy webhook");
  } catch {
    throw invalidWebhook();
  }
}

function requiredText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new AppError("CONNECTOR_CREDENTIAL_INVALID", `${label} is missing or invalid.`, 422);
  return value.trim();
}

function optionalIdentifier(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return null;
}

function requiredProviderIdentifier(value: unknown, label: string): string {
  const identifier = optionalIdentifier(value);
  if (!identifier || identifier.length > 200)
    throw new AppError("CONNECTOR_RESPONSE_INVALID", `${label} is invalid.`, 502);
  return identifier;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 20_000) : null;
}

function requiredInteger(value: unknown, label: string): number {
  const integer = nullableInteger(value);
  if (integer === null)
    throw new AppError("CONNECTOR_RESPONSE_INVALID", `${label} is invalid.`, 502);
  return integer;
}

function nullableInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function integerArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const integer = nullableInteger(entry);
        return integer === null ? [] : [integer];
      })
    : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => (typeof entry === "string" ? [entry.slice(0, 500)] : []))
    : [];
}

function wholeUnits(quantityMicros: string): number {
  if (!/^-?\d+$/.test(quantityMicros))
    throw new AppError("EXACT_QUANTITY_INVALID", "Inventory quantity is invalid.", 422);
  const micros = BigInt(quantityMicros);
  if (micros < 0n || micros % 1_000_000n !== 0n)
    throw new AppError(
      "CONNECTOR_QUANTITY_UNSUPPORTED",
      "Etsy stock requires a non-negative whole-unit quantity.",
      422
    );
  const quantity = Number(micros / 1_000_000n);
  if (!Number.isSafeInteger(quantity))
    throw new AppError("EXACT_QUANTITY_INVALID", "Inventory quantity is too large.", 422);
  return quantity;
}

function etsyImage(value: JsonRecord): ConnectorCatalogImage[] {
  const id = optionalIdentifier(value.listing_image_id);
  const url = etsyImageUrl(value.url_fullxfull ?? value.url_570xN ?? value.url_170x135);
  if (!id || !url) return [];
  return [
    {
      externalImageId: id,
      remoteUrl: url,
      width: nullableInteger(value.full_width),
      height: nullableInteger(value.full_height),
      position: Math.max(0, nullableInteger(value.rank) ?? 0),
      safeMetadata: { rank: nullableInteger(value.rank) }
    }
  ];
}

function etsyImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "etsystatic.com" && !hostname.endsWith(".etsystatic.com")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function etsyListingUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.toLowerCase().endsWith("etsy.com")) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function etsyVariantSignature(value: unknown): Record<string, string> {
  if (!Array.isArray(value)) return {};
  return Object.fromEntries(
    value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const property = entry as JsonRecord;
      const name = optionalText(property.property_name);
      const values = stringArray(property.values).join(" / ");
      return name && values ? [[name, values] as const] : [];
    })
  );
}

function unixDate(value: unknown): Date | null {
  const seconds = nullableInteger(value);
  if (seconds === null || seconds < 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function tokenExpiry(value: unknown): Date {
  const seconds =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : 3600;
  return new Date(Date.now() + Math.max(60, Math.min(86_400, seconds)) * 1000);
}

function cursorInteger(
  cursor: Readonly<Record<string, unknown>> | null,
  key: string,
  fallback: number
): number {
  const value = cursor?.[key];
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function unixSeconds(value: Date): string {
  return String(Math.floor(value.getTime() / 1000));
}

function rateLimitMetadata(headers: Readonly<Record<string, string>>) {
  return Object.fromEntries(
    [
      "x-limit-per-second",
      "x-remaining-this-second",
      "x-limit-per-day",
      "x-remaining-today",
      "retry-after"
    ]
      .filter((key) => headers[key] !== undefined)
      .map((key) => [key, headers[key]!])
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function oauthInvalid(): AppError {
  return new AppError("ETSY_OAUTH_INVALID", "Etsy authorization is invalid or expired.", 400);
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
