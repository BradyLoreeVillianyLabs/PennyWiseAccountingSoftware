import { randomUUID } from "node:crypto";
import { PrismaClient } from "@clearledger/db";
import { resetDatabase } from "@clearledger/db/test-utils";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { FixtureCarrier } from "./services/shipping/carrier-adapter.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL or DATABASE_URL is required.");

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const normalCarrier = new FixtureCarrier();
const timeoutCarrier = new FixtureCarrier({ mode: "TIMEOUT_AFTER_PERSIST" });
const normalApp = buildApp({ prisma, shippingAdapters: [normalCarrier] });
const timeoutApp = buildApp({ prisma, shippingAdapters: [timeoutCarrier] });
type TestApp = typeof normalApp;
type ShipmentLabelView = { readonly id: string };
type ShipmentView = {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly purchasedCostMinor: string | null;
  readonly purchasedCurrency: string | null;
  readonly shippingExpenseId: string | null;
  readonly trackingNumber: string | null;
  readonly labels: readonly ShipmentLabelView[];
  readonly trackingEvents: readonly unknown[];
  readonly voidAttempts: readonly unknown[];
  readonly inventoryMovementIds: readonly string[];
};

function headers(organizationId?: string) {
  return {
    "x-clearledger-user-email": "phase-d5-owner@example.test",
    "x-clearledger-user-name": "D5 Shipping Owner",
    ...(organizationId ? { "x-clearledger-organization-id": organizationId } : {})
  };
}

async function api(
  app: TestApp,
  method: "GET" | "POST" | "PATCH",
  url: string,
  organizationId?: string,
  payload?: InjectOptions["payload"],
  extraHeaders?: Record<string, string>
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: { ...headers(organizationId), ...extraHeaders },
    ...(payload === undefined ? {} : { payload })
  });
}

