import { expect, test } from "@playwright/test";

test("owner workspace keeps core work compact and makes contracts, email, and invoice styling usable", async ({
  page
}, testInfo) => {
  test.skip(!["chrome", "chromium"].includes(testInfo.project.name));
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  const failedResponses: Array<{ status: number; path: string }> = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`PAGEERROR: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failedResponses.push({ status: response.status(), path: new URL(response.url()).pathname });
  });

  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await expect(localIdentity).toBeVisible();
  await localIdentity
    .locator('input[name="email"]')
    .fill(`owner-contracts-${testInfo.project.name}@example.test`);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("Owner Workflow Test Ltd.");
  await organization.locator('input[name="displayName"]').fill("Owner Workflow Test");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();
  await expect(page.locator("#left-navigation-pane")).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 800 });
  const headerLayout = await page.locator(".app-header").evaluate((header) => ({
    clientWidth: header.clientWidth,
    height: header.getBoundingClientRect().height,
    scrollWidth: header.scrollWidth
  }));
  expect(headerLayout.height).toBeLessThanOrEqual(57);
  expect(headerLayout.scrollWidth).toBeLessThanOrEqual(headerLayout.clientWidth + 1);
  await expect(page.locator(".app-header #workspace-navigation")).toBeHidden();
  await expect(page.locator("#left-navigation-pane")).toBeVisible();
  await expect(page.locator(".app-header #organization-toolbar select")).toHaveCount(1);
  await expect(page.locator(".app-header #company-select")).toBeVisible();
  await expect(page.locator(".app-header #organization-select")).toBeHidden();
  await expect(page.locator(".app-header #settings-menu > summary")).toBeHidden();
  await expect(page.locator(".app-header #appearance-menu > summary")).toBeHidden();
  await expect(page.locator(".app-header .brand-logo")).toHaveAttribute(
    "src",
    "/icons/clearledger.svg"
  );
  await expect(page.locator("#left-navigation-settings")).toBeVisible();
  await page.locator("#left-navigation-settings").click();
  await expect(page.locator("#settings-menu")).toHaveAttribute("open", "");
  await expect(page.locator("#settings-menu .settings-panel")).toBeVisible();
  await expect(page.locator("#left-navigation-settings")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#settings-menu")).not.toHaveAttribute("open", "");
  await expect(page.locator("#left-navigation-settings")).toBeFocused();

  const ownerMode = page.locator('#workspace-mode-switch [data-workspace-mode="owner"]');
  await expect(ownerMode).toBeVisible();
  await ownerMode.click();
  await expect(page.locator("#owner-workspace")).toBeVisible();
  await expect(page.locator("#owner-workspace")).toContainText("Run today");
  const titleAccentWidth = await page
    .locator("#owner-heading")
    .evaluate((heading) => getComputedStyle(heading, "::before").width);
  expect(titleAccentWidth).toBe("5px");

  const layoutStorageBefore = await page.evaluate(() =>
    localStorage.getItem("pennywise_layout_customizations_v1")
  );
  await page.locator("#left-navigation-layout").click();
  const layoutCustomizer = page.locator("#layout-customizer");
  await expect(layoutCustomizer).toBeVisible();
  const firstLayoutSlider = layoutCustomizer.locator('input[type="range"]').first();
  await expect(firstLayoutSlider).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pennywise_layout_customizations_v1")))
    .toBe(layoutStorageBefore);
  await firstLayoutSlider.press("ArrowRight");
  await expect(page.locator("#layout-customizer-status")).toContainText("layout saved");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("pennywise_layout_customizations_v1")))
    .not.toBe(layoutStorageBefore);
  await page.locator("#layout-reset-current").click();
  await expect(page.locator("#layout-customizer-status")).toContainText(
    "column proportions were reset"
  );
  await layoutCustomizer.getByRole("button", { name: "Close" }).click();

  const journalControlStyle = await page
    .locator("#manual-journal-lines input")
    .first()
    .evaluate((input) => {
      const style = getComputedStyle(input);
      return { fontSize: style.fontSize, minHeight: style.minHeight };
    });
  expect(journalControlStyle).toEqual({ fontSize: "12px", minHeight: "30px" });

  await page.locator("#global-create-menu summary").click();
  await page
    .locator("#global-create-menu")
    .getByRole("button", { name: "Bulk invoice or bill entry" })
    .click();
  const bulkEntry = page.locator("#bulk-entry-section");
  await expect(bulkEntry).toBeVisible();
  const bulkControlStyle = await bulkEntry
    .locator("input")
    .first()
    .evaluate((input) => {
      const style = getComputedStyle(input);
      return { fontSize: style.fontSize, minHeight: style.minHeight };
    });
  expect(bulkControlStyle).toEqual({ fontSize: "12px", minHeight: "30px" });
  page.once("dialog", (dialog) => void dialog.accept());
  await bulkEntry.locator('[data-window-action="close"]').click();
  await expect(bulkEntry).toBeHidden();

  await page.locator('#left-navigation-list [data-left-navigation-key="sales"]').click();
  await page.locator("#customer-form .spreadsheet-entry-launch").click();
  const spreadsheetDialog = page.locator("#spreadsheet-entry-dialog");
  await expect(spreadsheetDialog).toBeVisible();
  const spreadsheetControlStyle = await spreadsheetDialog
    .locator("input")
    .first()
    .evaluate((input) => {
      const style = getComputedStyle(input);
      return { fontSize: style.fontSize, minHeight: style.minHeight };
    });
  expect(spreadsheetControlStyle).toEqual({ fontSize: "12px", minHeight: "30px" });
  await spreadsheetDialog.getByRole("button", { name: "Close" }).click();
  await page.locator('#left-navigation-list [data-left-navigation-key="owner"]').click();

  await expect(page.locator("#owner-workspace [data-owner-action=contract]")).toBeVisible();
  await page.locator("#owner-workspace [data-owner-action=contract]").click();
  await expect(page.locator("#contracts-workspace")).toBeVisible();
  const contractForm = page.locator("#contract-form");
  const starterSelect = page.locator("#contract-starter-select");
  await expect(starterSelect.locator("option")).toHaveCount(4);
  await starterSelect.selectOption("starter:work-authorization");
  await expect(page.locator("#contract-source-link")).toHaveAttribute(
    "href",
    "https://www.alberta.ca/hiring-contractor"
  );
  await expect(page.locator("#save-contract-draft")).toBeEnabled();
  await page.locator("#save-contract-draft").click();
  await expect(page.locator("#notice")).toHaveText("Contract draft created.");

  const requiredValues: Record<string, string> = {
    agreementDate: "2026-08-12",
    companyName: "Owner Workflow Test Ltd.",
    customerName: "Northside Homeowner",
    workLocation: "123 Test Avenue, Edmonton, AB",
    scopeOfWork: "Replace and weatherproof the rear entry door.",
    contractAmount: "2450.00",
    paymentSchedule: "50% deposit, balance on completion.",
    changeApproval: "Both parties approve written changes before work begins."
  };
  for (const [key, value] of Object.entries(requiredValues))
    await contractForm.locator(`[name="contractVariable:${key}"]`).fill(value);
  await page.locator("#save-contract-draft").click();
  await expect(page.locator("#notice")).toHaveText("Contract draft saved.");
  await expect(page.locator("#contract-preview")).toContainText("Northside Homeowner");

  await page.locator("#mark-contract-ready").click();
  await expect(page.locator("#notice")).toContainText(
    "Confirm the legal and jurisdictional review"
  );
  await contractForm.locator('input[name="legalReviewAcknowledged"]').check();
  await page.locator("#mark-contract-ready").click();
  await expect(page.locator("#notice")).toHaveText(
    "Contract marked ready for review. It was not sent or signed automatically."
  );
  await expect(page.locator("#contract-save-status")).toContainText("Ready for review");
  await page.locator("#print-contract").click();
  await expect(page.locator("iframe.contract-print-frame")).toHaveCount(1);

  await page.locator('#left-navigation-list [data-left-navigation-key="integrations"]').click();
  await expect(page.locator("#integrations-workspace")).toBeVisible();
  const emailConnections = page.locator("#email-connections-list");
  await expect(emailConnections).toContainText("Gmail");
  await expect(emailConnections).toContainText("Microsoft Outlook / Hotmail");
  await expect(page.locator(".email-connections-panel")).toContainText(
    "Nothing is sent automatically"
  );

  await page.locator('#left-navigation-list [data-left-navigation-key="sales"]').click();
  await page.locator(".invoice-appearance-panel > summary").click();
  const invoiceTemplateForm = page.locator("#invoice-template-form");
  await expect(invoiceTemplateForm).toBeVisible();
  await invoiceTemplateForm.locator('input[name="headingFontSize"]').fill("34");
  await invoiceTemplateForm.locator('input[name="bodyFontSize"]').fill("12");
  await invoiceTemplateForm
    .locator('select[name="backgroundTreatment"]')
    .selectOption("brand-wash");
  await invoiceTemplateForm.getByRole("button", { name: "Save & refresh exact preview" }).click();
  await expect(page.locator("#notice")).toHaveText("Invoice template saved.");
  await expect(invoiceTemplateForm.locator('input[name="headingFontSize"]')).toHaveValue("34");
  await expect(invoiceTemplateForm.locator('select[name="backgroundTreatment"]')).toHaveValue(
    "brand-wash"
  );

  expect({ consoleErrors, failedResponses }).toEqual({ consoleErrors: [], failedResponses: [] });
});
