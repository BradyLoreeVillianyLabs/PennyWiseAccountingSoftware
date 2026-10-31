import { expect, test } from "@playwright/test";

test("shows own-account payment-link controls without exposing credentials", async ({
  page
}, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await page
    .locator('#local-identity-form input[name="email"]')
    .fill(`i9-${testInfo.project.name}@example.test`);
  await page.getByRole("button", { name: "Continue locally" }).click();
  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("I9 Own Account Ltd.");
  await organization.locator('input[name="displayName"]').fill("I9 Own Account");
  await organization.getByRole("button", { name: "Create" }).click();

  const firstRun = page.locator("#invoice-first-run-dialog");
  await firstRun.locator('input[name="addressLine1"]').fill("100 Test Street");
  await firstRun.locator('input[name="city"]').fill("Edmonton");
  await firstRun.locator('input[name="postalCode"]').fill("T5J 0N3");
  await firstRun.locator('input[name="email"]').fill("owner@example.test");
  await firstRun.getByRole("button", { name: "Set up invoicing" }).click();
  await expect(firstRun).toBeHidden({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open Payments & refunds" }).click();
  await expect(page.locator("#payments-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#own-account-payment-section")).toBeVisible();
  await expect(page.locator("#own-payment-account-form")).toBeVisible();
  await expect(page.locator("#durable-payment-link-section")).toBeVisible();
  await expect(page.locator('#own-payment-account-form input[name="credential"]')).toHaveAttribute(
    "type",
    "password"
  );

  await page.locator('#own-payment-account-form select[name="provider"]').selectOption("SQUARE");
  await expect(page.locator('#own-payment-account-form input[name="locationId"]')).toBeVisible();
  await expect(page.locator('#own-payment-account-form input[name="locationId"]')).toHaveAttribute(
    "required",
    ""
  );
  await page.locator('#own-payment-account-form select[name="provider"]').selectOption("STRIPE");
  await expect(page.locator('#own-payment-account-form input[name="locationId"]')).toBeHidden();

  for (const width of [390, 834, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("#own-account-payment-section")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`i9-payments-workspace-${width.toString()}.png`),
      fullPage: true
    });
  }
  await page.emulateMedia({ forcedColors: "active" });
  await page.screenshot({
    path: testInfo.outputPath("i9-payments-workspace-forced-colors.png"),
    fullPage: true
  });
  expect(consoleErrors).toEqual([]);
});
