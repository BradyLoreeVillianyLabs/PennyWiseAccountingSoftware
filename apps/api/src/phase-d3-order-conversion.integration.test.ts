import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import {
  normalizeWooOrder,
  privacySafeCommercePayload
} from "./services/connectors/commerce-normalization.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const app = buildApp({ prisma });
const owner = "phase-d3-order-owner@example.test";

function headers(organizationId?: string, idempotencyKey?: string) {
  return {
    "x-clearledger-user-email": owner,
    "x-clearledger-user-name": "D3 Order Owner",
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {}),
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
  };
}

async function createOrganization() {
  const response = await app.inject({
    method: "POST",
    url: "/v1/organizations",
    headers: headers(),
    payload: { legalName: "D3 Commerce Ltd", displayName: "D3 Commerce" }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ organization: { id: string } }>().organization.id;
}

async function configureOrganization(organizationId: string) {
  const state = await app.inject({
    method: "GET",
    url: "/v1/setup",
    headers: headers(organizationId)
  });
  const version = state.json<{ setup: { settings: { version: number } } }>().setup.settings.version;
  const profile = await app.inject({
    method: "PATCH",
    url: "/v1/setup/profile",
    headers: headers(organizationId),
    payload: {
      version,
      legalName: "D3 Commerce Ltd",
      displayName: "D3 Commerce",
      locale: "en-CA",
      timeZone: "America/Edmonton",
      baseCurrency: "CAD",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      accountingStartDate: "2026-01-01"
    }
  });
  expect(profile.statusCode, profile.body).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/presets/general-service/apply",
        headers: headers(organizationId, randomUUID()),
        payload: {}
      })
    ).statusCode
  ).toBe(201);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/v1/setup/fiscal-year/initialize",
        headers: headers(organizationId),
        payload: {}
      })
    ).statusCode
  ).toBe(200);
}

async function accountIds(organizationId: string) {
  const response = await app.inject({
    method: "GET",
    url: "/v1/accounts",
    headers: headers(organizationId)
  });
  expect(response.statusCode, response.body).toBe(200);
  const accounts = response.json<{
    accounts: Array<{ id: string; systemPurpose: string | null; type: string }>;
  }>().accounts;
  return {
    revenue: accounts.find((account) => account.systemPurpose === "professional-services")!.id,
    taxPayable: accounts.find((account) => account.systemPurpose === "tax-payable")!.id
  };
}

async function createTaxCode(organizationId: string, payableAccountId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/setup/tax-codes/versions",
    headers: headers(organizationId),
    payload: {
      code: "D3GST",
      name: "D3 GST",
      treatment: "STANDARD",
      calculationMode: "EXCLUSIVE",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      sourceName: "D3 reviewed fixture",
      sourceRetrievedAt: "2026-01-01T00:00:00.000Z",
      components: [
        {
          name: "GST",
          jurisdiction: "CA",
          rate: "0.050000",
          recoverablePercent: "1.000000",
          payableAccountId,
          recoverableAccountId: null
        }
      ]
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ taxCodeVersion: { taxCodeId: string } }>().taxCodeVersion.taxCodeId;
}

async function createCustomer(organizationId: string) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: headers(organizationId),
    payload: {
      customerNumber: "D3-CUSTOMER",
      displayName: "D3 Marketplace Customer",
      email: "d3-customer@example.test",
      defaultPaymentTermsDays: 30,
      defaultCurrency: "CAD"
    }
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ customer: { id: string } }>().customer.id;
}

