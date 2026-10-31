import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import type {
  CommerceConnectorAdapter,
  CommerceSyncRequest
} from "./services/connectors/commerce-connector-types.js";
import {
  normalizeEtsyLedgerEntry,
  normalizeEtsyReceipt,
  normalizeWooOrder
} from "./services/connectors/commerce-normalization.js";
import { AesPaymentAccountProtector } from "./services/payment-provider.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const providerOrder = {
  id: 8001,
  status: "processing",
  currency: "USD",
  total: "112.00",
  discount_total: "0.00",
  shipping_total: "10.00",
  total_tax: "2.00",
  transaction_id: "payment-8001",
  payment_method: "stripe",
  date_created_gmt: "2026-07-10T12:00:00.000Z",
  date_modified_gmt: "2026-07-10T12:05:00.000Z",
  date_paid_gmt: "2026-07-10T12:01:00.000Z",
  line_items: [
    {
      id: 1,
      product_id: 101,
      sku: "SKU-1",
      name: "Fixture product",
      quantity: 1,
      subtotal: "100.00",
      total: "100.00",
      total_tax: "2.00"
    }
  ],
  shipping_lines: [{ id: 2, method_title: "Shipping", total: "10.00", total_tax: "0.00" }],
  tax_lines: [{ id: 3, label: "Tax", tax_total: "2.00" }],
  fee_lines: [],
  coupon_lines: [],
  refunds: []
};

let verifyWebhookCalls = 0;
const etsySyncRequests: CommerceSyncRequest[] = [];

const adapter: CommerceConnectorAdapter = {
  providerKey: "WOOCOMMERCE",
  validateCredentials(credentials) {
    const shop = credentialString(credentials, "shop");
    if (!shop) throw new Error("shop is required");
    return Promise.resolve({
      externalAccountId: shop,
      displayName: `Fixture ${shop}`,
      credentials: { shop, token: credentialString(credentials, "token") }
    });
  },
  checkHealth() {
    return Promise.resolve({ healthStatus: "HEALTHY" });
  },
  syncPage(credentials, request: CommerceSyncRequest) {
    return Promise.resolve({
      events: [
        normalizeWooOrder(providerOrder, credentialString(credentials, "shop"), request.mapping)
      ],
      nextCursor: null,
      hasMore: false
    });
  },
  catalogPage() {
    return Promise.resolve({ products: [], nextCursor: null, hasMore: false });
  },
  updateInventory(_credentials, request) {
    return Promise.resolve({
      externalOperationId: `fixture:${request.externalVariantId}`,
      observedQuantityMicros: request.quantityMicros
    });
  },
  verifyWebhook(credentials, input) {
    verifyWebhookCalls += 1;
    return {
      events: [
        normalizeWooOrder(
          { ...providerOrder, id: 8002, date_modified_gmt: "2026-07-10T13:05:00.000Z" },
          credentialString(credentials, "shop"),
          input.mapping
        )
      ]
    };
  }
};

