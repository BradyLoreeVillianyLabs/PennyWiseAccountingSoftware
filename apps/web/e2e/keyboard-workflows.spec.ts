import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const statementPath = fileURLToPath(new URL("./fixtures/statement.csv", import.meta.url));
const statementFile = {
  name: "statement.csv",
  mimeType: "text/csv",
  buffer: readFileSync(statementPath)
};

function onlyChromium(testInfo: { project: { name: string } }) {
  test.skip(
    !["chromium", "chrome", "edge", "mobile-chromium", "mobile-chrome"].includes(
      testInfo.project.name
    ),
    "Focused keyboard contract runs on Chromium; the browser matrix remains covered by the existing release suite."
  );
}

async function pressEnter(locator: ReturnType<import("@playwright/test").Page["locator"]>) {
  await locator.focus();
  await locator.press("Enter");
}

async function chooseByKeyboard(
  locator: ReturnType<import("@playwright/test").Page["locator"]>,
  index = 0
) {
  await locator.focus();
  await locator.press("Home");
  for (let step = 0; step < index; step += 1) await locator.press("ArrowDown");
  await locator.press("Enter");
}

async function createDemoWorkspace(
  page: import("@playwright/test").Page,
  testInfo: { project: { name: string } }
) {
  await page.goto("/");
  const email = `keyboard-${testInfo.project.name}-${String(Date.now())}@example.test`;
  const identity = page.locator("#local-identity-form");
  await expect(identity).toBeVisible();
  await identity.locator('input[name="email"]').fill(email);
  await pressEnter(identity.getByRole("button", { name: "Continue locally" }));
  const demo = page.locator(".demo-company-option");
  await expect(demo).toBeVisible();
  await pressEnter(demo.getByRole("button", { name: "Create demo company" }));
  await expect(page.locator("#notice")).toContainText("Fictional is ready", { timeout: 90_000 });
}

async function openWorkspace(page: import("@playwright/test").Page, workspaceId: string) {
  const openAccountant = page.locator("#open-accountant-workspace");
  if (await openAccountant.isVisible()) await pressEnter(openAccountant);
  const button = page.locator(
    `#left-navigation-list button[data-workspace-target="${workspaceId}"]`
  );
  await expect(button).toBeVisible();
  await pressEnter(button);
  await expect(page.locator(`#${workspaceId}`)).toBeVisible();
}

test("keyboard path: create and post the first invoice", async ({ page }, testInfo) => {
  onlyChromium(testInfo);
  await createDemoWorkspace(page, testInfo);

  const createMenu = page.locator("#global-create-menu summary");
  await pressEnter(createMenu);
  await pressEnter(page.getByRole("button", { name: "Invoice", exact: true }));

  const invoice = page.locator("#invoice-form");
  await expect(invoice).toBeVisible();
  await chooseByKeyboard(invoice.locator('select[name="customerId"]'));
  await chooseByKeyboard(invoice.locator('select[name="productItemId"]'));
  await invoice.locator('input[name="quantity"]').fill("1");
  await invoice.locator('input[name="unitPriceMinor"]').fill("100.00");
  await invoice.locator('input[name="discountMinor"]').fill("0.00");
  await invoice.locator('input[name="issueDate"]').fill("2026-09-11");
  await pressEnter(invoice.locator('button[type="submit"]'));
  await expect(page.locator("#invoice-preview")).toContainText("total CAD");

  await pressEnter(page.locator("#invoices").getByRole("button", { name: "Post" }).last());
  await expect(page.locator("#notice")).toHaveText("Invoice posted to the receivables ledger.");
});

test("keyboard path: record a manual payment", async ({ page }, testInfo) => {
  onlyChromium(testInfo);
  await createDemoWorkspace(page, testInfo);
  await openWorkspace(page, "payments-workspace");

  const form = page.locator("#manual-payment-form");
  const customerOptions = await form.locator('select[name="customerId"] option').allTextContents();
  const invoiceOptions = await form.locator('select[name="invoiceId"] option').allTextContents();
  const customerIndex = customerOptions.findIndex((name) =>
    invoiceOptions[0]?.toLowerCase().includes(name.toLowerCase())
  );
  await chooseByKeyboard(form.locator('select[name="customerId"]'), Math.max(customerIndex, 0));
  await chooseByKeyboard(form.locator('select[name="invoiceId"]'));
  await chooseByKeyboard(form.locator('select[name="receivingAccountId"]'));
  await form.locator('input[name="amountMinor"]').fill("1.00");
  await form.locator('input[name="allocationMinor"]').fill("1.00");
  await form.locator('input[name="paymentDate"]').fill("2026-09-11");
  await form.locator('input[name="reference"]').fill("keyboard-payment");
  await pressEnter(form.locator('button[type="submit"]'));
  await expect(page.locator("#notice")).toHaveText("Manual payment recorded and posted.");
});

