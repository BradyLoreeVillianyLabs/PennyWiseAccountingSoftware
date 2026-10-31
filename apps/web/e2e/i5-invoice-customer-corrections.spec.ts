import { expect, test } from "@playwright/test";

test("supports invoice correction review and customer lifecycle guards", async ({
  page
}, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));
  test.setTimeout(180_000);

  await page.goto("/");
  await page
    .locator('#local-identity-form input[name="email"]')
    .fill(`i5-${testInfo.project.name}@example.test`);
  await page.getByRole("button", { name: "Continue locally" }).click();
  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("I5 Corrections Ltd.");
  await organization.locator('input[name="displayName"]').fill("I5 Corrections");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");

  const firstRun = page.locator("#invoice-first-run-dialog");
  await firstRun.locator('input[name="addressLine1"]').fill("100 Test Street");
  await firstRun.locator('input[name="city"]').fill("Edmonton");
  await firstRun.locator('input[name="postalCode"]').fill("T5J 0N3");
  await firstRun.locator('input[name="email"]').fill("owner@example.test");
  await firstRun.getByRole("button", { name: "Set up invoicing" }).click();
  await expect(firstRun).toBeHidden({ timeout: 30_000 });

  const salesNavigation = page.locator('#left-navigation-list [data-left-navigation-key="sales"]');
  await salesNavigation.click();
  await page.locator("#workspace-subnavigation button").filter({ hasText: "New invoice" }).click();

  const customerA = "I5 Customer A";
  const customerForm = page.locator("#customer-form");
  await customerForm.locator('input[name="displayName"]').fill(customerA);
  await customerForm.locator('input[name="email"]').fill("a@example.test");
  await customerForm.getByRole("button", { name: "Create customer" }).click();
  await expect(page.locator("#notice")).toHaveText("Customer created.");

  await salesNavigation.click();
  await expect(page.locator("#sales-workspace")).toBeVisible();
  await page.locator("#workspace-subnavigation button").filter({ hasText: "New invoice" }).click();
  const invoiceForm = page.locator("#invoice-form");
  const customerAOption = invoiceForm
    .locator('select[name="customerId"] option')
    .filter({ hasText: customerA });
  await invoiceForm
    .locator('select[name="customerId"]')
    .selectOption(await customerAOption.getAttribute("value"));
  const firstLine = invoiceForm.locator(".invoice-line-row").first();
  await firstLine.locator('[data-line-field="description"]').fill("Correction review service");
  await firstLine.locator('[data-line-field="unitPriceMinor"]').fill("130.00");
  await invoiceForm.getByRole("button", { name: "Create invoice draft and review" }).click();
  await expect(page.locator("#invoice-preview")).toContainText(/CAD 130\.00/i);

  const draftRow = page.locator("#invoices tr").filter({ hasText: customerA }).first();
  await draftRow.getByRole("button", { name: "Edit" }).click();
  await firstLine.locator('[data-line-field="unitPriceMinor"]').fill("140.00");
  await invoiceForm.getByRole("button", { name: "Create invoice draft and review" }).click();
  await expect(page.locator("#invoice-preview")).toContainText(/CAD 140\.00/i);

  const draftReviewRow = page.locator("#invoices tr").filter({ hasText: customerA }).first();
  await draftReviewRow.getByRole("button", { name: "Details" }).click();
  const draftDetail = page.locator("#invoice-detail-dialog");
  await expect(draftDetail).toContainText("Totals and balance");
  await draftDetail.locator('input[type="file"]').setInputFiles({
    name: "correction-note.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("I5 attachment")
  });
  await draftDetail.getByRole("button", { name: "Upload attachment" }).click();
  await expect(draftDetail).toContainText("correction-note.txt");
  await draftDetail.getByRole("button", { name: "Close" }).click();

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator("#invoices tr")
    .filter({ hasText: customerA })
    .first()
    .getByRole("button", { name: "Finalize" })
    .click();
  await expect(page.locator("#notice")).toContainText("Invoice finalized and posted.");

  const postedRow = page.locator("#invoices tr").filter({ hasText: customerA }).first();
  await postedRow.getByRole("button", { name: "Details" }).click();
  const invoiceDetail = page.locator("#invoice-detail-dialog");
  await expect(invoiceDetail).toContainText("Totals and balance");
  await expect(invoiceDetail).toContainText("CAD 140.00");
  await expect(invoiceDetail).toContainText("correction-note.txt");
  await invoiceDetail.getByRole("button", { name: "Close" }).click();

  await postedRow.getByRole("button", { name: "Send from email app" }).click();
  const manualSendDialog = page.locator("#invoice-send-dialog");
  await expect(manualSendDialog).toContainText(
    "Attach the PDF there, then mark this delivery as sent."
  );
  const manualDeliveryResponse = page.waitForResponse((response) =>
    response.url().includes("/manual-delivery")
  );
  await manualSendDialog.getByRole("button", { name: "Mark as sent" }).click();
  const manualDelivery = await manualDeliveryResponse;
  expect(manualDelivery.status()).toBe(201);
  await expect(page.locator("#notice")).toContainText("Manual delivery recorded");

  await postedRow.getByRole("button", { name: "Details" }).click();
  await expect(invoiceDetail).toContainText("a@example.test: MANUAL");
  await invoiceDetail.getByRole("button", { name: "Send again from email app" }).click();
  await expect(manualSendDialog).toBeVisible();
  await manualSendDialog.getByRole("button", { name: "Cancel" }).click();
  await invoiceDetail.getByRole("button", { name: "Close" }).click();

  await postedRow.getByRole("button", { name: "Void" }).click();
  const voidDialog = page.locator("#void-invoice-dialog");
  await voidDialog
    .locator("textarea[name=reason]")
    .fill("Duplicate issued during correction review");
  await voidDialog.getByRole("button", { name: "Void invoice" }).click();
  await expect(page.locator("#notice")).toContainText("Invoice voided");

  const archivedCustomerRow = page.locator("#customers tr").filter({ hasText: customerA }).first();
  page.once("dialog", (dialog) => dialog.accept());
  await archivedCustomerRow.getByRole("button", { name: "Archive" }).click();
  await expect(page.locator("#notice")).toHaveText("Customer archived.");

  const customerB = "I5 Customer B";
  await customerForm.locator('input[name="displayName"]').fill(customerB);
  await customerForm.locator('input[name="email"]').fill("b@example.test");
  await customerForm.getByRole("button", { name: "Create customer" }).click();
  await expect(page.locator("#notice")).toHaveText("Customer created.");
  const customerBRow = page.locator("#customers tr").filter({ hasText: customerB }).first();
  await customerBRow.getByRole("button", { name: "Edit" }).click();
  await customerForm.locator('input[name="displayName"]').fill("I5 Customer B Edited");
  await customerForm.getByRole("button", { name: "Save customer" }).click();
  await expect(page.locator("#notice")).toHaveText("Customer updated.");

  await salesNavigation.click();
  await expect(page.locator("#sales-workspace")).toBeVisible();
  await page.locator("#workspace-subnavigation button").filter({ hasText: "New invoice" }).click();
  const customerBOption = invoiceForm
    .locator('select[name="customerId"] option')
    .filter({ hasText: "I5 Customer B Edited" });
  await invoiceForm
    .locator('select[name="customerId"]')
    .selectOption(await customerBOption.getAttribute("value"));
  const secondLine = invoiceForm.locator(".invoice-line-row").first();
  await secondLine.locator('[data-line-field="description"]').fill("Partial payment credit review");
  await secondLine.locator('[data-line-field="unitPriceMinor"]').fill("200.00");
  await invoiceForm.getByRole("button", { name: "Create invoice draft and review" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator("#invoices tr")
    .filter({ hasText: "I5 Customer B Edited" })
    .first()
    .getByRole("button", { name: "Finalize" })
    .click();
  await expect(page.locator("#notice")).toContainText("Invoice finalized and posted.");

  const liveCustomerBRow = page
    .locator("#customers tr")
    .filter({ hasText: "I5 Customer B Edited" })
    .first();
  await liveCustomerBRow.getByRole("button", { name: "Archive" }).click();
  await expect(page.locator("#notice")).toContainText(
    "cannot be archived while an open receivables balance remains"
  );

  const secondInvoiceRow = page
    .locator("#invoices tr")
    .filter({ hasText: "I5 Customer B Edited" })
    .first();
  await secondInvoiceRow.getByRole("button", { name: "Record payment" }).click();
  const paymentDialog = page.locator("#record-invoice-payment-dialog");
  await paymentDialog.locator('input[name="amountMinor"]').fill("50.00");
  await paymentDialog.locator('input[name="allocationMinor"]').fill("50.00");
  await paymentDialog.getByRole("button", { name: "Record payment" }).click();
  await expect(page.locator("#notice")).toContainText("Payment recorded and allocated");

  const partiallyPaidRow = page
    .locator("#invoices tr")
    .filter({ hasText: "I5 Customer B Edited" })
    .first();
  await partiallyPaidRow.getByRole("button", { name: "Credit note" }).click();
  const creditDialog = page.locator("#credit-note-dialog");
  await creditDialog
    .locator('textarea[name="reason"]')
    .fill("Customer correction after partial payment");
  await creditDialog.locator('input[name="fullCredit"]').uncheck();
  await expect(creditDialog.locator("#credit-note-line-selection")).toBeVisible();
  await creditDialog.locator("[data-credit-line-amount]").first().fill("150.00");
  await creditDialog.getByRole("button", { name: /Create and post credit note/i }).click();
  await expect(page.locator("#notice")).toContainText(/credit note posted/i);
  await expect(
    page.locator("#invoices tr").filter({ hasText: "I5 Customer B Edited" }).first()
  ).toContainText("Paid");

  page.once("dialog", (dialog) => dialog.accept());
  await page
    .locator("#customers tr")
    .filter({ hasText: "I5 Customer B Edited" })
    .first()
    .getByRole("button", { name: "Archive" })
    .click();
  await expect(page.locator("#notice")).toHaveText("Customer archived.");
});
