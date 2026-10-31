import { expect, test } from "@playwright/test";

test("appearance and dashboard choices apply, persist, and reset", async ({ page }, testInfo) => {
  test.skip(!["chrome", "chromium"].includes(testInfo.project.name));

  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  const localTestAccounts = page.locator("#local-test-account-picker");
  await expect(localTestAccounts).toBeVisible();
  await localTestAccounts.getByRole("button", { name: /Owner sample/ }).click();
  await expect(localIdentity.locator('input[name="email"]')).toHaveValue("owner@example.test");
  await localIdentity.locator('input[name="email"]').fill("appearance-owner@example.test");
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("Appearance Test Company Ltd");
  await organization.locator('input[name="displayName"]').fill("Appearance Test Company");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();

  await page.locator("#left-navigation-settings").click();
  await page
    .locator("#settings-menu")
    .getByRole("button", { name: "Company settings", exact: true })
    .click();
  const profile = page.locator("#profile-form");
  await profile.locator('input[name="businessType"]').fill("Professional services");
  await profile.getByRole("button", { name: "Save profile" }).click();
  await expect(page.locator("#notice")).toHaveText("Settings saved.");
  await page.getByRole("button", { name: /^\d+\. Fiscal$/ }).click();
  const fiscal = page.locator("#fiscal-form");
  await fiscal.locator('input[name="baseCurrency"]').fill("CAD");
  await fiscal.locator('input[name="accountingStartDate"]').fill("2026-01-01");
  await fiscal.locator('input[name="fiscalYearEndDate"]').fill("2026-12-31");
  await fiscal.getByRole("button", { name: "Save and initialize fiscal year" }).click();
  await expect(page.locator("#notice")).toHaveText(
    "Fiscal settings saved and first fiscal year initialized."
  );
  await page.getByRole("button", { name: /^\d+\. Preset$/ }).click();
  const preset = page.locator("#preset-form");
  await preset.locator('select[name="presetKey"]').selectOption("general-service");
  await preset.getByRole("button", { name: "Apply preset" }).click();
  await expect(page.locator("#notice")).toHaveText("Account preset applied.");
  await page.locator('#left-navigation-list [data-left-navigation-key="home"]').click();

  await expect(page.locator("#home-data-status")).toContainText("Dashboard updated", {
    timeout: 30_000
  });
  await page.locator("#books-health-severity-filter").selectOption("WARNING");
  await expect(page.locator("#books-health-severity-filter")).toHaveValue("WARNING");
  await page.locator("#books-health-severity-filter").selectOption("ALL");
  await page.locator("#home-as-of-input").fill("2026-03-31");
  await page.locator("#home-as-of-input").press("Tab");
  await expect(page.locator("#home-as-of-input")).toHaveValue("2026-03-31");
  await expect(page.locator("#home-data-status")).toContainText("Dashboard updated", {
    timeout: 30_000
  });
  await page.locator("#home-business-summary .summary-value").first().click();
  await expect(page.locator("#reports-workspace")).toBeVisible();
  await expect(page.locator('#report-filter-form select[name="reportName"]')).toHaveValue(
    "banking"
  );
  await expect(page.locator('#report-filter-form input[name="asOf"]')).toHaveValue("2026-03-31");
  await page.locator("#report-compare-enabled").check();
  await expect(page.locator("#report-comparison")).toContainText("Compared with", {
    timeout: 30_000
  });
  await page.locator('#left-navigation-list [data-left-navigation-key="home"]').click();
  await page.reload();
  await expect(page.locator("#home-as-of-input")).toHaveValue("2026-03-31");

  await page.locator("#left-navigation-appearance").click();
  await page.locator("#theme-select").selectOption("ocean");
  await page.locator("#density-select").selectOption("spacious");
  await page.locator("#text-scale-select").selectOption("extra-large");
  await page.locator("#content-width-select").selectOption("wide");
  await page.locator("#motion-select").selectOption("reduce");
  await page.locator("#appearance-menu").getByRole("button", { name: "Done" }).click();
  await expect(page.locator("#appearance-menu")).not.toHaveAttribute("open", "");
  await expect(page.locator("#appearance-status")).toHaveText("Appearance saved in this browser.");
  await page.getByRole("button", { name: "Configure dashboard" }).click();
  await page.locator("#dashboard-layout-select").selectOption("single");
  await page.locator('[data-dashboard-visible="cash"]').uncheck();
  await page.locator('[data-dashboard-visible="booksHealth"]').uncheck();
  await page.locator('[data-dashboard-size="attention"]').selectOption("wide");
  await page.locator('[data-dashboard-action="down"][data-dashboard-key="summary"]').click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await expect(page.locator("html")).toHaveAttribute("data-density", "spacious");
  await expect(page.locator("html")).toHaveAttribute("data-text-scale", "extra-large");
  await expect(page.locator("html")).toHaveAttribute("data-content-width", "wide");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  await expect(page.locator("html")).toHaveAttribute("data-dashboard-layout", "single");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#155e99");
  await expect(page.locator("#home-cash-section")).toHaveAttribute("hidden", "");
  await expect(page.locator("#books-health-card")).toHaveAttribute("hidden", "");
  await expect(page.locator("#home-attention-section")).toHaveAttribute(
    "data-dashboard-tile-size",
    "wide"
  );
  await expect(
    page.locator("#workspace-subnavigation").getByRole("button", { name: "Cash & tax" })
  ).toHaveCount(0);
  await expect(page.locator("#appearance-status")).toHaveText("Business summary moved down.");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "ocean");
  await expect(page.locator("html")).toHaveAttribute("data-dashboard-layout", "single");
  await expect(page.locator("#home-cash-section")).toHaveAttribute("hidden", "");
  await expect(page.locator("#books-health-card")).toHaveAttribute("hidden", "");

  await page.setViewportSize({ width: 900, height: 320 });
  await page.locator("#global-create-menu summary").click();
  const createPanelBox = await page
    .locator("#global-create-menu .global-create-panel")
    .boundingBox();
  if (!createPanelBox) throw new Error("The constrained New panel was not rendered.");
  expect(createPanelBox.x).toBeGreaterThanOrEqual(0);
  expect(createPanelBox.y).toBeGreaterThanOrEqual(0);
  expect(createPanelBox.x + createPanelBox.width).toBeLessThanOrEqual(900);
  expect(createPanelBox.y + createPanelBox.height).toBeLessThanOrEqual(320);
  await page.locator('#left-navigation-list [data-left-navigation-key="home"]').click();
  await expect(page.locator("#global-create-menu")).not.toHaveAttribute("open", "");
  await page.locator("#global-create-menu summary").click();
  await page.locator("#left-navigation-settings").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#global-create-menu")).not.toHaveAttribute("open", "");
  await expect(page.locator("#settings-menu")).toHaveAttribute("open", "");
  await page.locator("#left-navigation-appearance").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#settings-menu")).not.toHaveAttribute("open", "");
  const appearancePanelBox = await page.locator("#appearance-menu .appearance-panel").boundingBox();
  if (!appearancePanelBox) throw new Error("The open appearance panel was not rendered.");
  expect(appearancePanelBox.y).toBeGreaterThanOrEqual(0);
  expect(appearancePanelBox.y + appearancePanelBox.height).toBeLessThanOrEqual(320);
  await page.locator("#appearance-menu").getByRole("button", { name: "Done" }).click();
  await page.locator("#left-navigation-appearance").click();
  await page.locator('#left-navigation-list [data-left-navigation-key="home"]').click();
  await expect(page.locator("#appearance-menu")).not.toHaveAttribute("open", "");
  await expect(page.locator("#overview-workspace")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.locator("#left-navigation-appearance").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#appearance-menu")).not.toHaveAttribute("open", "");
  await expect(page.locator("#left-navigation-appearance")).toBeFocused();

  await page.getByRole("button", { name: "Configure dashboard" }).click();
  await page.locator("#reset-dashboard-layout").click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.locator("#left-navigation-appearance").click();
  await page.locator("#reset-display-preferences").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-dashboard-layout", "balanced");
  await expect(page.locator("#home-cash-section")).not.toHaveAttribute("hidden", "");
  await expect(page.locator("#books-health-card")).not.toHaveAttribute("hidden", "");
  await expect(page.locator("#appearance-status")).toHaveText(
    "Default appearance and dashboard restored."
  );
});