test("keyboard path: issue and post a credit note", async ({ page }, testInfo) => {
  onlyChromium(testInfo);
  await createDemoWorkspace(page, testInfo);
  await openWorkspace(page, "sales-workspace");

  await pressEnter(page.locator("#invoices").getByRole("button", { name: "Credit note" }).first());
  const creditNote = page.locator("#credit-note-form");
  await expect(creditNote).toBeVisible();
  await creditNote.locator('input[name="issueDate"]').fill("2026-09-11");
  await creditNote.locator('textarea[name="reason"]').fill("Keyboard credit-note acceptance path");
  await pressEnter(creditNote.locator('button[type="submit"]'));
  await expect(page.locator("#notice")).toHaveText(
    "Credit note posted. The invoice and receivables were updated."
  );
});

test("keyboard path: review and match a bank transaction", async ({ page }, testInfo) => {
  onlyChromium(testInfo);
  await createDemoWorkspace(page, testInfo);
  await openWorkspace(page, "payments-workspace");

  const payment = page.locator("#manual-payment-form");
  const customerOptions = await payment
    .locator('select[name="customerId"] option')
    .allTextContents();
  const invoiceOptions = await payment.locator('select[name="invoiceId"] option').allTextContents();
  const customerIndex = customerOptions.findIndex((name) =>
    invoiceOptions[0]?.toLowerCase().includes(name.toLowerCase())
  );
  await chooseByKeyboard(payment.locator('select[name="customerId"]'), Math.max(customerIndex, 0));
  await chooseByKeyboard(payment.locator('select[name="invoiceId"]'));
  await chooseByKeyboard(payment.locator('select[name="receivingAccountId"]'));
  await payment.locator('input[name="amountMinor"]').fill("250.00");
  await payment.locator('input[name="allocationMinor"]').fill("250.00");
  await payment.locator('input[name="paymentDate"]').fill("2026-07-25");
  await payment.locator('input[name="reference"]').fill("E2E-001");
  await pressEnter(payment.locator('button[type="submit"]'));
  await expect(page.locator("#notice")).toHaveText("Manual payment recorded and posted.");

  await pressEnter(page.locator("#payments").getByRole("button", { name: "Detail" }).first());
  await expect(page.locator("#payment-detail")).toContainText("Payment ");
  const paymentDetail = await page.locator("#payment-detail").textContent();
  const paymentId = paymentDetail?.match(/[0-9a-f]{8}-[0-9a-f-]{27,28}/i)?.[0];
  expect(paymentId).toBeTruthy();

  await openWorkspace(page, "banking-workspace");
  const importForm = page.locator("#bank-import-form");
  await chooseByKeyboard(importForm.locator('select[name="bankAccountId"]'));
  await importForm.locator('input[name="statement"]').setInputFiles(statementFile);
  await pressEnter(importForm.locator('button[type="submit"]'));
  await expect(page.locator("#bank-import-preview")).toContainText("transactions");
  await pressEnter(page.locator("#commit-bank-import"));
  await expect(page.locator("#bank-import-preview")).toContainText("added to banking");
  await pressEnter(
    page.locator("#bank-transactions").getByRole("button", { name: "Review" }).first()
  );

  const suggestions = page.locator("#bank-match-suggestions");
  await expect(suggestions).toContainText("INVOICE_PAYMENT");
  const suggestionText = await suggestions.textContent();
  const targetJournalId = suggestionText?.match(/INVOICE_PAYMENT ([0-9a-f-]{36}) for/i)?.[1];
  expect(targetJournalId).toBeTruthy();
  const match = page.locator("#bank-match-form");
  await match.locator('input[name="targetJournalId"]').fill(targetJournalId!);
  await chooseByKeyboard(match.locator('select[name="targetType"]'));
  await match.locator('input[name="targetId"]').fill(paymentId!);
  await pressEnter(match.locator('button[type="submit"]'));
  await expect(page.locator("#notice")).toHaveText(
    "Posted transaction matched without creating another journal."
  );
});

test("keyboard path: run a report and open journal detail", async ({ page }, testInfo) => {
  onlyChromium(testInfo);
  await createDemoWorkspace(page, testInfo);
  await openWorkspace(page, "reports-workspace");

  const report = page.locator("#report-filter-form");
  await report.locator('input[name="from"]').fill("2026-01-01");
  await report.locator('input[name="to"]').fill("2026-12-31");
  await report.locator('input[name="asOf"]').fill("2026-12-31");
  await chooseByKeyboard(report.locator('select[name="reportName"]'), 4);
  await pressEnter(report.locator('button[type="submit"]'));
  await expect(page.locator("#report-status")).toContainText("Journals:");

  const detail = page.locator(".report-detail-link").first();
  await expect(detail).toBeVisible();
  await detail.focus();
  await detail.press("Enter");
  await expect(page.locator("#report-drilldown-panel")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).last().press("Enter");
  await expect(page.locator("#report-drilldown-panel")).toBeHidden();
});