const etsyPagingAdapter: CommerceConnectorAdapter = {
  providerKey: "ETSY",
  validateCredentials(credentials) {
    const shop = credentialString(credentials, "shop");
    if (!shop) throw new Error("shop is required");
    return Promise.resolve({
      externalAccountId: shop,
      displayName: `Fixture ${shop}`,
      credentials: { shop }
    });
  },
  checkHealth() {
    return Promise.resolve({ healthStatus: "HEALTHY" });
  },
  syncPage(credentials, request) {
    etsySyncRequests.push(request);
    const shop = credentialString(credentials, "shop");
    const page =
      typeof request.cursor?.page === "number" && Number.isInteger(request.cursor.page)
        ? request.cursor.page
        : 1;
    const hasMore = request.scope === "ORDERS" && page === 1;
    const money = { amount: 1000, divisor: 100, currency_code: "USD" };
    const event =
      request.scope === "ORDERS"
        ? normalizeEtsyReceipt(
            {
              receipt_id: 9100 + page,
              grandtotal: money,
              subtotal: money,
              total_shipping_cost: { ...money, amount: 0 },
              discount_amt: { ...money, amount: 0 },
              created_timestamp: `2026-07-0${String(page)}T12:00:00.000Z`,
              updated_timestamp: `2026-07-0${String(page)}T12:05:00.000Z`,
              is_paid: true,
              transactions: [
                {
                  transaction_id: 9200 + page,
                  sku: ["SKU-1"],
                  title: `Fixture item page ${String(page)}`,
                  quantity: 1,
                  price: money
                }
              ]
            },
            shop,
            request.mapping
          )
        : normalizeEtsyLedgerEntry(
            {
              ledger_entry_id: 9301,
              amount: { amount: -250, divisor: 100, currency_code: "USD" },
              created_timestamp: "2026-07-02T14:00:00.000Z",
              ledger_type: "fee"
            },
            shop
          );
    return Promise.resolve({
      events: [event],
      nextCursor: hasMore ? { page: page + 1 } : null,
      hasMore
    });
  },
  catalogPage() {
    return Promise.resolve({ products: [], nextCursor: null, hasMore: false });
  },
  updateInventory(_credentials, request) {
    return Promise.resolve({
      externalOperationId: `fixture:${request.externalVariantId}`,
      observedQuantityMicros: request.quantityMicros
    });
  },
  verifyWebhook(credentials, input) {
    const shop = credentialString(credentials, "shop");
    const event = normalizeEtsyReceipt(
      {
        receipt_id: 9101,
        grandtotal: { amount: 1000, divisor: 100, currency_code: "USD" },
        subtotal: { amount: 1000, divisor: 100, currency_code: "USD" },
        total_shipping_cost: { amount: 0, divisor: 100, currency_code: "USD" },
        discount_amt: { amount: 0, divisor: 100, currency_code: "USD" },
        created_timestamp: "2026-07-01T12:00:00.000Z",
        updated_timestamp: "2026-07-01T12:05:00.000Z",
        is_paid: true,
        transactions: [
          {
            transaction_id: 9201,
            sku: ["SKU-1"],
            title: "Fixture item page 1",
            quantity: 1,
            price: { amount: 1000, divisor: 100, currency_code: "USD" }
          }
        ]
      },
      shop,
      input.mapping
    );
    return {
      events: [
        {
          ...event,
          rawPayload: {
            webhook: { event_type: "order.paid" },
            receipt: event.rawPayload
          }
        }
      ]
    };
  }
};

function credentialString(credentials: Readonly<Record<string, unknown>>, key: string): string {
  const value = credentials[key];
  return typeof value === "string" ? value : "";
}

const app = buildApp({
  prisma,
  connectorAdapters: [adapter, etsyPagingAdapter],
  connectorCredentialProtector: new AesPaymentAccountProtector(
    "native-commerce-integration-encryption-secret"
  )
});
const owner = "native-commerce-owner@example.test";
const headers = (organizationId?: string) => ({
  "x-clearledger-user-email": owner,
  "x-clearledger-user-name": "Native Commerce Owner",
  ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
});

const accountingCounts = async (organizationId: string) => {
  const [journals, invoices, payments, inventoryMovements] = await Promise.all([
    prisma.journal.count({ where: { organizationId } }),
    prisma.invoice.count({ where: { organizationId } }),
    prisma.payment.count({ where: { organizationId } }),
    prisma.inventoryMovement.count({ where: { organizationId } })
  ]);
  return { journals, invoices, payments, inventoryMovements };
};

