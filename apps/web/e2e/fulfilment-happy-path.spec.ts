import { expect, test } from "@playwright/test";
import { PrismaClient } from "../../../packages/db/dist/index.js";

type ApiResult = { status: number; body: string };

test("fulfilment drives a reviewed order through shipment void", async ({ page }, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));

  const email = `fulfilment-happy-${testInfo.project.name}@example.test`;
  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await localIdentity.locator('input[name="email"]').fill(email);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("Fulfilment Happy Path Ltd.");
  await organization.locator('input[name="displayName"]').fill("Fulfilment Happy Path");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();

  const callApi = async (
    path: string,
    method = "GET",
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<ApiResult> =>
    page.evaluate(
      async ({
        path: requestPath,
        method: requestMethod,
        body: requestBody,
        extraHeaders: requestHeaders
      }) => {
        const localEmail = sessionStorage.getItem("clearledger_local_identity");
        const organizationId = sessionStorage.getItem("clearledger_active_organization");
        const headers: Record<string, string> = { ...requestHeaders };
        if (localEmail) {
          headers["x-clearledger-user-email"] = localEmail;
          headers["x-clearledger-user-name"] = localEmail;
        }
        if (organizationId) headers["x-clearledger-organization-id"] = organizationId;
        if (requestBody !== undefined) headers["content-type"] = "application/json";
        const response = await fetch(`/api${requestPath}`, {
          credentials: "include",
          method: requestMethod,
          headers,
          ...(requestBody === undefined ? {} : { body: JSON.stringify(requestBody) })
        });
        return { status: response.status, body: await response.text() };
      },
      { path, method, body, extraHeaders }
    );

  const callJson = async <T>(
    path: string,
    method = "GET",
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<T> => {
    const result = await callApi(path, method, body, extraHeaders);
    expect(result.status, `${method} ${path}: ${result.body}`).toBeLessThan(300);
    return JSON.parse(result.body) as T;
  };

  const setup = await callJson<{ setup: { settings: { version: number } } }>("/v1/setup");
  await callJson("/v1/setup/profile", "PATCH", {
    version: setup.setup.settings.version,
    legalName: "Fulfilment Happy Path Ltd.",
    displayName: "Fulfilment Happy Path",
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
  await callJson(
    "/v1/setup/presets/general-service/apply",
    "POST",
    {},
    { "idempotency-key": "fulfilment-happy-preset" }
  );
  await callJson("/v1/setup/fiscal-year/initialize", "POST", {});

  const accountList = await callJson<{
    accounts: Array<{ id: string; systemPurpose: string | null }>;
  }>("/v1/accounts");
  const revenueAccountId = accountList.accounts.find(
    (account) => account.systemPurpose === "professional-services"
  )?.id;
  const taxPayableAccountId = accountList.accounts.find(
    (account) => account.systemPurpose === "tax-payable"
  )?.id;
  expect(revenueAccountId).toBeTruthy();
  expect(taxPayableAccountId).toBeTruthy();

  const createAccount = async (code: string, type: "ASSET" | "EXPENSE" | "REVENUE") => {
    const result = await callJson<{ account: { id: string } }>("/v1/accounts", "POST", {
      code,
      name: code,
      type,
      isControl: false
    });
    return result.account.id;
  };
  const [
    payingAccountId,
    expenseAccountId,
    inventoryAssetAccountId,
    cogsAccountId,
    clearingAccountId,
    gainAccountId,
    lossAccountId
  ] = await Promise.all([
    createAccount("H11400", "ASSET"),
    createAccount("H15500", "EXPENSE"),
    createAccount("H11410", "ASSET"),
    createAccount("H15501", "EXPENSE"),
    createAccount("H11411", "ASSET"),
    createAccount("H14101", "REVENUE"),
    createAccount("H15502", "EXPENSE")
  ]);

  const taxCode = await callJson<{ taxCodeVersion: { taxCodeId: string } }>(
    "/v1/setup/tax-codes/versions",
    "POST",
    {
      code: "H1GST",
      name: "H1 GST",
      treatment: "STANDARD",
      calculationMode: "EXCLUSIVE",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-12-31",
      sourceName: "H1 reviewed fixture",
      sourceRetrievedAt: "2026-01-01T00:00:00.000Z",
      components: [
        {
          name: "GST",
          jurisdiction: "CA",
          rate: "0.050000",
          recoverablePercent: "1.000000",
          payableAccountId: taxPayableAccountId,
          recoverableAccountId: null
        }
      ]
    }
  );

  const location = await callJson<{ location: { id: string } }>("/v1/inventory/locations", "POST", {
    code: "H1-MAIN",
    name: "H1 warehouse",
    isDefault: true
  });
  const product = await callJson<{ product: { id: string } }>("/v1/products", "POST", {
    sku: "H1-WIDGET",
    name: "H1 Widget",
    itemType: "INVENTORY_PRODUCT",
    salesPriceMinor: "5000",
    purchaseCostMinor: "2000",
    incomeAccountId: revenueAccountId,
    inventoryAssetAccountId,
    costOfGoodsSoldAccountId: cogsAccountId,
    purchaseClearingAccountId: clearingAccountId,
    adjustmentGainAccountId: gainAccountId,
    inventoryLossAccountId: lossAccountId,
    defaultLocationId: location.location.id,
    unitOfMeasure: "each"
  });
  await callJson(
    "/v1/inventory/adjustments",
    "POST",
    {
      productItemId: product.product.id,
      locationId: location.location.id,
      direction: "IN",
      quantity: "5",
      unitCostMinor: "2000",
      adjustmentKind: "OPENING",
      effectiveDate: "2026-02-01",
      reason: "H1 opening stock"
    },
    { "idempotency-key": "fulfilment-happy-opening" }
  );

  const customer = await callJson<{ customer: { id: string } }>("/v1/customers", "POST", {
    customerNumber: "H1-CUSTOMER",
    displayName: "H1 customer",
    email: "h1-customer@example.test",
    defaultPaymentTermsDays: 30,
    defaultCurrency: "CAD",
    addresses: [
      {
        role: "SHIPPING",
        recipientName: "H1 customer",
        line1: "200 Customer Avenue",
        city: "Calgary",
        subdivisionCode: "CA-AB",
        postalCode: "T2P 1J9",
        countryCode: "CA",
        isDefault: true
      }
    ]
  });

  const mapping = {
    customerStrategy: "POOLED",
    marketplaceCustomerId: customer.customer.id,
    taxMappings: { gst: taxCode.taxCodeVersion.taxCodeId },
    taxRemittanceMappings: { gst: "SELLER" },
    taxRemittanceResponsibility: "SELLER"
  };
  const connector = await callJson<{ connector: { id: string } }>(
    "/v1/organizations/current/connectors",
    "POST",
    { providerKey: "WOOCOMMERCE", displayName: "H1 Fixture Store", mapping }
  );

  const databaseUrl = process.env.TEST_DATABASE_URL;
  expect(databaseUrl).toBeTruthy();
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl! } } });
  try {
    await prisma.connectorInstallation.update({
      where: { id: connector.connector.id },
      data: {
        mapping: { ...mapping, catalogProductMappings: { "1001": product.product.id } },
        mappingVersion: { increment: 1 }
      }
    });

    const money = (units: string, decimal: string) => ({
      currency: "CAD",
      units,
      divisor: "100",
      decimal,
      providerRepresentation: decimal
    });
    const normalizedPayload = {
      schemaVersion: 1,
      provider: "WOOCOMMERCE",
      transactionKind: "ORDER",
      externalId: "1001",
      sourceCreatedAt: "2026-03-15T12:00:00.000Z",
      sourceModifiedAt: "2026-03-15T12:00:00.000Z",
      status: "processing",
      currencies: { source: "CAD", payment: "CAD", settlement: null },
      money: {
        total: money("10000", "100.00"),
        discount: money("0", "0.00"),
        shipping: money("0", "0.00"),
        tax: money("0", "0.00")
      },
      lines: [
        {
          externalId: "1",
          productExternalId: "1001",
          variationExternalId: null,
          sku: "H1-WIDGET",
          name: "H1 Widget",
          quantity: "2",
          subtotal: money("10000", "100.00"),
          total: money("10000", "100.00"),
          tax: money("0", "0.00"),
          mappingStatus: "MAPPED"
        }
      ],
      taxes: [],
      shipping: [],
      discounts: [],
      fees: [],
      payments: [],
      refunds: [],
      settlement: null,
      mapping: {
        customerStrategy: "POOLED",
        itemStatus: "MAPPED",
        taxStatus: "MAPPED",
        taxRemittanceResponsibility: "SELLER"
      },
      reconciliation: {
        providerTotal: money("10000", "100.00"),
        componentTotal: money("10000", "100.00"),
        difference: money("0", "0.00"),
        balanced: true
      },
      issues: [],
      sourceMetadata: {
        createdVia: "h1-e2e",
        taxEvidence: {
          kind: "STORE_CALCULATION",
          jurisdictionBreakdownAvailable: true,
          remittanceInferred: false
        },
        paymentMethod: "fixture",
        pricesIncludeTax: false,
        customerNotePresent: false,
        discountReconciliation: "Fixture totals are already discount-adjusted"
      }
    };

    const rawPayload = {
      id: 1001,
      number: "H1-ORDER-1001",
      status: "processing",
      currency: "CAD",
      billing: { first_name: "H1", last_name: "customer" },
      line_items: [
        {
          id: 1,
          product_id: 1001,
          variation_id: 0,
          sku: "H1-WIDGET",
          name: "H1 Widget",
          quantity: 2,
          price: "50.00",
          subtotal: "100.00",
          total: "100.00",
          total_tax: "0.00"
        }
      ],
      tax_lines: [],
      shipping_lines: [],
      fee_lines: [],
      coupon_lines: [],
      discount_total: "0.00",
      shipping_total: "0.00",
      total_tax: "0.00",
      total: "100.00",
      date_created_gmt: "2026-03-15T12:00:00Z",
      date_modified_gmt: "2026-03-15T12:00:00Z"
    };
    const ingested = await callJson<{
      event: { id: string; version: number };
    }>("/v1/organizations/current/commerce/inbox", "POST", {
      installationId: connector.connector.id,
      providerKey: "WOOCOMMERCE",
      shopExternalId: "https://h1.example.test",
      externalEventId: "poll:order:1001:2026-03-15T12:00:00.000Z",
      resourceType: "ORDER",
      resourceId: "1001",
      eventType: "order.processing",
      eventVersion: "2026-03-15T12:00:00.000Z",
      occurredAt: "2026-03-15T12:00:00.000Z",
      sourceCurrency: "CAD",
      paymentCurrency: "CAD",
      rawPayload,
      normalizedPayload,
      normalizedSchemaVersion: 1,
      normalizationIssues: [],
      mappingVersion: 2
    });
    await callJson(`/v1/organizations/current/commerce/inbox/${ingested.event.id}/review`, "POST", {
      version: ingested.event.version,
      status: "NORMALIZED",
      reviewNote: "H1 e2e reviewed."
    });

    const carrier = await callJson<{ carrierAccount: { id: string } }>(
      "/v1/shipping/carrier-accounts",
      "POST",
      {
        carrierKey: "FIXTURE",
        displayName: "H1 Fixture Carrier",
        environment: "TEST",
        credentials: { apiKey: "fixture-key" },
        defaultLabelFormat: "PDF",
        defaultLabelWidthMm: 101,
        defaultLabelHeightMm: 152
      }
    );

    await page
      .locator("#left-navigation-list button")
      .filter({ hasText: /Orders & fulfilment$/ })
      .first()
      .click();
    await expect(page.locator("#fulfilment-workspace")).toBeVisible();
    const order = page.locator(".fulfilment-order").filter({ hasText: "H1-ORDER-1001" }).first();
    await expect(order).toBeVisible();
    await order.click();
    await expect(page.locator("#fulfilment-detail")).toContainText("Ready to convert");
    await expect(page.locator("#fulfilment-detail")).toContainText("H1 Widget");

    page.on(
      "dialog",
      (dialog) => void dialog.accept(dialog.type() === "prompt" ? "H1 automated void" : undefined)
    );
    await page.locator("#fulfilment-detail .fulfilment-convert").click();
    await expect(page.locator("#fulfilment-detail")).toContainText("Status");
    await expect(page.locator("#fulfilment-detail")).toContainText("DRAFT");
    await expect(page.locator("#fulfilment-detail")).toContainText("Post invoice");

    await page.locator("#fulfilment-detail").getByRole("button", { name: "Post invoice" }).click();
    await expect(page.locator("#fulfilment-detail")).toContainText("POSTED");
    await expect(page.locator("#fulfilment-picking")).toContainText("Create picking slip");

    await page
      .locator("#fulfilment-picking")
      .getByRole("button", { name: "Create picking slip" })
      .click();
    await expect(page.locator("#fulfilment-picking")).toContainText("Record picked quantities");
    await page
      .locator("#fulfilment-picking")
      .getByRole("button", { name: "Record picked quantities" })
      .click();
    await expect(page.locator("#fulfilment-picking")).toContainText("All lines were picked");

    const shipping = page.locator("#fulfilment-shipping");
    await expect(shipping).toContainText("Create shipment draft");
    await shipping
      .locator('select[name="carrierAccountId"]')
      .selectOption(carrier.carrierAccount.id);
    await shipping.getByRole("button", { name: "Create shipment draft" }).click();
    await expect(shipping).toContainText("Get carrier quote");
    await shipping.getByRole("button", { name: "Get carrier quote" }).click();
    await expect(shipping).toContainText("CAD 11.50");

    await shipping.locator('select[name="expenseAccountId"]').selectOption(expenseAccountId);
    await shipping.locator('select[name="payingAccountId"]').selectOption(payingAccountId);
    await shipping.locator('select[name="expenseMethod"]').selectOption("CREDIT_CARD");
    await shipping.locator('input[name="expenseDate"]').fill("2026-03-15");
    await shipping.getByRole("button", { name: "Review and purchase label" }).click();
    await expect(shipping).toContainText("PURCHASED");
    await expect(shipping).toContainText("FIX-");
    await expect(page.locator(".fulfilment-order-state")).toHaveText("Shipped");
    await shipping.getByRole("button", { name: "Void shipment" }).click();
    await expect(shipping).toContainText("VOIDED");
    await expect(page.locator(".fulfilment-order-state")).toHaveText("Picked");

    const invoices = await callJson<{ invoices: Array<{ status: string }> }>("/v1/invoices");
    expect(invoices.invoices.filter((invoice) => invoice.status === "POSTED")).toHaveLength(1);
  } finally {
    await prisma.$disconnect();
  }
});

