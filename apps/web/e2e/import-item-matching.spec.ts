import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("product spreadsheet review pages nearest field evidence past row 25", async ({
  page,
  request
}, testInfo) => {
  test.skip(!["chrome", "chromium"].includes(testInfo.project.name));
  test.setTimeout(120_000);

  const fixtureId = randomUUID();
  const email = `import-matching-${fixtureId}@example.test`;
  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await expect(localIdentity).toBeVisible();
  await localIdentity.locator('input[name="email"]').fill(email);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("Import Matching Evidence Ltd");
  await organization.locator('input[name="displayName"]').fill("Import Matching Evidence");
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

  const preset = await request.post("/api/v1/setup/presets/general-service/apply", {
    headers: { ...headers, "idempotency-key": `import-matching-${fixtureId}` },
    data: {}
  });
  expect(preset.ok(), await preset.text()).toBe(true);
  const accountResponse = await request.get("/api/v1/accounts", { headers });
  expect(accountResponse.ok()).toBe(true);
  const income = (
    (await accountResponse.json()) as {
      accounts: Array<{ id: string; code: string; type: string; isControl: boolean }>;
    }
  ).accounts.find(
    (account) => account.code === "4100" && account.type === "REVENUE" && !account.isControl
  );
  expect(income).toBeTruthy();
  const localProduct = await request.post("/api/v1/products", {
    headers,
    data: {
      sku: "MATCH-BASE",
      name: "Executive advisory package",
      description: "Monthly planning and reporting service",
      itemType: "SERVICE",
      salesPriceMinor: "1299",
      incomeAccountId: income!.id
    }
  });
  expect(localProduct.ok(), await localProduct.text()).toBe(true);

  await page.locator('#workspace-mode-switch [data-workspace-mode="accountant"]').click();
  await page.locator('#left-navigation-list [data-left-navigation-key="switching"]').click();
  const importForm = page.locator("#data-import-form");
  await page.locator("#data-import-source-system").selectOption("OTHER");
  await importForm.locator('select[name="importType"]').selectOption("PRODUCTS");
  const csv = [
    "sku,name,item_type,sales_price_minor,income_account_code,description",
    ...Array.from(
      { length: 26 },
      (_, index) =>
        `MATCH-${String(index + 1).padStart(3, "0")},Executive advisory package,SERVICE,1299,4100,Monthly planning and reporting service`
    )
  ].join("\n");
  await page.locator("#data-import-file").setInputFiles({
    name: "products-with-near-matches.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`${csv}\n`)
  });
  await expect(page.locator("#import-mapping-completeness")).toContainText(
    "required fields are complete"
  );
  await importForm.getByRole("button", { name: "Upload and review" }).click();

  const review = page.locator("#import-item-match-review");
  await expect(review).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#import-item-match-summary")).toContainText("Rows 1-25 of 26");
  await expect(page.locator("#import-item-match-rows [data-source-row]")).toHaveCount(25);
  const firstCandidate = page.locator(".import-item-match-candidate").first();
  await expect(firstCandidate).toContainText("Executive advisory package");
  await expect(firstCandidate.getByLabel("Nearest-field evidence")).toContainText(
    "Name: 100% similar"
  );
  await expect(firstCandidate.getByLabel("Nearest-field evidence")).toContainText(
    "Description: 100% similar"
  );
  await expect(page.locator("#next-import-item-matches")).toBeEnabled();

  await page.locator("#next-import-item-matches").click();
  await expect(page.locator("#import-item-match-summary")).toContainText("Rows 26-26 of 26");
  await expect(page.locator("#import-item-match-rows [data-source-row]")).toHaveCount(1);
  await expect(page.locator('#import-item-match-rows [data-source-row="27"]')).toBeVisible();
  await expect(page.locator("#previous-import-item-matches")).toBeEnabled();
  await expect(page.locator("#next-import-item-matches")).toBeDisabled();
});
