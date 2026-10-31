import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

test("X2 report shell, privacy, saved-view, and drilldown contracts", async ({
  page
}, testInfo) => {
  test.skip(
    !["chromium", "chrome"].includes(testInfo.project.name),
    "The focused X2 flow runs on Chromium."
  );
  test.setTimeout(120_000);

  await page.goto("/");
  const email = `x2-${testInfo.project.name}-${String(Date.now())}@example.test`;
  await page.locator("#local-identity-form input[name=email]").fill(email);
  await page.getByRole("button", { name: "Continue locally" }).click();
  await page.getByRole("button", { name: "Create demo company" }).click();
  await expect(page.locator("#notice")).toContainText("Fictional is ready", { timeout: 90_000 });

  await page.locator('#left-navigation-list [data-left-navigation-key="reports"]').click();
  const report = page.locator("#report-filter-form");
  await report.locator('select[name="reportName"]').selectOption("profit-and-loss");
  await report.locator('input[name="from"]').fill("2026-01-01");
  await report.locator('input[name="to"]').fill("2026-12-31");
  await report.locator('input[name="asOf"]').fill("2026-12-31");
  const profitStart = await page.evaluate(() => performance.now());
  await report.getByRole("button", { name: "Run report" }).click();
  await expect(page.locator("#report-header-line")).toContainText("Amounts in");
  await expect(page.locator("#report-table")).toBeVisible();
  await expect(page.locator("#report-hide-zero")).toBeChecked();
  await expect(page.locator("#report-table tbody tr")).not.toHaveCount(0);
  const profitDurationMs = (await page.evaluate(() => performance.now())) - profitStart;
  expect(profitDurationMs).toBeLessThan(1_000);

  await report.locator('select[name="reportName"]').selectOption("general-ledger");
  const ledgerStart = await page.evaluate(() => performance.now());
  await report.getByRole("button", { name: "Run report" }).click();
  await expect(page.locator("#report-status")).toContainText("General-ledger");
  const ledgerDurationMs = (await page.evaluate(() => performance.now())) - ledgerStart;
  expect(ledgerDurationMs).toBeLessThan(1_000);
  console.log(
    JSON.stringify({
      profitDurationMs,
      ledgerDurationMs,
      ledgerRows: await page.locator("#report-table tbody tr").count()
    })
  );

  await report.locator('select[name="reportName"]').selectOption("profit-and-loss");
  await report.getByRole("button", { name: "Run report" }).click();
  await expect(page.locator("#report-header-line")).toContainText("Amounts in");

  const detail = page.locator(".report-detail-link").first();
  if (await detail.count()) {
    await detail.click();
    await expect(page.locator("#report-drilldown-panel")).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(page.locator("#report-drilldown-panel")).toBeHidden();
  }

  await page.locator("#report-view-name").fill("X2 annual owner view");
  await page.locator("#report-view-default").check();
  await page.getByRole("button", { name: "Save view" }).click();
  await expect(page.locator("#report-view-status")).toContainText("Saved view");

  const axe = await new AxeBuilder({ page }).analyze();
  const serious = axe.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? "")
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

  await page.locator('#left-navigation-list [data-left-navigation-key="home"]').click();
  await expect(page.locator("#hide-dashboard-amounts")).toBeVisible();
  await page.locator("#hide-dashboard-amounts").check();
  await expect(page.locator("#home-business-summary")).toContainText("••••");
  await page.reload();
  const homeAxe = await new AxeBuilder({ page }).analyze();
  const homeSerious = homeAxe.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? "")
  );
  expect(homeSerious, JSON.stringify(homeSerious, null, 2)).toEqual([]);
  await expect(page.locator("#hide-dashboard-amounts")).toBeChecked();
  await expect(page.locator("#home-business-summary")).toContainText("••••");
  await page.locator('#left-navigation-list [data-left-navigation-key="reports"]').click();
  await expect(page.locator("#report-view-select")).toContainText("X2 annual owner view");

  const outputDir = join(process.env.TEMP ?? process.cwd(), "pennywise-x2-evidence");
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({
    path: join(outputDir, "x2-dashboard-hidden-amounts.png"),
    fullPage: true
  });
});
