export type ConnectorHealthStatus = "HEALTHY" | "DEGRADED";

export interface ConnectorValidationResult {
  readonly externalAccountId?: string;
  readonly displayName?: string;
  readonly credentials?: Readonly<Record<string, unknown>>;
}

export interface ConnectorHealthResult extends ConnectorValidationResult {
  readonly healthStatus: ConnectorHealthStatus;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface ConnectorAdapter {
  readonly providerKey: string;
  validateCredentials(
    credentials: Readonly<Record<string, unknown>>
  ): Promise<ConnectorValidationResult | undefined>;
  checkHealth(
    credentials: Readonly<Record<string, unknown>>
  ): Promise<ConnectorHealthStatus | ConnectorHealthResult>;
}

export interface CommerceNormalizationIssue {
  readonly code: string;
  readonly message: string;
  readonly severity: "INFO" | "WARNING" | "BLOCKING";
  readonly path?: string | undefined;
  readonly externalRef?: string | undefined;
}

export interface NormalizedCommerceEvent {
  readonly schemaVersion: 1;
  readonly provider: "WOOCOMMERCE" | "ETSY";
  readonly transactionKind: "ORDER" | "REFUND" | "SETTLEMENT" | "ORDER_STATUS";
  readonly externalId: string;
  readonly externalOrderId?: string | null | undefined;
  readonly sourceCreatedAt?: string | null;
  readonly sourceModifiedAt?: string | null;
  readonly status: string;
  readonly currencies: {
    readonly source: string | null;
    readonly payment: string | null;
    readonly settlement: string | null;
  };
  readonly money: Readonly<Record<string, ExactMoney | null>>;
  readonly lines: readonly NormalizedCommerceLine[];
  readonly taxes: readonly NormalizedCommerceComponent[];
  readonly shipping: readonly NormalizedCommerceComponent[];
  readonly discounts: readonly NormalizedCommerceComponent[];
  readonly fees: readonly NormalizedCommerceComponent[];
  readonly payments: readonly NormalizedCommercePayment[];
  readonly refunds: readonly NormalizedCommerceRefund[];
  readonly settlement: Readonly<Record<string, unknown>> | null;
  readonly mapping: {
    readonly customerStrategy: "POOLED" | "INDIVIDUAL" | "UNCONFIGURED";
    readonly itemStatus: "MAPPED" | "REVIEW_REQUIRED";
    readonly taxStatus: "MAPPED" | "REVIEW_REQUIRED";
    /** Never inferred from a channel. Seller or marketplace treatment is a reviewed configuration. */
    readonly taxRemittanceResponsibility:
      | "SELLER"
      | "MARKETPLACE"
      | "MIXED"
      | "REVIEW_REQUIRED"
      | "NOT_APPLICABLE";
    readonly taxRemittanceByComponent?: Readonly<
      Record<string, "SELLER" | "MARKETPLACE" | "REVIEW_REQUIRED">
    >;
  };
  readonly reconciliation: {
    readonly providerTotal: ExactMoney | null;
    readonly componentTotal: ExactMoney | null;
    readonly difference: ExactMoney | null;
    readonly balanced: boolean | null;
  };
  readonly issues: readonly CommerceNormalizationIssue[];
  readonly sourceMetadata: Readonly<Record<string, unknown>>;
}

export interface ExactMoney {
  readonly currency: string;
  readonly units: string;
  readonly divisor: string;
  readonly decimal: string;
  readonly providerRepresentation: unknown;
}

export interface NormalizedCommerceLine {
  readonly externalId: string;
  readonly productExternalId: string | null;
  readonly variationExternalId: string | null;
  readonly sku: string | null;
  readonly name: string;
  readonly quantity: string;
  readonly subtotal: ExactMoney | null;
  readonly total: ExactMoney | null;
  readonly tax: ExactMoney | null;
  readonly mappingStatus: "MAPPED" | "REVIEW_REQUIRED";
}

export interface NormalizedCommerceComponent {
  readonly externalId: string;
  readonly name: string;
  readonly amount: ExactMoney | null;
  readonly tax: ExactMoney | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedCommercePayment {
  readonly externalId: string;
  readonly status: string;
  readonly method: string | null;
  readonly amount: ExactMoney | null;
  readonly occurredAt: string | null;
}

export interface NormalizedCommerceRefund {
  readonly externalId: string;
  readonly status: string;
  readonly amount: ExactMoney | null;
  readonly occurredAt: string | null;
  readonly reason: string | null;
}

export interface CommerceConnectorEvent {
  readonly shopExternalId: string;
  readonly externalEventId: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly eventType: string;
  readonly eventVersion?: string | null;
  readonly occurredAt?: string | null;
  readonly sourceCurrency?: string | null;
  readonly paymentCurrency?: string | null;
  readonly settlementCurrency?: string | null;
  readonly rawPayload: Record<string, unknown>;
  readonly normalizedPayload: NormalizedCommerceEvent;
  readonly normalizationIssues: readonly CommerceNormalizationIssue[];
}

export interface CommerceSyncRequest {
  readonly from: Date;
  readonly to: Date;
  readonly cursor: Readonly<Record<string, unknown>> | null;
  readonly pageSize: number;
  readonly scope: "ORDERS" | "SETTLEMENTS";
  readonly mapping: Readonly<Record<string, unknown>>;
}

export interface CommerceSyncPage {
  readonly events: readonly CommerceConnectorEvent[];
  readonly nextCursor: Readonly<Record<string, unknown>> | null;
  readonly hasMore: boolean;
  readonly updatedCredentials?: Readonly<Record<string, unknown>>;
  readonly rateLimit?: Readonly<Record<string, unknown>>;
}

export interface ConnectorCatalogImage {
  readonly externalImageId: string;
  readonly remoteUrl: string;
  readonly contentTypeHint?: string | null;
  readonly byteLengthHint?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly position?: number;
  readonly safeMetadata?: Readonly<Record<string, unknown>>;
}

export interface ConnectorCatalogVariant {
  readonly externalVariantId: string;
  /** Alternate stable provider IDs visible on order lines, such as Etsy product_id. */
  readonly externalReferenceAliases?: readonly string[];
  readonly name: string;
  readonly sku?: string | null;
  readonly gtin?: string | null;
  readonly manufacturer?: string | null;
  readonly manufacturerPartNumber?: string | null;
  readonly variantSignature?: Readonly<Record<string, string>>;
  readonly sourceStatus?: string | null;
  readonly providerUpdatedAt?: Date | null;
  readonly observedQuantityMicros?: string | null;
  readonly images?: readonly ConnectorCatalogImage[];
  readonly safeMetadata?: Readonly<Record<string, unknown>>;
}

export interface ConnectorCatalogProduct {
  readonly externalProductId: string;
  readonly name: string;
  readonly description?: string | null;
  readonly sourceStatus?: string | null;
  readonly sourceUrl?: string | null;
  readonly providerUpdatedAt?: Date | null;
  readonly images?: readonly ConnectorCatalogImage[];
  readonly variants: readonly ConnectorCatalogVariant[];
}

export interface ConnectorCatalogRequest {
  readonly cursor: Readonly<Record<string, unknown>> | null;
  readonly pageSize: number;
}

export interface ConnectorCatalogPage {
  readonly products: readonly ConnectorCatalogProduct[];
  readonly nextCursor: Readonly<Record<string, unknown>> | null;
  readonly hasMore: boolean;
  readonly updatedCredentials?: Readonly<Record<string, unknown>>;
  readonly rateLimit?: Readonly<Record<string, unknown>>;
}

export interface ConnectorInventoryWriteRequest {
  readonly externalProductId: string;
  readonly externalVariantId: string;
  readonly quantityMicros: string;
  /** Last reviewed provider quantity. Full-replacement providers use it as a stale-write guard. */
  readonly expectedQuantityMicros?: string;
  readonly idempotencyKey: string;
}

export interface ConnectorInventoryWriteResult {
  readonly externalOperationId: string | null;
  readonly observedQuantityMicros: string;
  readonly updatedCredentials?: Readonly<Record<string, unknown>>;
  readonly safeMetadata?: Readonly<Record<string, unknown>>;
}

export interface CommerceWebhookInput {
  readonly rawBody: Buffer;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly now: Date;
  readonly mapping: Readonly<Record<string, unknown>>;
  readonly mappingVersion: number;
}

export interface CommerceWebhookResult {
  readonly ping?: boolean;
  readonly events: readonly CommerceConnectorEvent[];
  readonly updatedCredentials?: Readonly<Record<string, unknown>>;
}

export interface WebhookRegistrationInput {
  readonly deliveryUrl: string;
}

export interface WebhookRegistrationResult {
  readonly status: "ACTIVE" | "NOT_CONFIGURED";
  readonly created: number;
  readonly existing: number;
}

export interface EtsyOAuthStartInput {
  readonly apiKey: string;
  readonly sharedSecret: string;
  readonly shopId?: string;
  readonly redirectUri: string;
}

export interface EtsyOAuthStartResult {
  readonly authorizationUrl: string;
  readonly pendingCredentials: Readonly<Record<string, unknown>>;
  readonly expiresAt: Date;
}

export interface EtsyOAuthCompleteInput {
  readonly code: string;
  readonly state: string;
}

export interface CommerceConnectorAdapter extends ConnectorAdapter {
  readonly providerKey: "WOOCOMMERCE" | "ETSY";
  syncPage(
    credentials: Readonly<Record<string, unknown>>,
    request: CommerceSyncRequest
  ): Promise<CommerceSyncPage>;
  /**
   * Returns normalized provider evidence only. CatalogAutomationService owns
   * persistence and always sends every returned variant through the shared
   * nearest SKU/name/description matcher.
   */
  catalogPage(
    credentials: Readonly<Record<string, unknown>>,
    request: ConnectorCatalogRequest
  ): Promise<ConnectorCatalogPage>;
  updateInventory(
    credentials: Readonly<Record<string, unknown>>,
    request: ConnectorInventoryWriteRequest
  ): Promise<ConnectorInventoryWriteResult>;
  verifyWebhook(
    credentials: Readonly<Record<string, unknown>>,
    input: CommerceWebhookInput
  ): Promise<CommerceWebhookResult> | CommerceWebhookResult;
  registerWebhooks?(
    credentials: Readonly<Record<string, unknown>>,
    input: WebhookRegistrationInput
  ): Promise<WebhookRegistrationResult>;
  beginOAuth?(input: EtsyOAuthStartInput): Promise<EtsyOAuthStartResult>;
  completeOAuth?(
    pendingCredentials: Readonly<Record<string, unknown>>,
    input: EtsyOAuthCompleteInput
  ): Promise<ConnectorValidationResult>;
}

export function isCommerceConnectorAdapter(
  adapter: ConnectorAdapter
): adapter is CommerceConnectorAdapter {
  const candidate = adapter as Partial<CommerceConnectorAdapter>;
  return (
    typeof candidate.syncPage === "function" &&
    typeof candidate.catalogPage === "function" &&
    typeof candidate.updateInventory === "function" &&
    typeof candidate.verifyWebhook === "function"
  );
}