describe("native commerce connector boundary", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });
  beforeEach(async () => {
    verifyWebhookCalls = 0;
    etsySyncRequests.length = 0;
    await resetDatabase(prisma);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("stages one deterministic review-only demo event without changing accounting", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Commerce Demo Ltd", displayName: "Commerce Demo" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const emptyAccounting = {
      journals: 0,
      invoices: 0,
      payments: 0,
      inventoryMovements: 0
    };
    expect(await accountingCounts(organizationId)).toEqual(emptyAccounting);

    const firstResponse = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/demo",
      headers: headers(organizationId),
      payload: {}
    });
    expect(firstResponse.statusCode, firstResponse.body).toBe(201);
    const first = firstResponse.json<{
      demo: {
        connector: {
          id: string;
          displayName: string;
          providerKey: string;
          status: string;
          credentialVersion: number;
        };
        event: {
          id: string;
          externalEventId: string;
          eventVersion: string;
          providerKey: string;
          shopExternalId: string;
          resourceType: string;
          resourceId: string;
          eventType: string;
          status: string;
          sourceCurrency: string;
          paymentCurrency: string;
          settlementCurrency: null;
          rawPayloadHash: string;
          normalizedPayload: unknown;
          normalizationIssues: unknown[];
          mappingVersion: number;
          version: number;
          createdAt: string;
        };
        replayed: boolean;
        candidateSuggestions: {
          evaluatedVariantIds: string[];
          deferredVariantIds: string[];
          candidateCount: number;
        };
        postingMode: string;
        accountingEntriesCreated: number;
      };
    }>().demo;
    expect(first).toMatchObject({
      connector: {
        displayName: "Sample Woo store (review only)",
        providerKey: "WOOCOMMERCE",
        status: "DRAFT",
        credentialVersion: 0
      },
      event: {
        externalEventId: "poll:order:1001:2026-07-15T16:05:00.000Z",
        eventVersion: "2026-07-15T16:05:00.000Z",
        providerKey: "WOOCOMMERCE",
        shopExternalId: "sample-store.example",
        resourceType: "ORDER",
        resourceId: "1001",
        eventType: "order.processing",
        status: "REVIEW_REQUIRED",
        sourceCurrency: "USD",
        paymentCurrency: "USD",
        settlementCurrency: null,
        mappingVersion: 1,
        version: 1
      },
      replayed: false,
      candidateSuggestions: {
        evaluatedVariantIds: [expect.any(String)],
        deferredVariantIds: [],
        candidateCount: 0
      },
      postingMode: "SHADOW_REVIEW",
      accountingEntriesCreated: 0
    });
    expect(first.event.rawPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.event.normalizedPayload).toMatchObject({
      schemaVersion: 1,
      provider: "WOOCOMMERCE",
      transactionKind: "ORDER",
      externalId: "1001",
      status: "processing",
      currencies: { source: "USD", payment: "USD", settlement: null },
      mapping: {
        customerStrategy: "POOLED",
        itemStatus: "REVIEW_REQUIRED",
        taxStatus: "MAPPED",
        taxRemittanceResponsibility: "SELLER"
      },
      reconciliation: { balanced: true }
    });
    expect(
      (first.event.normalizationIssues as Array<{ code: string; severity: string }>).map(
        ({ code, severity }) => ({ code, severity })
      )
    ).toContainEqual({ code: "ITEM_MAPPING_REQUIRED", severity: "BLOCKING" });
    expect(
      (
        first.event.normalizedPayload as {
          issues: Array<{ code: string; severity: string }>;
        }
      ).issues.map(({ code, severity }) => ({ code, severity }))
    ).toContainEqual({ code: "ITEM_MAPPING_REQUIRED", severity: "BLOCKING" });
    expect(firstResponse.body).not.toContain("credentialCiphertext");
    expect(await accountingCounts(organizationId)).toEqual(emptyAccounting);

    const replayResponse = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/demo",
      headers: headers(organizationId),
      payload: {}
    });
    expect(replayResponse.statusCode, replayResponse.body).toBe(201);
    const replay = replayResponse.json<{
      demo: {
        connector: { id: string };
        event: {
          id: string;
          externalEventId: string;
          rawPayloadHash: string;
          createdAt: string;
          version: number;
          status: string;
        };
        replayed: boolean;
        postingMode: string;
        accountingEntriesCreated: number;
      };
    }>().demo;
    expect(replay).toMatchObject({
      connector: { id: first.connector.id },
      event: {
        id: first.event.id,
        externalEventId: first.event.externalEventId,
        rawPayloadHash: first.event.rawPayloadHash,
        createdAt: first.event.createdAt,
        version: 1,
        status: "REVIEW_REQUIRED"
      },
      replayed: true,
      postingMode: "SHADOW_REVIEW",
      accountingEntriesCreated: 0
    });
    expect(await prisma.connectorInstallation.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.commerceInboxEvent.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.externalCatalogProduct.count({ where: { organizationId } })).toBe(1);
    expect(await prisma.externalCatalogVariant.count({ where: { organizationId } })).toBe(1);
    expect(await accountingCounts(organizationId)).toEqual(emptyAccounting);
  });

  it("preserves an Etsy backfill window and resumes every requested scope before advancing sync time", async () => {
    const backfillStart = "2026-07-01T00:00:00.000Z";
    const backfillEnd = "2026-07-03T00:00:00.000Z";
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Paged Etsy Ltd", displayName: "Paged Etsy" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;
    const draftResponse = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(organizationId),
      payload: { providerKey: "ETSY", displayName: "Paged Etsy fixture", mapping: {} }
    });
    expect(draftResponse.statusCode, draftResponse.body).toBe(201);
    const connectorId = draftResponse.json<{ connector: { id: string } }>().connector.id;
    const connected = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${connectorId}/connect`,
      headers: headers(organizationId),
      payload: {
        credentials: { shop: "paged-etsy.example" },
        backfillStartAt: backfillStart,
        backfillEndAt: backfillEnd
      }
    });
    expect(connected.statusCode, connected.body).toBe(200);

    for (const outsideRange of [
      { from: "2026-06-30T23:59:59.000Z", to: backfillEnd },
      { from: backfillStart, to: "2026-07-03T00:00:01.000Z" }
    ]) {
      const rejected = await app.inject({
        method: "POST",
        url: `/v1/organizations/current/connectors/${connectorId}/sync`,
        headers: headers(organizationId),
        payload: { ...outsideRange, maxPages: 1, pageSize: 1, scope: "ALL" }
      });
      expect(rejected.statusCode, rejected.body).toBe(422);
      expect(rejected.json<{ error: { code: string } }>().error.code).toBe(
        "CONNECTOR_SYNC_OUTSIDE_CONSENT"
      );
    }
    expect(etsySyncRequests).toHaveLength(0);

    const firstResponse = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${connectorId}/sync`,
      headers: headers(organizationId),
      payload: { maxPages: 1, pageSize: 1, scope: "ALL" }
    });
    expect(firstResponse.statusCode, firstResponse.body).toBe(200);
    const first = firstResponse.json<{
      sync: {
        complete: boolean;
        hasMore: boolean;
        pages: number;
        window: { from: string; to: string };
        continuation: {
          token: string;
          remainingScopes: string[];
          pageSize: number;
          window: { from: string; to: string };
        };
      };
    }>().sync;
    expect(first).toMatchObject({
      complete: false,
      hasMore: true,
      pages: 1,
      window: { from: backfillStart, to: backfillEnd },
      continuation: {
        remainingScopes: ["ORDERS", "SETTLEMENTS"],
        pageSize: 1,
        window: { from: backfillStart, to: backfillEnd }
      }
    });
    expect(first.continuation.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(etsySyncRequests).toHaveLength(1);
    expect(etsySyncRequests[0]).toMatchObject({
      from: new Date(backfillStart),
      to: new Date(backfillEnd),
      cursor: null,
      pageSize: 1,
      scope: "ORDERS"
    });
    expect(
      (await prisma.connectorInstallation.findUniqueOrThrow({ where: { id: connectorId } }))
        .lastSyncAt
    ).toBeNull();

    const secondResponse = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${connectorId}/sync`,
      headers: headers(organizationId),
      payload: { continuationToken: first.continuation.token, maxPages: 1 }
    });
    expect(secondResponse.statusCode, secondResponse.body).toBe(200);
    const second = secondResponse.json<{
      sync: {
        complete: boolean;
        pages: number;
        continuation: { token: string; remainingScopes: string[] };
      };
    }>().sync;
    expect(second).toMatchObject({
      complete: false,
      pages: 1,
      continuation: {
        token: first.continuation.token,
        remainingScopes: ["SETTLEMENTS"]
      }
    });
    expect(etsySyncRequests).toHaveLength(2);
    expect(etsySyncRequests[1]).toMatchObject({
      from: new Date(backfillStart),
      to: new Date(backfillEnd),
      cursor: { page: 2 },
      pageSize: 1,
      scope: "ORDERS"
    });
    expect(
      (await prisma.connectorInstallation.findUniqueOrThrow({ where: { id: connectorId } }))
        .lastSyncAt
    ).toBeNull();

    const finalResponse = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${connectorId}/sync`,
      headers: headers(organizationId),
      payload: { continuationToken: first.continuation.token, maxPages: 1 }
    });
    expect(finalResponse.statusCode, finalResponse.body).toBe(200);
    expect(
      finalResponse.json<{
        sync: { complete: boolean; hasMore: boolean; pages: number; continuation: null };
      }>().sync
    ).toMatchObject({ complete: true, hasMore: false, pages: 1, continuation: null });
    expect(etsySyncRequests).toHaveLength(3);
    expect(etsySyncRequests[2]).toMatchObject({
      from: new Date(backfillStart),
      to: new Date(backfillEnd),
      cursor: null,
      pageSize: 1,
      scope: "SETTLEMENTS"
    });

    const installation = await prisma.connectorInstallation.findUniqueOrThrow({
      where: { id: connectorId }
    });
    expect(installation.lastSyncAt?.toISOString()).toBe(backfillEnd);
    expect(installation.syncLeaseTokenHash).toBeNull();
    expect(await prisma.commerceInboxEvent.count({ where: { organizationId } })).toBe(3);
    expect(await accountingCounts(organizationId)).toEqual({
      journals: 0,
      invoices: 0,
      payments: 0,
      inventoryMovements: 0
    });
    const planCheckpoint = await prisma.connectorCheckpoint.findUniqueOrThrow({
      where: {
        installationId_scope: { installationId: connectorId, scope: "commerce:sync-plan" }
      }
    });
    expect(planCheckpoint.checkpoint).toMatchObject({
      runId: first.continuation.token,
      windowStart: backfillStart,
      windowEnd: backfillEnd,
      complete: true,
      remainingScopes: []
    });

    const staleContinuation = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${connectorId}/sync`,
      headers: headers(organizationId),
      payload: { continuationToken: first.continuation.token, maxPages: 1 }
    });
    expect(staleContinuation.statusCode, staleContinuation.body).toBe(409);
    expect(staleContinuation.json<{ error: { code: string } }>().error.code).toBe(
      "CONNECTOR_SYNC_CONTINUATION_INVALID"
    );
    expect(
      (await prisma.connectorInstallation.findUniqueOrThrow({ where: { id: connectorId } }))
        .syncLeaseTokenHash
    ).toBeNull();

    const etsyWebhook = await app.inject({
      method: "POST",
      url: `/v1/webhooks/commerce/etsy/${connectorId}`,
      headers: { "content-type": "application/json", "webhook-id": "etsy-fixture-delivery-1" },
      payload: { fixture: true }
    });
    expect(etsyWebhook.statusCode, etsyWebhook.body).toBe(200);
    expect(
      etsyWebhook.json<{ imported: number; replayed: number; conflicts: number }>()
    ).toMatchObject({
      imported: 0,
      replayed: 1,
      conflicts: 0
    });
    expect(await prisma.commerceInboxEvent.count({ where: { organizationId } })).toBe(3);
    const etsyReplay = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId, action: "COMMERCE_INBOX_REPLAYED" }
    });
    expect(etsyReplay.metadata).toMatchObject({
      providerKey: "ETSY",
      installationId: connectorId,
      externalEventId: "poll:receipt:9101:2026-07-01T12:05:00.000Z",
      ingestionSource: "VERIFIED_PROVIDER_WEBHOOK",
      providerDeliveryId: "etsy-fixture-delivery-1"
    });
  });

  it("supports multiple stores, re-normalizes after mappings, and never posts accounting", async () => {
    const organization = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: headers(),
      payload: { legalName: "Commerce Fixture Ltd", displayName: "Commerce Fixture" }
    });
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;

    const createAndConnect = async (shop: string) => {
      const draft = await app.inject({
        method: "POST",
        url: "/v1/organizations/current/connectors",
        headers: headers(organizationId),
        payload: { providerKey: "WOOCOMMERCE", displayName: shop, mapping: {} }
      });
      expect(draft.statusCode, draft.body).toBe(201);
      const connector = draft.json<{ connector: { id: string } }>().connector;
      const connected = await app.inject({
        method: "POST",
        url: `/v1/organizations/current/connectors/${connector.id}/connect`,
        headers: headers(organizationId),
        payload: {
          credentials: { shop, token: "not-returned" },
          backfillStartAt: "2026-07-01T00:00:00.000Z",
          backfillEndAt: "2026-07-15T00:00:00.000Z"
        }
      });
      expect(connected.statusCode, connected.body).toBe(200);
      expect(JSON.stringify(connected.json())).not.toContain("not-returned");
      return connected.json<{
        connector: { id: string; externalAccountId: string; mappingVersion: number };
      }>().connector;
    };

    const first = await createAndConnect("store-one.example");
    const second = await createAndConnect("store-two.example");
    expect(first.externalAccountId).toBe("store-one.example");
    expect(second.externalAccountId).toBe("store-two.example");
    expect(await prisma.connectorInstallation.count({ where: { organizationId } })).toBe(2);

    const duplicateDraft = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(organizationId),
      payload: { providerKey: "WOOCOMMERCE", displayName: "Duplicate", mapping: {} }
    });
    const duplicateId = duplicateDraft.json<{ connector: { id: string } }>().connector.id;
    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${duplicateId}/connect`,
      headers: headers(organizationId),
      payload: { credentials: { shop: "store-one.example", token: "duplicate" } }
    });
    expect(duplicate.statusCode, duplicate.body).toBe(409);
    expect(duplicate.json<{ error: { code: string } }>().error.code).toBe(
      "CONNECTOR_ACCOUNT_ALREADY_CONNECTED"
    );

    const firstSync = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${first.id}/sync`,
      headers: headers(organizationId),
      payload: {
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-15T00:00:00.000Z",
        maxPages: 1,
        pageSize: 50,
        scope: "ORDERS"
      }
    });
    expect(firstSync.statusCode, firstSync.body).toBe(200);
    expect(
      firstSync.json<{ sync: { imported: number; accountingEntriesCreated: number } }>().sync
    ).toMatchObject({ imported: 1, accountingEntriesCreated: 0 });
    const staged = await prisma.commerceInboxEvent.findFirstOrThrow({
      where: { organizationId, installationId: first.id }
    });
    expect(staged.status).toBe("REVIEW_REQUIRED");
    expect(
      (staged.normalizationIssues as Array<{ severity: string }>).some(
        (issue) => issue.severity === "BLOCKING"
      )
    ).toBe(true);

    const mapped = await app.inject({
      method: "PATCH",
      url: `/v1/organizations/current/connectors/${first.id}/mapping`,
      headers: headers(organizationId),
      payload: {
        version: first.mappingVersion,
        mapping: {
          customerStrategy: "POOLED",
          productMappings: { "101": "product-1" },
          taxMappings: { Tax: "tax-1" },
          taxRemittanceResponsibility: "SELLER"
        }
      }
    });
    expect(mapped.statusCode, mapped.body).toBe(200);

    const resync = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/connectors/${first.id}/sync`,
      headers: headers(organizationId),
      payload: {
        from: "2026-07-01T00:00:00.000Z",
        to: "2026-07-15T00:00:00.000Z",
        maxPages: 1,
        pageSize: 50,
        scope: "ORDERS"
      }
    });
    expect(resync.statusCode, resync.body).toBe(200);
    expect(resync.json<{ sync: { replayed: number } }>().sync.replayed).toBe(1);
    const renormalized = await prisma.commerceInboxEvent.findUniqueOrThrow({
      where: { id: staged.id }
    });
    expect(renormalized.mappingVersion).toBe(2);
    expect(renormalized.normalizationIssues).toEqual([]);

    const webhook = await app.inject({
      method: "POST",
      url: `/v1/webhooks/commerce/woocommerce/${first.id}`,
      headers: { "content-type": "application/json" },
      payload: { fixture: true }
    });
    expect(verifyWebhookCalls, webhook.body).toBeGreaterThan(0);
    expect(webhook.statusCode, webhook.body).toBe(200);
    expect(webhook.json<{ imported: number }>().imported).toBe(1);
    const webhookEvent = await prisma.commerceInboxEvent.findFirstOrThrow({
      where: { organizationId, resourceId: "8002" }
    });
    expect(webhookEvent.mappingVersion).toBe(2);
    expect(webhookEvent.normalizationIssues).toEqual([]);
    expect(webhookEvent.normalizedPayload).toMatchObject({
      mapping: {
        customerStrategy: "POOLED",
        itemStatus: "MAPPED",
        taxStatus: "MAPPED",
        taxRemittanceResponsibility: "SELLER"
      },
      issues: []
    });
    const webhookAudit = await prisma.auditEvent.findFirstOrThrow({
      where: {
        organizationId,
        action: "COMMERCE_INBOX_RECEIVED",
        targetId: webhookEvent.id
      }
    });
    expect(webhookAudit.actorUserId).toBeNull();
    expect(webhookAudit.metadata).toMatchObject({
      providerKey: "WOOCOMMERCE",
      installationId: first.id,
      externalEventId: webhookEvent.externalEventId,
      ingestionSource: "VERIFIED_PROVIDER_WEBHOOK"
    });

    expect(await prisma.journal.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.invoice.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.payment.count({ where: { organizationId } })).toBe(0);
    expect(await prisma.inventoryMovement.count({ where: { organizationId } })).toBe(0);
  });
});
