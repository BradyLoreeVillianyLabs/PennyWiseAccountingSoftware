import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function createLocalWorkspace(page: Page, testInfo: TestInfo, suffix: string) {
  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await localIdentity
    .locator('input[name="email"]')
    .fill(`contextual-${suffix}-${testInfo.project.name}@example.test`);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill(`Context ${suffix} Ltd.`);
  await organization.locator('input[name="displayName"]').fill(`Context ${suffix}`);
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();

  await page.locator('#left-navigation-list [data-left-navigation-key="sales"]').click();
  await expect(page.locator("#sales-workspace")).toBeVisible();
}

test("invoice contextual customer creation returns to the draft with the customer selected", async ({
  page
}, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));
  await createLocalWorkspace(page, testInfo, "customer");

  const invoice = page.locator("#invoice-form");
  await expect(invoice).toBeVisible();
  await invoice.locator('input[name="quantity"]').fill("2");
  await invoice.locator('input[name="unitPriceMinor"]').fill("125.00");
  await invoice.getByRole("button", { name: "+ Add customer" }).click();

  const dialog = page.locator("#quick-create-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('input[name="customerName"]').fill("Contextual Customer");
  await dialog.locator('input[name="customerEmail"]').fill(`payer-customer@example.test`);
  await dialog.getByRole("button", { name: "Create and return to invoice" }).click();

  await expect(page.locator("#notice")).toHaveText("Customer created and selected.");
  await expect(invoice).toBeVisible();
  await expect(invoice.locator('select[name="customerId"] option:checked')).toContainText(
    "Contextual Customer"
  );
  await expect(invoice.locator('input[name="quantity"]')).toHaveValue("2");
  await expect(invoice.locator('input[name="unitPriceMinor"]')).toHaveValue("125.00");
  await expect(dialog).toBeHidden();
});

test("contextual revenue account and product creation return to the product and invoice forms", async ({
  page
}, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));
  await createLocalWorkspace(page, testInfo, "account");

  const product = page.locator("#product-form");
  await expect(product).toBeVisible();
  await product.getByRole("button", { name: "+ Add revenue account" }).click();

  const dialog = page.locator("#contextual-account-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('select[name="type"]')).toHaveValue("REVENUE");
  await dialog.locator('input[name="code"]').fill("4100");
  await dialog.locator('input[name="name"]').fill("Contextual Revenue");
  await dialog.getByRole("button", { name: "Create account and return" }).click();

  await expect(page.locator("#notice")).toHaveText("Account 4100 created and selected.");
  await expect(dialog).toBeHidden();
  await expect(product.locator('select[name="incomeAccountId"] option:checked')).toHaveText(
    "4100 Contextual Revenue"
  );

  const invoice = page.locator("#invoice-form");
  await invoice.getByRole("button", { name: "+ Create item" }).click();
  const quickProduct = page.locator("#quick-create-dialog");
  await expect(quickProduct).toBeVisible();
  await quickProduct.locator('input[name="productName"]').fill("Contextual Service");
  await quickProduct.locator('input[name="productPrice"]').fill("75.00");
  await quickProduct
    .locator('select[name="productIncomeAccount"]')
    .selectOption({ label: "4100 Contextual Revenue" });
  await quickProduct.getByRole("button", { name: "Create and return to invoice" }).click();

  await expect(page.locator("#notice")).toHaveText("Product or service created and selected.");
  await expect(invoice.locator('[data-line-field="item"]')).toHaveValue(/Contextual Service/);
  await expect(quickProduct).toBeHidden();

  await product.getByRole("button", { name: "+ Add tax code" }).click();
  const taxCode = page.locator("#tax-code-form");
  await expect(page.locator("#setup-workspace")).toBeVisible();
  await expect(taxCode).toBeVisible();
  await expect(page.locator("#cancel-contextual-tax-code")).toBeVisible();
  await taxCode.locator('input[name="code"]').fill("CTX-ZERO");
  await taxCode.locator('input[name="name"]').fill("Contextual zero-rated tax");
  await taxCode.locator('select[name="treatment"]').selectOption("ZERO_RATED");
  await taxCode.locator('input[name="effectiveFrom"]').fill("2026-09-11");
  await taxCode.locator('input[name="sourceName"]').fill("Contextual test source");
  await taxCode.locator('input[name="sourceRetrievedAt"]').fill("2026-09-11");
  await taxCode.getByRole("button", { name: "Save tax code version" }).click();

  await expect(page.locator("#notice")).toHaveText("Tax code CTX-ZERO saved.");
  await expect(page.locator("#sales-workspace")).toBeVisible();
  await expect(product.locator('select[name="defaultTaxCodeId"] option:checked')).toHaveText(
    "CTX-ZERO | Contextual zero-rated tax"
  );
  await expect(page.locator("#cancel-contextual-tax-code")).toBeHidden();
});

test("bill contextual supplier and expense-account creation return to the preserved bill", async ({
  page
}, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));
  await createLocalWorkspace(page, testInfo, "purchases");
  await page.locator("#global-create-menu > summary").click();
  await page
    .locator('[data-create-workspace="purchases-workspace"][data-create-target="bill-form"]')
    .click();

  const bill = page.locator("#bill-form");
  await expect(bill).toBeVisible();
  await bill.locator('input[name="vendorInvoiceNumber"]').fill("CTX-BILL-1");
  await bill.locator('input[name="description"]').fill("Contextual supplier bill");
  await bill.getByRole("button", { name: "+ Add supplier" }).click();

  const vendor = page.locator("#vendor-form");
  await expect(vendor).toBeVisible();
  await expect(vendor.getByRole("button", { name: "Return to draft" })).toBeVisible();
  await vendor.locator('input[name="vendorNumber"]').fill("CTX-VENDOR-1");
  await vendor.locator('input[name="legalName"]').fill("Contextual Supplier Ltd.");
  await vendor.locator('input[name="displayName"]').fill("Contextual Supplier");
  await vendor.getByRole("button", { name: "Create vendor" }).click();

  await expect(page.locator("#notice")).toHaveText("Vendor created.");
  await expect(bill.locator('select[name="vendorId"] option:checked')).toHaveText(
    "CTX-VENDOR-1 | Contextual Supplier"
  );
  await expect(bill.locator('input[name="vendorInvoiceNumber"]')).toHaveValue("CTX-BILL-1");
  await expect(vendor.getByRole("button", { name: "Return to draft" })).toBeHidden();

  await bill.getByRole("button", { name: "+ Add expense or asset account" }).click();
  const dialog = page.locator("#contextual-account-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('select[name="type"]')).toHaveValue("EXPENSE");
  await dialog.locator('input[name="code"]').fill("6100");
  await dialog.locator('input[name="name"]').fill("Contextual Expense");
  await dialog.getByRole("button", { name: "Create account and return" }).click();

  await expect(page.locator("#notice")).toHaveText("Account 6100 created and selected.");
  await expect(bill.locator('select[name="accountId"] option:checked')).toHaveText(
    "6100 Contextual Expense"
  );
  await expect(bill.locator('input[name="description"]')).toHaveValue("Contextual supplier bill");
});