async function createInventoryFixture(organizationId: string, revenue: string) {
  const accountInputs = [
    ["D31400", "ASSET"],
    ["D31410", "ASSET"],
    ["D35000", "EXPENSE"],
    ["D35100", "EXPENSE"],
    ["D34900", "REVENUE"],
    ["D34910", "REVENUE"]
  ] as const;
  const created = await Promise.all(
    accountInputs.map(async ([code, type]) => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/accounts",
        headers: headers(organizationId),
        payload: { code, name: code, type, isControl: false }
      });
      expect(response.statusCode, response.body).toBe(201);
      return response.json<{ account: { id: string } }>().account.id;
    })
  );
  const [asset, clearing, cogs, loss, gain] = created;
  const location = await app.inject({
    method: "POST",
    url: "/v1/inventory/locations",
    headers: headers(organizationId),
    payload: { code: "D3-MAIN", name: "D3 Main Warehouse", isDefault: true }
  });
  expect(location.statusCode, location.body).toBe(201);
  const locationId = location.json<{ location: { id: string } }>().location.id;
  const product = await app.inject({
    method: "POST",
    url: "/v1/products",
    headers: headers(organizationId),
    payload: {
      sku: "D3-WIDGET",
      name: "D3 Widget",
      itemType: "INVENTORY_PRODUCT",
      salesPriceMinor: "10000",
      purchaseCostMinor: "5000",
      incomeAccountId: revenue,
      inventoryAssetAccountId: asset,
      costOfGoodsSoldAccountId: cogs,
      purchaseClearingAccountId: clearing,
      adjustmentGainAccountId: gain,
      inventoryLossAccountId: loss,
      defaultLocationId: locationId,
      unitOfMeasure: "each"
    }
  });
  expect(product.statusCode, product.body).toBe(201);
  const productId = product.json<{ product: { id: string } }>().product.id;
  const opening = await app.inject({
    method: "POST",
    url: "/v1/inventory/adjustments",
    headers: headers(organizationId, randomUUID()),
    payload: {
      productItemId: productId,
      locationId,
      direction: "IN",
      quantity: "5",
      unitCostMinor: "5000",
      adjustmentKind: "OPENING",
      effectiveDate: "2026-02-01",
      reason: "D3 fixture stock count"
    }
  });
  expect(opening.statusCode, opening.body).toBe(201);
  return { productId, locationId };
}

async function createCommerceEvent(input: {
  organizationId: string;
  taxCodeId: string;
  customerId: string;
  productId: string;
  completeMapping: boolean;
  connectorId?: string;
  status?: string;
  modifiedAt?: string;
}) {
  let connectorId = input.connectorId;
  if (!connectorId) {
    const connector = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/connectors",
      headers: headers(input.organizationId),
      payload: {
        providerKey: "WOOCOMMERCE",
        displayName: "D3 WooCommerce Fixture",
        mapping: {
          customerStrategy: "POOLED",
          marketplaceCustomerId: input.customerId,
          taxMappings: { gst: input.taxCodeId },
          taxRemittanceMappings: { gst: "SELLER" },
          taxRemittanceResponsibility: "SELLER"
        }
      }
    });
    expect(connector.statusCode, connector.body).toBe(201);
    connectorId = connector.json<{ connector: { id: string } }>().connector.id;
  }
  const mapping = {
    customerStrategy: "POOLED",
    marketplaceCustomerId: input.customerId,
    taxMappings: { gst: input.taxCodeId },
    taxRemittanceMappings: { gst: "SELLER" },
    taxRemittanceResponsibility: "SELLER",
    ...(input.completeMapping ? { catalogProductMappings: { "1001": input.productId } } : {})
  };
  if (!input.connectorId) {
    await prisma.connectorInstallation.update({
      where: { id: connectorId },
      data: { mapping, mappingVersion: { increment: 1 } }
    });
  }
  const raw = {
    id: 9001,
    status: input.status ?? "processing",
    currency: "CAD",
    line_items: [
      {
        id: 1,
        product_id: 1001,
        variation_id: 0,
        sku: "D3-WIDGET",
        name: "D3 Widget",
        quantity: "2",
        subtotal: "200.00",
        total: "190.00",
        total_tax: "9.50"
      }
    ],
    tax_lines: [{ id: "gst", label: "GST", tax_total: "9.50" }],
    shipping_lines: [],
    fee_lines: [],
    coupon_lines: [{ code: "D3", discount: "10.00", discount_tax: "0.00" }],
    discount_total: "10.00",
    shipping_total: "0.00",
    total_tax: "9.50",
    total: "199.50",
    date_created_gmt: "2026-03-15T12:00:00Z",
    date_modified_gmt: input.modifiedAt ?? "2026-03-15T12:00:00Z"
  };
  const event = normalizeWooOrder(raw, "https://d3.example.test", mapping);
  const ingested = await app.inject({
    method: "POST",
    url: "/v1/organizations/current/commerce/inbox",
    headers: headers(input.organizationId),
    payload: {
      installationId: connectorId,
      providerKey: "WOOCOMMERCE",
      shopExternalId: event.shopExternalId,
      externalEventId: event.externalEventId,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      eventType: event.eventType,
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      sourceCurrency: event.sourceCurrency,
      paymentCurrency: event.paymentCurrency,
      rawPayload: privacySafeCommercePayload(raw),
      normalizedPayload: event.normalizedPayload,
      normalizationIssues: event.normalizationIssues,
      mappingVersion: 2
    }
  });
  expect(ingested.statusCode, ingested.body).toBe(201);
  return {
    connectorId,
    eventId: ingested.json<{ event: { id: string } }>().event.id
  };
}

