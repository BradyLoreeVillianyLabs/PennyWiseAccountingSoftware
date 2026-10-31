import { expect, test } from "@playwright/test";

test("finalized invoice shows offline payment instructions and records a receipt", async ({
  page
}, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));
  test.setTimeout(120_000);

  await page.goto("/");
  await page
    .locator('#local-identity-form input[name="email"]')
    .fill(`i3-${testInfo.project.name}@example.test`);
  await page.getByRole("button", { name: "Continue locally" }).click();
  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("I3 Offline Payments Ltd.");
  await organization.locator('input[name="displayName"]').fill("I3 Offline Payments");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");

  const firstRun = page.locator("#invoice-first-run-dialog");
  await firstRun.locator('input[name="addressLine1"]').fill("100 Test Street");
  await firstRun.locator('input[name="city"]').fill("Edmonton");
  await firstRun.locator('input[name="postalCode"]').fill("T5J 0N3");
  await firstRun.locator('input[name="email"]').fill("owner@example.test");
  await firstRun.getByRole("button", { name: "Set up invoicing" }).click();
  await expect(firstRun).toBeHidden({ timeout: 30_000 });

  const paymentsNavigation = page.getByRole("button", { name: "Open Payments & refunds" });
  await expect(paymentsNavigation).toBeVisible();
  await paymentsNavigation.click();
  await expect(page.locator("#payments-workspace")).toBeVisible({ timeout: 30_000 });
  const instructions = page.locator("#payment-instructions-form");
  await expect(instructions).toBeVisible();
  await instructions.locator('input[name="methodKey"][value="E_TRANSFER"]').check();
  await instructions.locator('input[name="eTransferEmail"]').fill("payments@example.test");
  await instructions.locator('input[name="eTransferAutodeposit"]').check({ force: true });
  await expect(instructions.locator('input[name="eTransferAutodeposit"]')).toBeChecked();
  await instructions.locator('input[name="methodKey"][value="CASH"]').check();
  await instructions.getByRole("button", { name: "Save payment instructions" }).click();
  await expect(page.locator("#payment-instructions-status")).toHaveText(
    "Payment instructions saved."
  );

  await page.locator('#left-navigation-list [data-left-navigation-key="sales"]').click();
  await page.locator("#workspace-subnavigation button").filter({ hasText: "New invoice" }).click();
  const invoice = page.locator("#invoice-form");
  await invoice.getByRole("button", { name: "+ Add customer" }).click();
  const customerDialog = page.locator("#quick-create-dialog");
  await customerDialog.locator('input[name="customerName"]').fill("I3 Customer");
  await customerDialog.getByRole("button", { name: "Create and return to invoice" }).click();
  await expect(customerDialog).toBeHidden();
  const transferMethod = invoice.locator(
    'input[name="paymentMethodSelection"][value="E_TRANSFER"]'
  );
  const cashMethod = invoice.locator('input[name="paymentMethodSelection"][value="CASH"]');
  await expect(transferMethod).toHaveCount(1);
  await transferMethod.check({ force: true });
  await expect(cashMethod).not.toBeChecked();
  const line = invoice.locator(".invoice-line-row").first();
  await line.locator('[data-line-field="description"]').fill("Offline service");
  await line.locator('[data-line-field="unitPriceMinor"]').fill("125.00");
  await invoice.getByRole("button", { name: "Create invoice draft and review" }).click();
  await expect(page.locator("#invoice-preview")).toContainText(/CAD 125\.00/i);

  const draftRow = page.locator("#invoices tr").filter({ hasText: "I3 Customer" }).first();
  page.once("dialog", (dialog) => void dialog.accept());
  await draftRow.getByRole("button", { name: "Finalize" }).click();
  await expect(page.locator("#notice")).toContainText("Invoice finalized and posted.");
  await expect(
    page.locator("#invoice-document-preview iframe").contentFrame().getByText("How to pay")
  ).toBeVisible();
  await expect(
    page
      .locator("#invoice-document-preview iframe")
      .contentFrame()
      .getByText("payments@example.test")
  ).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).last().click();
  const paymentDialog = page.locator("#record-invoice-payment-dialog");
  await expect(paymentDialog).toBeVisible();
  await paymentDialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.locator("#notice")).toContainText("Payment recorded and allocated");
  await expect(
    page.locator("#invoices tr").filter({ hasText: "I3 Customer" }).first()
  ).toContainText("Paid");
});
