import { expect, test } from "@playwright/test";

test("guides a foreign invoice into currency-aware controls", async ({ page }, testInfo) => {
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
    .fill(`x1-${testInfo.project.name}@example.test`);
  await page.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("X1 Currency Ltd.");
  await organization.locator('input[name="displayName"]').fill("X1 Currency");
  await organization.getByRole("button", { name: "Create" }).click();

  const firstRun = page.locator("#invoice-first-run-dialog");
  await firstRun.locator('input[name="addressLine1"]').fill("100 Test Street");
  await firstRun.locator('input[name="city"]').fill("Edmonton");
  await firstRun.locator('input[name="postalCode"]').fill("T5J 0N3");
  await firstRun.locator('input[name="email"]').fill("owner@example.test");
  await firstRun.getByRole("button", { name: "Set up invoicing" }).click();
  await expect(firstRun).toBeHidden({ timeout: 30_000 });
  // The dialog closes just before the final organization refresh. Wait for
  // that refresh to select the overview before navigating into Sales.
  await expect(page.locator("#overview-workspace")).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Open Receivables & sales" }).click();
  await expect(page.locator("#sales-workspace")).toBeVisible({ timeout: 30_000 });
  const currency = page.locator('#invoice-form select[name="currency"]');
  await expect(currency.locator('option[value="USD"]')).toHaveCount(1);
  let confirmed = false;
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Enable CAD and USD accounting");
    confirmed = true;
    await dialog.accept();
  });
  await currency.selectOption("USD");
  await expect.poll(() => confirmed).toBe(true);
  await expect(currency).toBeEnabled();
  await expect(currency).toHaveValue("USD");
  await expect(page.locator("#invoice-inline-rate")).toBeVisible();
  await expect(page.locator("#invoice-suggest-rate")).toBeVisible();
  await expect(page.locator("#invoice-estimated-total")).toContainText("US$");

  await page.route("**/api/v1/settings/multi-currency/rate-suggestion**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        suggestion: {
          series: "FXUSDCAD",
          observationDate: "2026-09-11",
          requestedDate: "2026-09-12",
          rate: "1.3750",
          sourceReference:
            "Bank of Canada Valet FXUSDCAD; observed 2026-09-11; requested 2026-09-12"
        }
      })
    });
  });
  await page.getByRole("button", { name: "Check Bank of Canada" }).click();
  await expect(page.getByRole("button", { name: "Use this rate" })).toBeVisible();
  await page.getByRole("button", { name: "Use this rate" }).click();
  await expect(page.locator('#invoice-form select[name="fxRateSnapshotId"]')).not.toHaveValue("");

  await page.screenshot({ path: testInfo.outputPath("x1-currency-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: testInfo.outputPath("x1-currency-mobile.png"), fullPage: true });
  expect(consoleErrors).toEqual([]);
});
