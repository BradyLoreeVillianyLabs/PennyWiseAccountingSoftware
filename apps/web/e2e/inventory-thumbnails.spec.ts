import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

type Account = {
  id: string;
  code: string;
  name: string;
  type: "ASSET" | "EXPENSE" | "REVENUE";
  isControl: boolean;
};

test("inventory shows the verified product image beside stock on hand", async ({
  page,
  request
}, testInfo) => {
  test.skip(!["chrome", "chromium"].includes(testInfo.project.name));
  test.setTimeout(120_000);

  const fixtureId = randomUUID();
  const email = `inventory-thumbnail-${fixtureId}@example.test`;
  const imageUrl = "https://media.example.test/catalog/cedar-candle.svg";
  await page.route("https://media.example.test/**", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#0b6775"/></svg>'
    });
  });

  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await expect(localIdentity).toBeVisible();
  await localIdentity.locator('input[name="email"]').fill(email);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("Inventory Thumbnail Ltd");
  await organization.locator('input[name="displayName"]').fill("Inventory Thumbnail");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();
  await expect(page.locator("#left-navigation-pane")).toBeVisible();
  const organizationId = await page.locator("#organization-select").inputValue();
  const headers = {
    "x-clearledger-user-email": email,
    "x-clearledger-user-name": email,
    "x-clearledger-organization-id": organizationId
  };
  const companyResponse = await request.post("/api/v1/organizations/current/companies", {
    headers,
    data: {
      legalName: "Inventory Thumbnail Ltd",
      displayName: "Inventory Thumbnail Company",
      baseCurrency: "CAD",
      timezone: "America/Edmonton",
      locale: "en-CA",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31
    }
  });
  expect(companyResponse.ok(), await companyResponse.text()).toBe(true);
  const companyId = ((await companyResponse.json()) as { company: { id: string } }).company.id;
  const companyHeaders = { ...headers, "x-clearledger-company-id": companyId };

  const year = new Date().getUTCFullYear();
  const setupResponse = await request.get("/api/v1/setup", { headers: companyHeaders });
  expect(setupResponse.ok(), await setupResponse.text()).toBe(true);
  const setup = (await setupResponse.json()) as { setup: { settings: { version: number } } };
  const profile = await request.patch("/api/v1/setup/profile", {
    headers: companyHeaders,
    data: {
      version: setup.setup.settings.version,
      legalName: "Inventory Thumbnail Ltd",
      displayName: "Inventory Thumbnail",
      locale: "en-CA",
      timeZone: "America/Edmonton",
      baseCurrency: "CAD",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      accountingStartDate: `${String(year)}-01-01`
    }
  });
  expect(profile.ok(), await profile.text()).toBe(true);
  const preset = await request.post("/api/v1/setup/presets/small-product-seller/apply", {
    headers: { ...companyHeaders, "idempotency-key": `inventory-thumbnail-${fixtureId}` },
    data: {}
  });
  expect(preset.ok(), await preset.text()).toBe(true);
  const fiscalPeriod = await request.post("/api/v1/setup/fiscal-year/initialize", {
    headers: companyHeaders,
    data: {}
  });
  expect(fiscalPeriod.ok(), await fiscalPeriod.text()).toBe(true);

  const accountsResponse = await request.get("/api/v1/accounts", { headers: companyHeaders });
  expect(accountsResponse.ok(), await accountsResponse.text()).toBe(true);
  const accounts = ((await accountsResponse.json()) as { accounts: Account[] }).accounts;
  const accountFor = (type: Account["type"]) =>
    accounts.find((account) => account.type === type && !account.isControl);
  const income = accountFor("REVENUE");
  const asset = accountFor("ASSET");
  const expense = accountFor("EXPENSE");
  expect(income).toBeTruthy();
  expect(asset).toBeTruthy();
  expect(expense).toBeTruthy();

  const locationResponse = await request.post("/api/v1/inventory/locations", {
    headers: companyHeaders,
    data: { code: "THUMB", name: "Thumbnail warehouse", isDefault: true }
  });
  expect(locationResponse.ok(), await locationResponse.text()).toBe(true);
  const locationId = ((await locationResponse.json()) as { location: { id: string } }).location.id;

  const productResponse = await request.post("/api/v1/products", {
    headers: companyHeaders,
    data: {
      sku: "WOO-CEDAR-CANDLE",
      name: "Imported cedar candle",
      itemType: "INVENTORY_PRODUCT",
      salesPriceMinor: "2400",
      purchaseCostMinor: "900",
      incomeAccountId: income!.id,
      inventoryAssetAccountId: asset!.id,
      costOfGoodsSoldAccountId: expense!.id,
      purchaseClearingAccountId: asset!.id,
      adjustmentGainAccountId: income!.id,
      inventoryLossAccountId: expense!.id,
      defaultLocationId: locationId,
      unitOfMeasure: "each",
      productImageReference: imageUrl
    }
  });
  expect(productResponse.ok(), await productResponse.text()).toBe(true);
  const productId = ((await productResponse.json()) as { product: { id: string } }).product.id;

  const adjusted = await request.post("/api/v1/inventory/adjustments", {
    headers: { ...companyHeaders, "idempotency-key": `inventory-stock-${fixtureId}` },
    data: {
      productItemId: productId,
      locationId,
      direction: "IN",
      quantity: "1",
      unitCostMinor: "900",
      adjustmentKind: "OPENING",
      effectiveDate: `${String(year)}-08-10`,
      reason: "Initial catalog import"
    }
  });
  expect(adjusted.ok(), await adjusted.text()).toBe(true);
  const directQuantitiesResponse = await request.get("/api/v1/inventory/quantities", {
    headers: companyHeaders
  });
  expect(directQuantitiesResponse.ok(), await directQuantitiesResponse.text()).toBe(true);
  const directQuantities = (await directQuantitiesResponse.json()) as {
    quantities: Array<{ productItem: { sku: string | null } }>;
  };
  expect(
    directQuantities.quantities.some((item) => item.productItem.sku === "WOO-CEDAR-CANDLE"),
    JSON.stringify(directQuantities)
  ).toBe(true);

  await page.evaluate((activeCompanyId) => {
    sessionStorage.setItem("clearledger_active_company", activeCompanyId);
  }, companyId);
  await page.reload();
  await expect(page.locator("#left-navigation-pane")).toBeVisible();
  await expect(page.locator("#company-select")).toHaveValue(companyId);
  await page.locator('#left-navigation-list [data-left-navigation-key="inventory"]').click();
  await expect(page.locator("#inventory-workspace")).toBeVisible();
  const quantitiesResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/inventory/quantities") &&
      response.request().method() === "GET"
  );
  await page.locator("#refresh-inventory").click();
  const quantitiesResponse = await quantitiesResponsePromise;
  expect(quantitiesResponse.ok(), await quantitiesResponse.text()).toBe(true);
  const quantities = (await quantitiesResponse.json()) as {
    quantities: Array<{ productItem: { sku: string | null } }>;
  };
  expect(
    quantities.quantities.some((item) => item.productItem.sku === "WOO-CEDAR-CANDLE"),
    JSON.stringify(quantities)
  ).toBe(true);
  const stockRow = page.locator("#inventory-quantities tr", {
    hasText: "WOO-CEDAR-CANDLE"
  });
  await expect(stockRow).toBeVisible({ timeout: 30_000 });
  const thumbnail = stockRow.locator(".inventory-thumbnail img");
  await expect(thumbnail).toHaveAttribute("src", imageUrl);
  await expect(thumbnail).toHaveAttribute("alt", "Imported cedar candle thumbnail");
});
