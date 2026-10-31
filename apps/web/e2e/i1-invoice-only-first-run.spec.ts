import { expect, test } from "@playwright/test";

test("fresh business can choose invoicing-only setup and save an invoice draft", async ({
  page
}, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));
  test.setTimeout(120_000);

  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await localIdentity
    .locator('input[name="email"]')
    .fill(`i1-first-run-${testInfo.project.name}@example.test`);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("I1 First Run Services Ltd.");
  await organization.locator('input[name="displayName"]').fill("I1 First Run Services");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");

  const firstRun = page.locator("#invoice-first-run-dialog");
  await expect(firstRun).toBeVisible();
  await firstRun.locator('input[name="addressLine1"]').fill("100 Test Street");
  await firstRun.locator('input[name="city"]').fill("Edmonton");
  await firstRun.locator('select[name="province"]').selectOption("AB");
  await firstRun.locator('input[name="postalCode"]').fill("T5J 0N3");
  await firstRun.locator('input[name="email"]').fill("owner@example.test");
  await firstRun.locator('input[name="paymentMethods"][value="E_TRANSFER"]').check();
  await firstRun.locator('select[name="documentLanguage"]').selectOption("en-CA");
  await firstRun.getByRole("button", { name: "Set up invoicing" }).click();
  await expect(firstRun).toBeHidden({ timeout: 30_000 });
  await expect(page.locator("#overview-workspace")).toBeVisible();

  await expect(
    page.locator('#left-navigation-list [data-left-navigation-key="sales"]')
  ).toHaveCount(1);
  await expect(
    page.locator('#left-navigation-list [data-left-navigation-key="inventory"]')
  ).toHaveCount(0);
  await expect(
    page.locator('#left-navigation-list [data-left-navigation-key="payroll"]')
  ).toHaveCount(0);
  await expect(page.locator("#home-data-status-message")).not.toContainText(
    "Complete company setup"
  );

  await page.locator('#left-navigation-list [data-left-navigation-key="sales"]').click();
  const customer = page.locator("#customer-form");
  await customer.locator('input[name="displayName"]').fill("I1 Test Customer");
  await customer.locator('input[name="email"]').fill("customer@example.test");
  await customer.getByRole("button", { name: "Create customer" }).click();
  await expect(page.locator("#notice")).toHaveText("Customer created.");
  await expect(customer.locator('input[name="customerNumber"]')).toHaveValue("");

  const invoice = page.locator("#invoice-form");
  const customerOption = invoice
    .locator('select[name="customerId"] option')
    .filter({ hasText: "I1 Test Customer" })
    .first();
  const customerId = await customerOption.getAttribute("value");
  expect(customerId).toBeTruthy();
  await invoice.locator('select[name="customerId"]').selectOption(customerId ?? "");
  const line = invoice.locator(".invoice-line-row").first();
  await line.locator('[data-line-field="description"]').fill("Monthly service");
  await line.locator('[data-line-field="unitPriceMinor"]').fill("125.00");
  await invoice.getByRole("button", { name: "Create invoice draft and review" }).click();
  await expect(page.locator("#invoice-preview")).toContainText(/draft|CAD 125\.00/i);
  await invoice.locator('textarea[name="terms"]').fill("Updated after the first save");
  await expect(page.locator("#invoice-save-status")).toHaveText("Draft saved just now", {
    timeout: 10_000
  });
  await page.locator("#left-navigation-settings").click();
  await page.locator("#settings-menu").getByRole("button", { name: "Company settings" }).click();
  await page.getByRole("button", { name: /\d+\. Review/ }).click();
  await expect(page.locator("#show-more-pennywise-panel")).toBeVisible();
  await page.locator("#show-more-pennywise").click();
  await expect(page.locator("#show-more-pennywise-panel")).toBeHidden();
  await expect(
    page.locator('#left-navigation-list [data-left-navigation-key="inventory"]')
  ).toHaveCount(1);
});