async function createAccount(
  app: TestApp,
  organizationId: string,
  code: string,
  type: "ASSET" | "EXPENSE" | "REVENUE"
) {
  const response = await api(app, "POST", "/v1/accounts", organizationId, {
    code,
    name: code,
    type,
    isControl: false
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ account: { id: string } }>().account.id;
}

async function createFixture(
  app: TestApp,
  suffix: string,
  options: { readonly crossBorderMissingCustoms?: boolean } = {}
) {
  const organizationResponse = await api(app, "POST", "/v1/organizations", undefined, {
    legalName: `D5 Shipping ${suffix} Ltd`,
    displayName: `D5 Shipping ${suffix}`
  });
  expect(organizationResponse.statusCode, organizationResponse.body).toBe(201);
  const organizationId = organizationResponse.json<{ organization: { id: string } }>().organization
    .id;

  const setupResponse = await api(app, "GET", "/v1/setup", organizationId);
  expect(setupResponse.statusCode, setupResponse.body).toBe(200);
  const setupVersion = setupResponse.json<{ setup: { settings: { version: number } } }>().setup
    .settings.version;
  const profile = await api(app, "PATCH", "/v1/setup/profile", organizationId, {
    version: setupVersion,
    legalName: `D5 Shipping ${suffix} Ltd`,
    displayName: `D5 Shipping ${suffix}`,
    businessAddress: {
      line1: "100 Warehouse Way",
      city: "Calgary",
      province: "AB",
      postalCode: "T2P 1J9",
      country: "CA"
    },
    locale: "en-CA",
    timeZone: "America/Edmonton",
    baseCurrency: "CAD",
    fiscalYearEndMonth: 12,
    fiscalYearEndDay: 31,
    accountingStartDate: "2026-01-01"
  });
  expect(profile.statusCode, profile.body).toBe(200);
  const preset = await api(
    app,
    "POST",
    "/v1/setup/presets/general-service/apply",
    organizationId,
    {},
    { "idempotency-key": randomUUID() }
  );
  expect(preset.statusCode, preset.body).toBe(201);
  const fiscalYear = await api(app, "POST", "/v1/setup/fiscal-year/initialize", organizationId, {});
  expect(fiscalYear.statusCode, fiscalYear.body).toBe(200);

  const [
    payingAccountId,
    expenseAccountId,
    incomeAccountId,
    inventoryAssetAccountId,
    cogsAccountId,
    clearingAccountId,
    gainAccountId,
    lossAccountId
  ] = await Promise.all([
    createAccount(app, organizationId, `${suffix}1400`, "ASSET"),
    createAccount(app, organizationId, `${suffix}5500`, "EXPENSE"),
    createAccount(app, organizationId, `${suffix}4100`, "REVENUE"),
    createAccount(app, organizationId, `${suffix}1410`, "ASSET"),
    createAccount(app, organizationId, `${suffix}5501`, "EXPENSE"),
    createAccount(app, organizationId, `${suffix}1411`, "ASSET"),
    createAccount(app, organizationId, `${suffix}4101`, "REVENUE"),
    createAccount(app, organizationId, `${suffix}5502`, "EXPENSE")
  ]);

  const inventory = !options.crossBorderMissingCustoms;
  let locationId: string | null = null;
  if (inventory) {
    const locationResponse = await api(app, "POST", "/v1/inventory/locations", organizationId, {
      code: `${suffix}-MAIN`,
      name: `${suffix} warehouse`,
      isDefault: true
    });
    expect(locationResponse.statusCode, locationResponse.body).toBe(201);
    locationId = locationResponse.json<{ location: { id: string } }>().location.id;
  }

  const productResponse = await api(app, "POST", "/v1/products", organizationId, {
    sku: `${suffix}-ITEM`,
    name: options.crossBorderMissingCustoms ? "Unclassified service" : "Shipping work shirt",
    itemType: inventory ? "INVENTORY_PRODUCT" : "SERVICE",
    salesPriceMinor: "2500",
    purchaseCostMinor: inventory ? "1000" : null,
    incomeAccountId,
    ...(inventory
      ? {
          inventoryAssetAccountId,
          costOfGoodsSoldAccountId: cogsAccountId,
          purchaseClearingAccountId: clearingAccountId,
          adjustmentGainAccountId: gainAccountId,
          inventoryLossAccountId: lossAccountId,
          defaultLocationId: locationId,
          hsTariffCode: "610910",
          countryOfOrigin: "CA"
        }
      : {})
  });
  expect(productResponse.statusCode, productResponse.body).toBe(201);
  const productId = productResponse.json<{ product: { id: string } }>().product.id;

  if (locationId) {
    const adjustment = await api(
      app,
      "POST",
      "/v1/inventory/adjustments",
      organizationId,
      {
        productItemId: productId,
        locationId,
        direction: "IN",
        quantity: "3",
        unitCostMinor: "1000",
        adjustmentKind: "OPENING",
        effectiveDate: "2026-02-01",
        reason: "D5 opening stock"
      },
      { "idempotency-key": randomUUID() }
    );
    expect(adjustment.statusCode, adjustment.body).toBe(201);
  }

  const customerResponse = await api(app, "POST", "/v1/customers", organizationId, {
    customerNumber: `${suffix}-CUSTOMER`,
    displayName: `${suffix} customer`,
    defaultCurrency: "CAD",
    addresses: [
      {
        role: "SHIPPING",
        recipientName: `${suffix} customer`,
        line1: "200 Customer Avenue",
        city: "Calgary",
        subdivisionCode: "CA-AB",
        postalCode: "T2P 1J9",
        countryCode: "CA",
        isDefault: true
      }
    ]
  });
  expect(customerResponse.statusCode, customerResponse.body).toBe(201);
  const customerId = customerResponse.json<{ customer: { id: string } }>().customer.id;
  const invoiceResponse = await api(app, "POST", "/v1/invoices", organizationId, {
    customerId,
    issueDate: "2026-02-02",
    currency: "CAD",
    lines: [{ productItemId: productId, quantity: "2" }]
  });
  expect(invoiceResponse.statusCode, invoiceResponse.body).toBe(201);
  const draft = invoiceResponse.json<{ invoice: { id: string; version: number } }>().invoice;
  const posted = await api(
    app,
    "POST",
    `/v1/invoices/${draft.id}/post`,
    organizationId,
    { version: draft.version, effectiveDate: "2026-02-02" },
    { "idempotency-key": randomUUID() }
  );
  expect(posted.statusCode, posted.body).toBe(201);

  return {
    organizationId,
    invoiceId: draft.id,
    payingAccountId,
    expenseAccountId,
    destinationAddress: {
      name: `${suffix} US customer`,
      line1: "1 Cross Border Road",
      city: "Seattle",
      subdivisionCode: "US-WA",
      postalCode: "98101",
      countryCode: "US"
    }
  };
}

async function createCarrierAccount(app: TestApp, organizationId: string) {
  const response = await api(app, "POST", "/v1/shipping/carrier-accounts", organizationId, {
    carrierKey: "FIXTURE",
    displayName: "Operator Fixture Carrier",
    environment: "TEST",
    credentials: { apiKey: "fixture-key" },
    defaultLabelFormat: "PDF",
    defaultLabelWidthMm: 101,
    defaultLabelHeightMm: 152
  });
  expect(response.statusCode, response.body).toBe(201);
  const account = response.json<{ carrierAccount: Record<string, unknown> }>().carrierAccount;
  expect(account.credentialsConfigured).toBe(true);
  expect(account).not.toHaveProperty("credentials");
  expect(account).not.toHaveProperty("credentialCiphertext");
  return account.id as string;
}

function parcel(customsLines?: unknown[]) {
  return {
    parcelNumber: 1,
    weightGrams: 1500,
    lengthMm: 300,
    widthMm: 200,
    heightMm: 100,
    packageType: "BOX",
    ...(customsLines === undefined ? {} : { customsLines })
  };
}

beforeAll(async () => {
  await prisma.$connect();
  await normalApp.ready();
  await timeoutApp.ready();
});

beforeEach(async () => resetDatabase(prisma));

afterAll(async () => {
  await timeoutApp.close();
  await normalApp.close();
  await prisma.$disconnect();
});

describe("D5 shipping labels", () => {
  it("quotes, explicitly purchases, prints, tracks, and voids with linked expense and inventory movement", async () => {
    const data = await createFixture(normalApp, "D5A");
    const carrierAccountId = await createCarrierAccount(normalApp, data.organizationId);
    const created = await api(
      normalApp,
      "POST",
      `/v1/invoices/${data.invoiceId}/shipment`,
      data.organizationId,
      {
        carrierAccountId,
        parcels: [parcel()]
      }
    );
    expect(created.statusCode, created.body).toBe(201);
    const draft = created.json<{ shipment: { id: string; version: number } }>().shipment;
    expect(draft.status).toBe("DRAFT");
    expect(draft.inventoryMovementIds).toHaveLength(1);

    const quoted = await api(
      normalApp,
      "POST",
      `/v1/shipments/${draft.id}/quote`,
      data.organizationId,
      { version: draft.version }
    );
    expect(quoted.statusCode, quoted.body).toBe(200);
    const quote = quoted.json<{
      shipment: {
        version: number;
        serviceCode: string;
        quotedCostMinor: string;
        quotedCurrency: string;
      };
    }>().shipment;
    expect(quote).toMatchObject({
      serviceCode: "FIXTURE-GROUND",
      quotedCostMinor: "1150",
      quotedCurrency: "CAD"
    });

    const purchased = await api(
      normalApp,
      "POST",
      `/v1/shipments/${draft.id}/purchase`,
      data.organizationId,
      {
        version: quote.version,
        confirmed: true,
        serviceCode: quote.serviceCode,
        quotedCostMinor: quote.quotedCostMinor,
        quotedCurrency: quote.quotedCurrency,
        expenseAccountId: data.expenseAccountId,
        payingAccountId: data.payingAccountId,
        expenseMethod: "CREDIT_CARD",
        expenseDate: "2026-02-02"
      }
    );
    expect(purchased.statusCode, purchased.body).toBe(200);
    const shipment = purchased.json<{ shipment: ShipmentView }>().shipment;
    expect(shipment).toMatchObject({
      status: "PURCHASED",
      purchasedCostMinor: "1150",
      purchasedCurrency: "CAD"
    });
    expect(shipment.shippingExpenseId).toEqual(expect.any(String));
    expect(shipment.trackingNumber).toEqual(expect.stringMatching(/^FIX-/));
    expect(shipment.labels).toHaveLength(1);

    const label = await api(
      normalApp,
      "GET",
      `/v1/shipment-labels/${shipment.labels[0].id}`,
      data.organizationId
    );
    expect(label.statusCode, label.body).toBe(200);
    expect(label.headers["content-type"]).toContain("application/pdf");
    expect(label.rawPayload.toString("utf8")).toContain("%PDF-1.4");

    const tracked = await api(
      normalApp,
      "POST",
      `/v1/shipments/${draft.id}/track`,
      data.organizationId
    );
    expect(tracked.statusCode, tracked.body).toBe(200);
    expect(
      tracked.json<{ shipment: { trackingEvents: unknown[] } }>().shipment.trackingEvents
    ).toHaveLength(2);
    const trackedShipment = tracked.json<{ shipment: { version: number } }>().shipment;
    const voided = await api(
      normalApp,
      "POST",
      `/v1/shipments/${draft.id}/void`,
      data.organizationId,
      { version: trackedShipment.version, reason: "D5 void drill" }
    );
    expect(voided.statusCode, voided.body).toBe(200);
    expect(
      voided.json<{ shipment: { status: string; voidAttempts: unknown[] } }>().shipment
    ).toMatchObject({
      status: "VOIDED",
      voidAttempts: [expect.objectContaining({ status: "ACCEPTED" })]
    });

    expect(
      await prisma.immediateExpense.count({ where: { organizationId: data.organizationId } })
    ).toBe(1);
    expect(
      await prisma.journal.count({ where: { organizationId: data.organizationId } })
    ).toBeGreaterThan(0);
    expect(
      await prisma.shipmentInventoryMovement.count({
        where: { organizationId: data.organizationId }
      })
    ).toBe(1);
    expect(
      await prisma.shipmentLabel.count({ where: { organizationId: data.organizationId } })
    ).toBe(1);
  });

  it("reconciles a timeout after provider persistence before retrying purchase", async () => {
    const data = await createFixture(timeoutApp, "D5B");
    const carrierAccountId = await createCarrierAccount(timeoutApp, data.organizationId);
    const created = await api(
      timeoutApp,
      "POST",
      `/v1/invoices/${data.invoiceId}/shipment`,
      data.organizationId,
      { carrierAccountId, parcels: [parcel()] }
    );
    const draft = created.json<{ shipment: { id: string; version: number } }>().shipment;
    const quoted = await api(
      timeoutApp,
      "POST",
      `/v1/shipments/${draft.id}/quote`,
      data.organizationId,
      { version: draft.version }
    );
    const quote = quoted.json<{
      shipment: {
        version: number;
        serviceCode: string;
        quotedCostMinor: string;
        quotedCurrency: string;
      };
    }>().shipment;
    const firstPurchase = await api(
      timeoutApp,
      "POST",
      `/v1/shipments/${draft.id}/purchase`,
      data.organizationId,
      {
        version: quote.version,
        confirmed: true,
        serviceCode: quote.serviceCode,
        quotedCostMinor: quote.quotedCostMinor,
        quotedCurrency: quote.quotedCurrency,
        expenseAccountId: data.expenseAccountId,
        payingAccountId: data.payingAccountId,
        expenseMethod: "CREDIT_CARD",
        expenseDate: "2026-02-02"
      }
    );
    expect(firstPurchase.statusCode, firstPurchase.body).toBe(409);
    expect(firstPurchase.json<{ error: { code: string } }>().error.code).toBe(
      "SHIPPING_PURCHASE_UNKNOWN"
    );
    const unknown = await api(timeoutApp, "GET", `/v1/shipments/${draft.id}`, data.organizationId);
    const unknownShipment = unknown.json<{
      shipment: { status: string; version: number; reconcileRequired: boolean };
    }>().shipment;
    expect(unknownShipment).toMatchObject({ status: "PURCHASE_UNKNOWN", reconcileRequired: true });

    const secondPurchase = await api(
      timeoutApp,
      "POST",
      `/v1/shipments/${draft.id}/purchase`,
      data.organizationId,
      {
        version: unknownShipment.version,
        confirmed: true,
        serviceCode: quote.serviceCode,
        quotedCostMinor: quote.quotedCostMinor,
        quotedCurrency: quote.quotedCurrency,
        expenseAccountId: data.expenseAccountId,
        payingAccountId: data.payingAccountId,
        expenseMethod: "CREDIT_CARD",
        expenseDate: "2026-02-02"
      }
    );
    expect(secondPurchase.statusCode, secondPurchase.body).toBe(200);
    expect(
      secondPurchase.json<{ shipment: { status: string; labels: unknown[] } }>().shipment
    ).toMatchObject({
      status: "PURCHASED",
      labels: [expect.anything()]
    });
    expect(timeoutCarrier.counters.buyLabel).toBe(1);
    expect(timeoutCarrier.counters.reconcile).toBe(1);
  });

  it("refuses a cross-border shipment without operator customs data before any carrier quote", async () => {
    const data = await createFixture(normalApp, "D5C", { crossBorderMissingCustoms: true });
    const carrierAccountId = await createCarrierAccount(normalApp, data.organizationId);
    const created = await api(
      normalApp,
      "POST",
      `/v1/invoices/${data.invoiceId}/shipment`,
      data.organizationId,
      { carrierAccountId, parcels: [parcel()], destinationAddress: data.destinationAddress }
    );
    expect(created.statusCode, created.body).toBe(201);
    const shipment = created.json<{ shipment: { id: string; version: number } }>().shipment;
    const quoted = await api(
      normalApp,
      "POST",
      `/v1/shipments/${shipment.id}/quote`,
      data.organizationId,
      { version: shipment.version }
    );
    expect(quoted.statusCode, quoted.body).toBe(422);
    const customsError = quoted.json<{ error: { code: string; message: string } }>().error;
    expect(customsError.code).toBe("SHIPPING_CUSTOMS_DATA_REQUIRED");
    expect(customsError.message).toEqual(expect.stringContaining("operator-supplied customs data"));
    expect(normalCarrier.counters.quote).toBe(1);
  });
});
