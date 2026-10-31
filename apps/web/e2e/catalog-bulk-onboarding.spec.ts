import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("catalog bulk onboarding creates reviewed items without silently creating stock or mappings", async ({
  page,
  request
}, testInfo) => {
  test.skip(!["chrome", "chromium"].includes(testInfo.project.name));
  test.setTimeout(120_000);

  const fixtureId = randomUUID();
  const email = `catalog-bulk-${fixtureId}@example.test`;
  await page.goto("/");
  await page.locator('#local-identity-form input[name="email"]').fill(email);
  await page.getByRole("button", { name: "Continue locally" }).click();
  await page.locator('#organization-form input[name="legalName"]').fill("Catalog Bulk Test Ltd");
  await page.locator('#organization-form input[name="displayName"]').fill("Catalog Bulk Test");
  await page.locator("#organization-form").getByRole("button", { name: "Create" }).click();
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
      legalName: "Catalog Bulk Test Ltd",
      displayName: "Catalog Bulk Test Company",
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
  const setupResponse = await request.get("/api/v1/setup", { headers: companyHeaders });
  expect(setupResponse.ok(), await setupResponse.text()).toBe(true);
  const setup = (await setupResponse.json()) as { setup: { settings: { version: number } } };
  const year = new Date().getUTCFullYear();
  const profile = await request.patch("/api/v1/setup/profile", {
    headers: companyHeaders,
    data: {
      version: setup.setup.settings.version,
      legalName: "Catalog Bulk Test Ltd",
      displayName: "Catalog Bulk Test",
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
    headers: { ...companyHeaders, "idempotency-key": `catalog-bulk-preset-${fixtureId}` },
    data: {}
  });
  expect(preset.ok(), await preset.text()).toBe(true);
  const fiscalPeriod = await request.post("/api/v1/setup/fiscal-year/initialize", {
    headers: companyHeaders,
    data: {}
  });
  expect(fiscalPeriod.ok(), await fiscalPeriod.text()).toBe(true);

  const locationResponse = await request.post("/api/v1/inventory/locations", {
    headers: companyHeaders,
    data: { code: "BULK", name: "Bulk catalog warehouse", isDefault: true }
  });
  expect(locationResponse.ok(), await locationResponse.text()).toBe(true);
  const connectorResponse = await request.post("/api/v1/organizations/current/connectors", {
    headers: companyHeaders,
    data: { providerKey: "WOOCOMMERCE", displayName: "Bulk source store", mapping: {} }
  });
  expect(connectorResponse.ok(), await connectorResponse.text()).toBe(true);
  const connectorId = ((await connectorResponse.json()) as { connector: { id: string } }).connector
    .id;
  const catalogResponse = await request.post(
    `/api/v1/organizations/current/connectors/${connectorId}/catalog/ingest`,
    {
      headers: companyHeaders,
      data: {
        externalProductId: "bulk-source-mug",
        name: "Source enamel mug",
        description: "Reviewed catalog item created through the bulk onboarding interface.",
        variants: [
          {
            externalVariantId: "bulk-mug-blue",
            name: "Source enamel mug blue",
            sku: "BULK-MUG-BLUE"
          },
          {
            externalVariantId: "bulk-mug-green",
            name: "Source enamel mug green",
            sku: "BULK-MUG-GREEN"
          }
        ]
      }
    }
  );
  expect(catalogResponse.ok(), await catalogResponse.text()).toBe(true);

  await page.evaluate((activeCompanyId) => {
    sessionStorage.setItem("clearledger_active_company", activeCompanyId);
  }, companyId);
  await page.reload();
  await expect(page.locator("#company-select")).toHaveValue(companyId);
  await page.locator('#left-navigation-list [data-left-navigation-key="integrations"]').click();
  await expect(page.locator("#integrations-workspace")).toBeVisible();
  await page.locator('[data-commerce-view-target="catalog"]').click();
  await expect(page.locator("#commerce-catalog-view")).toBeVisible();
  await expect(page.locator("#catalog-product-list")).toContainText("Source enamel mug");
  await page.getByRole("button", { name: "Create reviewed items" }).click();
  const dialog = page.locator("#catalog-bulk-product-dialog");
  await expect(dialog).toHaveAttribute("open", "");
  await expect(dialog.locator('input[name="catalogVariantIds"]')).toHaveCount(2);
  await expect(dialog.locator('input[name="catalogVariantIds"]:checked')).toHaveCount(2);
  await expect(dialog.locator('input[name="confirmMappings"]')).not.toBeChecked();
  await expect(dialog.getByText("Stock quantities stay unchanged.")).toBeVisible();

  page.once("dialog", (confirmation) => confirmation.accept());
  const bulkRequest = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/organizations/current/catalog/bulk-create-local-products") &&
      response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "Create 2 selected items" }).click();
  const bulkResponse = await bulkRequest;
  expect(bulkResponse.ok(), await bulkResponse.text()).toBe(true);
  const payload = bulkResponse.request().postDataJSON() as { confirmMappings: boolean };
  expect(payload.confirmMappings).toBe(false);
  await expect(dialog).not.toHaveAttribute("open", "");
  await expect(page.locator("#catalog-operation-status")).toContainText("Created 2");

  const productsResponse = await request.get("/api/v1/products", { headers: companyHeaders });
  expect(productsResponse.ok(), await productsResponse.text()).toBe(true);
  const products = (await productsResponse.json()) as {
    products: Array<{ sku: string | null; description: string | null }>;
  };
  expect(products.products).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sku: "BULK-MUG-BLUE",
        description: "Reviewed catalog item created through the bulk onboarding interface."
      }),
      expect.objectContaining({
        sku: "BULK-MUG-GREEN",
        description: "Reviewed catalog item created through the bulk onboarding interface."
      })
    ])
  );
  const quantitiesResponse = await request.get("/api/v1/inventory/quantities", {
    headers: companyHeaders
  });
  expect(quantitiesResponse.ok(), await quantitiesResponse.text()).toBe(true);
  expect((await quantitiesResponse.json()) as { quantities: unknown[] }).toEqual({
    quantities: []
  });
  const reviewedCatalog = await request.get("/api/v1/organizations/current/catalog?limit=50", {
    headers: companyHeaders
  });
  expect(reviewedCatalog.ok(), await reviewedCatalog.text()).toBe(true);
  const candidates = (await reviewedCatalog.json()) as {
    products: Array<{
      variants: Array<{ sku: string | null; candidates: Array<{ status: string }> }>;
    }>;
  };
  expect(
    candidates.products
      .flatMap((product) => product.variants)
      .filter((variant) => variant.sku?.startsWith("BULK-MUG-"))
      .every((variant) => variant.candidates.some((candidate) => candidate.status === "SUGGESTED"))
  ).toBe(true);
});