test("fulfilment layout remains usable across supported viewports", async ({ page }, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));

  const email = `fulfilment-layout-${testInfo.project.name}@example.test`;
  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await localIdentity.locator('input[name="email"]').fill(email);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();
  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("Fulfilment Layout Ltd.");
  await organization.locator('input[name="displayName"]').fill("Fulfilment Layout");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();

  const staged = await page.evaluate(async () => {
    const email = sessionStorage.getItem("clearledger_local_identity");
    const organizationId = sessionStorage.getItem("clearledger_active_organization");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (email) {
      headers["x-clearledger-user-email"] = email;
      headers["x-clearledger-user-name"] = email;
    }
    if (organizationId) headers["x-clearledger-organization-id"] = organizationId;
    const response = await fetch("/api/v1/organizations/current/commerce/demo", {
      method: "POST",
      credentials: "include",
      headers,
      body: "{}"
    });
    return { status: response.status, body: await response.text() };
  });
  expect([200, 201], staged.body).toContain(staged.status);

  await page
    .locator("#left-navigation-list button")
    .filter({ hasText: /Orders & fulfilment$/ })
    .first()
    .click();
  await expect(page.locator("#fulfilment-workspace")).toBeVisible();
  await expect(page.locator(".fulfilment-order").first()).toContainText("Review required");

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 },
    { width: 834, height: 1112 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#fulfilment-workspace")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow, `horizontal overflow at ${String(viewport.width)}px`).toBeLessThanOrEqual(1);
  }
});
