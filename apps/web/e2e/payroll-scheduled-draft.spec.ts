import { expect, test } from "@playwright/test";

test("an accountant can prepare and calculate a controlled CA-AB payroll draft without payment or filing", async ({
  page
}, testInfo) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const isMobile = testInfo.project.name.startsWith("mobile-");
  const openLeftNavigation = async () => {
    if (isMobile && !(await page.locator("#left-navigation-pane").isVisible()))
      await page.getByRole("button", { name: "Open navigation pane" }).click();
  };

  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await expect(localIdentity).toBeVisible();
  await localIdentity
    .locator('input[name="email"]')
    .fill(`payroll-workflow-${testInfo.project.name}@example.test`);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();
  const organization = page.locator("#organization-form");
  await expect(organization).toBeVisible();
  await organization.locator('input[name="legalName"]').fill("Payroll browser test Ltd");
  await organization.locator('input[name="displayName"]').fill("Payroll browser test");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();
  await expect(page.locator("#setup-workspace")).toBeVisible();
  await page.getByRole("button", { name: /^\d+\. Preset$/ }).click();
  const preset = page.locator("#preset-form");
  await preset.locator('select[name="presetKey"]').selectOption("general-service");
  await preset.getByRole("button", { name: "Apply preset" }).click();
  await expect(page.locator("#notice")).toHaveText("Account preset applied.");

  await openLeftNavigation();
  const workspaceModeSwitch = isMobile ? "#left-navigation-mode-switch" : "#workspace-mode-switch";
  await page.locator(`${workspaceModeSwitch} [data-workspace-mode="accountant"]`).click();
  await page.locator('#left-navigation-list [data-left-navigation-key="payroll"]').click();

  const payroll = page.locator("#payroll-workspace");
  await expect(payroll).toBeVisible();
  await expect(payroll).toContainText(
    "PennyWise Accounting does not move payroll funds or file taxes."
  );
  await expect(payroll).toContainText("Direct deposit and filing are not connected");

  const setup = page.locator("#payroll-settings-form");
  const expense = setup.locator('select[name="defaultExpenseAccountId"]');
  const remittance = setup.locator('select[name="defaultLiabilityAccountId"]');
  const clearing = setup.locator('select[name="netPayClearingAccountId"]');
  await expect(expense).toBeEnabled();
  await expect(remittance).toBeEnabled();
  await expect(clearing).toBeEnabled();
  await expense.selectOption({ index: 1 });
  await remittance.selectOption({ index: 1 });
  await clearing.selectOption({ index: 2 });
  await setup.getByRole("button", { name: "Save payroll setup" }).click();
  await expect(page.locator("#notice")).toContainText("Payroll setup saved");
  await expect(page.locator("#ensure-ca-ab-payroll-codes")).toBeEnabled();
  await page.locator("#ensure-ca-ab-payroll-codes").click();
  await expect(page.locator("#notice")).toContainText(/base payroll code|already present/);
  await expect(page.locator("#payroll-code-status")).toContainText("CA-AB base code set is ready");

  const worker = page.locator("#payroll-worker-form");
  await worker.locator('input[name="workerNumber"]').fill("E-100");
  await worker.locator('input[name="displayName"]').fill("Avery Payroll");
  await worker.locator('input[name="effectiveFrom"]').fill("2026-01-01");
  await worker.locator('input[name="rate"]').fill("52000.00");
  await worker.getByRole("button", { name: "Add worker" }).click();
  await expect(page.locator("#notice")).toContainText("Payroll worker added");
  await expect(page.locator("#payroll-workers")).toContainText("Avery Payroll");
  await expect(page.locator("#payroll-workers")).toContainText(
    "No identifier or bank data in this browser"
  );

  const schedule = page.locator("#payroll-schedule-form");
  await schedule.locator('input[name="code"]').fill("BIWEEKLY");
  await schedule.locator('input[name="name"]').fill("Biweekly staff");
  await schedule.locator('input[name="anchorPayDate"]').fill("2026-08-14");
  await schedule.getByRole("button", { name: "Add pay schedule" }).click();
  await expect(page.locator("#notice")).toContainText("Pay schedule added");

  const draft = page.locator("#payroll-scheduled-draft-form");
  await draft.locator('select[name="scheduleId"]').selectOption({ index: 1 });
  await draft.locator('input[name="periodStart"]').fill("2026-08-01");
  await draft.locator('input[name="periodEnd"]').fill("2026-08-14");
  await draft.locator('input[name="payDate"]').fill("2026-08-14");
  await draft.locator('input[name="sequence"]').fill("1");
  await draft.getByRole("button", { name: "Prepare payroll draft" }).click();
  await expect(page.locator("#notice")).toContainText("Payroll draft prepared");
  await expect(page.locator("#payroll-run-detail")).toBeVisible();
  await expect(page.locator("#payroll-run-detail")).toContainText(/Draft/i);
  await expect(page.locator("#payroll-run-workers")).toContainText("CAD 2,000.00");
  await expect(page.locator("#payroll-run-detail")).toContainText(
    "does not post, pay, or file anything"
  );

  await page.getByRole("button", { name: "Calculate payroll" }).click();
  await expect(page.locator("#notice")).toContainText("Payroll calculated for review");
  await expect(page.locator("#payroll-run-detail")).toContainText(/Calculated/i);
  await expect(page.getByRole("button", { name: "Mark reviewed" })).toBeVisible();
  expect(browserErrors).toEqual([]);
});