async function approveEvent(organizationId: string, eventId: string) {
  const reviewed = await app.inject({
    method: "POST",
    url: `/v1/organizations/current/commerce/inbox/${eventId}/review`,
    headers: headers(organizationId),
    payload: { version: 1, status: "NORMALIZED", reviewNote: "D3 fixture evidence reviewed." }
  });
  expect(reviewed.statusCode, reviewed.body).toBe(200);
  return reviewed.json<{ event: { version: number } }>().event.version;
}

describe("D3 reviewed commerce orders become invoices", () => {
  beforeAll(async () => {
    await prisma.$connect();
    await app.ready();
  });

  beforeEach(async () => resetDatabase(prisma));

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("preflights exact totals, converts once under concurrency, posts inventory, and keeps revisions review-only", async () => {
    const organizationId = await createOrganization();
    await configureOrganization(organizationId);
    const accounts = await accountIds(organizationId);
    const taxCodeId = await createTaxCode(organizationId, accounts.taxPayable);
    const customerId = await createCustomer(organizationId);
    const inventory = await createInventoryFixture(organizationId, accounts.revenue);
    const first = await createCommerceEvent({
      organizationId,
      taxCodeId,
      customerId,
      productId: inventory.productId,
      completeMapping: true
    });
    const version = await approveEvent(organizationId, first.eventId);
    const preflight = await app.inject({
      method: "GET",
      url: `/v1/organizations/current/commerce/inbox/${first.eventId}/conversion-preflight`,
      headers: headers(organizationId)
    });
    expect(preflight.statusCode, preflight.body).toBe(200);
    expect(
      preflight.json<{
        conversion: { ready: boolean; draft: { grandTotalMinor: string; taxTotalMinor: string } };
      }>().conversion
    ).toMatchObject({
      ready: true,
      draft: { grandTotalMinor: "19950", taxTotalMinor: "950" }
    });

    const attempts = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/v1/organizations/current/commerce/inbox/${first.eventId}/convert`,
          headers: headers(organizationId),
          payload: { decision: "CONFIRM", version, fxRateSnapshotId: undefined }
        })
      )
    );
    expect(attempts.map((response) => response.statusCode).sort()).toEqual([200, 201]);
    const invoices = await prisma.invoice.findMany({ where: { organizationId } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      status: "DRAFT",
      grandTotalMinor: 19950n,
      taxTotalMinor: 950n
    });
    const invoiceId = invoices[0]!.id;
    const linked = await prisma.commerceInboxEvent.findUniqueOrThrow({
      where: { id: first.eventId }
    });
    expect(linked.resultingInvoiceId).toBe(invoiceId);
    expect(linked.conversionStatus).toBe("CONVERTED");

    const posted = await app.inject({
      method: "POST",
      url: `/v1/invoices/${invoiceId}/post`,
      headers: headers(organizationId, randomUUID()),
      payload: { version: invoices[0]!.version, effectiveDate: "2026-03-15" }
    });
    expect(posted.statusCode, posted.body).toBe(201);
    const postedInvoice = posted.json<{ invoice: { status: string; journalId: string } }>().invoice;
    expect(postedInvoice.status).toBe("POSTED");
    const journal = await prisma.journal.findUniqueOrThrow({
      where: { id: postedInvoice.journalId },
      include: { lines: true }
    });
    expect(journal.lines.reduce((sum, line) => sum + line.debitMinor, 0n)).toBe(
      journal.lines.reduce((sum, line) => sum + line.creditMinor, 0n)
    );
    expect(
      (
        await prisma.inventoryMovement.findMany({
          where: { invoiceLine: { is: { invoiceId } }, movementType: "SALE" }
        })
      ).map((movement) => movement.quantityMicros)
    ).toEqual([-2_000_000n]);
    expect(
      (await prisma.commerceInboxEvent.findUniqueOrThrow({ where: { id: first.eventId } }))
        .conversionStatus
    ).toBe("POSTED");

    const revision = await createCommerceEvent({
      organizationId,
      taxCodeId,
      customerId,
      productId: inventory.productId,
      completeMapping: true,
      connectorId: first.connectorId,
      status: "cancelled",
      modifiedAt: "2026-03-20T12:00:00Z"
    });
    const revisionVersion = await approveEvent(organizationId, revision.eventId);
    const revisionPreflight = await app.inject({
      method: "GET",
      url: `/v1/organizations/current/commerce/inbox/${revision.eventId}/conversion-preflight`,
      headers: headers(organizationId)
    });
    expect(revisionPreflight.statusCode).toBe(200);
    const revisionConversion = revisionPreflight.json<{
      conversion: { ready: boolean; gaps: Array<{ code: string }> };
    }>().conversion;
    expect(revisionConversion.ready).toBe(false);
    expect(revisionConversion.gaps.map((gap) => gap.code)).toContain(
      "ORDER_REVISION_REVIEW_REQUIRED"
    );
    const refused = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/commerce/inbox/${revision.eventId}/convert`,
      headers: headers(organizationId),
      payload: { decision: "CONFIRM", version: revisionVersion }
    });
    expect(refused.statusCode).toBe(422);
    expect(await prisma.invoice.count({ where: { organizationId } })).toBe(1);
  });

  it("refuses an unmapped order with named gaps and creates no invoice", async () => {
    const organizationId = await createOrganization();
    await configureOrganization(organizationId);
    const accounts = await accountIds(organizationId);
    const taxCodeId = await createTaxCode(organizationId, accounts.taxPayable);
    const customerId = await createCustomer(organizationId);
    const inventory = await createInventoryFixture(organizationId, accounts.revenue);
    const event = await createCommerceEvent({
      organizationId,
      taxCodeId,
      customerId,
      productId: inventory.productId,
      completeMapping: false
    });
    const preflight = await app.inject({
      method: "GET",
      url: `/v1/organizations/current/commerce/inbox/${event.eventId}/conversion-preflight`,
      headers: headers(organizationId)
    });
    expect(preflight.statusCode).toBe(200);
    const body = preflight.json<{ conversion: { ready: boolean; gaps: Array<{ code: string }> } }>()
      .conversion;
    expect(body.ready).toBe(false);
    expect(body.gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "NORMALIZATION_BLOCKING" })])
    );
    const rejectedEvent = await createCommerceEvent({
      organizationId,
      taxCodeId,
      customerId,
      productId: inventory.productId,
      completeMapping: true
    });
    const version = await approveEvent(organizationId, rejectedEvent.eventId);
    const rejected = await app.inject({
      method: "POST",
      url: `/v1/organizations/current/commerce/inbox/${rejectedEvent.eventId}/convert`,
      headers: headers(organizationId),
      payload: {
        decision: "REJECT",
        version,
        reason: "The catalog match needs owner confirmation before this order is booked."
      }
    });
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(
      (await prisma.commerceInboxEvent.findUniqueOrThrow({ where: { id: rejectedEvent.eventId } }))
        .conversionStatus
    ).toBe("REJECTED");
    expect(await prisma.invoice.count({ where: { organizationId } })).toBe(0);
  });

  it("returns independent results from batch conversion", async () => {
    const organizationId = await createOrganization();
    await configureOrganization(organizationId);
    const accounts = await accountIds(organizationId);
    const taxCodeId = await createTaxCode(organizationId, accounts.taxPayable);
    const customerId = await createCustomer(organizationId);
    const inventory = await createInventoryFixture(organizationId, accounts.revenue);
    const ready = await createCommerceEvent({
      organizationId,
      taxCodeId,
      customerId,
      productId: inventory.productId,
      completeMapping: true
    });
    const blocked = await createCommerceEvent({
      organizationId,
      taxCodeId,
      customerId,
      productId: inventory.productId,
      completeMapping: false
    });
    const readyVersion = await approveEvent(organizationId, ready.eventId);
    const blockedVersion = 1;
    const response = await app.inject({
      method: "POST",
      url: "/v1/organizations/current/commerce/inbox/batch-convert",
      headers: headers(organizationId),
      payload: {
        items: [
          { eventId: ready.eventId, decision: "CONFIRM", version: readyVersion },
          { eventId: blocked.eventId, decision: "CONFIRM", version: blockedVersion }
        ]
      }
    });
    expect(response.statusCode, response.body).toBe(200);
    const results = response.json<{
      results: Array<{
        eventId: string;
        conversion: { conversionStatus: string; gaps?: Array<{ code: string }> };
      }>;
    }>().results;
    expect(results).toHaveLength(2);
    expect(
      results.find((item) => item.eventId === ready.eventId)?.conversion.conversionStatus
    ).toBe("CONVERTED");
    expect(
      results
        .find((item) => item.eventId === blocked.eventId)
        ?.conversion.gaps?.map((gap) => gap.code)
    ).toContain("NORMALIZATION_BLOCKING");
    expect(await prisma.invoice.count({ where: { organizationId } })).toBe(1);
  });
});
