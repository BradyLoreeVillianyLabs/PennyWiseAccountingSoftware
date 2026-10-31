import type { OrganizationContext } from "@clearledger/shared";
import { CatalogMappingService } from "./catalog-mapping-service.js";
import { CommerceInboxService } from "./commerce-inbox-service.js";
import { ConnectorRuntimeService } from "./connector-runtime-service.js";
import { normalizeWooOrder } from "./connectors/commerce-normalization.js";

const demoMapping = {
  demoFixtureVersion: 1,
  customerStrategy: "POOLED",
  taxMappings: { "GST/HST": "sample-tax-code" },
  taxRemittanceResponsibility: "SELLER"
} as const;

const demoOrder = {
  id: 1001,
  status: "processing",
  currency: "USD",
  total: "33.59",
  discount_total: "2.00",
  shipping_total: "5.00",
  total_tax: "2.59",
  transaction_id: "sample-payment-1001",
  payment_method: "stripe",
  payment_method_title: "Card",
  prices_include_tax: false,
  created_via: "rest-api",
  date_created_gmt: "2026-07-15T16:00:00.000Z",
  date_modified_gmt: "2026-07-15T16:05:00.000Z",
  date_paid_gmt: "2026-07-15T16:01:00.000Z",
  line_items: [
    {
      id: 1,
      product_id: 501,
      variation_id: 0,
      sku: "DEMO-MUG",
      name: "Sample ceramic mug",
      quantity: 1,
      subtotal: "28.00",
      total: "26.00",
      total_tax: "2.59"
    }
  ],
  shipping_lines: [{ id: 2, method_title: "Standard shipping", total: "5.00", total_tax: "0.00" }],
  tax_lines: [{ id: 3, label: "GST/HST", tax_total: "2.59" }],
  fee_lines: [],
  coupon_lines: [{ id: 4, code: "WELCOME", discount: "2.00", discount_tax: "0.00" }],
  refunds: []
};

/** Creates deterministic, non-posting evidence so trusted preview users can try the review UX. */
export class CommerceDemoService {
  public constructor(
    private readonly runtime: ConnectorRuntimeService,
    private readonly inbox: CommerceInboxService,
    private readonly catalog: CatalogMappingService
  ) {}

  public async stage(context: OrganizationContext) {
    const connectors = await this.runtime.list(context);
    let connector = connectors.find(
      (candidate) =>
        candidate.providerKey === "WOOCOMMERCE" &&
        candidate.mapping &&
        typeof candidate.mapping === "object" &&
        !Array.isArray(candidate.mapping) &&
        (candidate.mapping as { demoFixtureVersion?: unknown }).demoFixtureVersion === 1 &&
        candidate.status !== "DISCONNECTED"
    );
    connector ??= await this.runtime.createDraft(context, {
      providerKey: "WOOCOMMERCE",
      displayName: "Sample Woo store (review only)",
      mapping: demoMapping
    });
    const observed = await this.catalog.upsertObservedCatalog(context, connector.id, {
      externalProductId: "501",
      name: "Sample ceramic mug",
      description: "Fictional product used to demonstrate review-only catalog matching.",
      sourceStatus: "publish",
      variants: [
        {
          externalVariantId: "501",
          name: "Sample ceramic mug",
          sku: "DEMO-MUG",
          sourceStatus: "publish"
        }
      ]
    });
    const candidateSuggestions = await this.catalog.suggestCandidatesBatch(
      context,
      observed.variants.map((variant) => variant.id)
    );
    const normalized = normalizeWooOrder(
      demoOrder,
      "sample-store.example",
      connector.mapping as Readonly<Record<string, unknown>>
    );
    const staged = await this.inbox.ingest(context, {
      installationId: connector.id,
      providerKey: "WOOCOMMERCE",
      shopExternalId: normalized.shopExternalId,
      externalEventId: normalized.externalEventId,
      resourceType: normalized.resourceType,
      resourceId: normalized.resourceId,
      eventType: normalized.eventType,
      eventVersion: normalized.eventVersion,
      occurredAt: normalized.occurredAt,
      sourceCurrency: normalized.sourceCurrency,
      paymentCurrency: normalized.paymentCurrency,
      settlementCurrency: normalized.settlementCurrency,
      rawPayload: normalized.rawPayload,
      normalizedPayload: normalized.normalizedPayload as unknown as Record<string, unknown>,
      normalizedSchemaVersion: 1,
      normalizationIssues: normalized.normalizationIssues,
      mappingVersion: connector.mappingVersion
    });
    return {
      connector,
      candidateSuggestions,
      ...staged.body,
      postingMode: "SHADOW_REVIEW",
      accountingEntriesCreated: 0
    };
  }
}
