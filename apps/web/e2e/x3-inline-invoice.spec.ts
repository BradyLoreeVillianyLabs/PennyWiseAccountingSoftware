import { expect, test, type Page } from "@playwright/test";
import { createQualityWorkspace, onlyChromium } from "./quality-workspace.js";

async function applyGeneralServicePreset(page: Page) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/v1/setup/presets/general-service/apply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": globalThis.crypto.randomUUID(),
        "x-clearledger-user-email": sessionStorage.getItem("clearledger_local_identity") ?? "",
        "x-clearledger-user-name": sessionStorage.getItem("clearledger_local_identity") ?? "",
        "x-clearledger-organization-id":
          sessionStorage.getItem("clearledger_active_organization") ?? "",
        "x-clearledger-company-id": sessionStorage.getItem("clearledger_active_company") ?? ""
      },
      body: "{}"
    });
    return { status: response.status, body: await response.text() };
  });
  expect(result.status, result.body).toBe(201);
}

test("invoice composer saves two description-only lines without leaving the screen", async ({
  page
}, testInfo) => {
  test.skip(!onlyChromium(testInfo));
  await createQualityWorkspace(page, testInfo, "x3-description");

  const invoice = page.locator("#invoice-form");
  await invoice.getByRole("button", { name: "+ Add customer" }).click();
  const customerDialog = page.locator("#quick-create-dialog");
  await customerDialog.locator('input[name="customerName"]').fill("X3 Description Customer");
  await customerDialog.getByRole("button", { name: "Create and return to invoice" }).click();
  await expect(customerDialog).toBeHidden();
  await applyGeneralServicePreset(page);

  const rows = () => invoice.locator(".invoice-line-row");
  await rows().first().locator('[data-line-field="description"]').fill("Window cleaning");
  await rows().first().locator('[data-line-field="unitPriceMinor"]').fill("125.00");
  await expect(rows().first().locator('[data-line-field="description"]')).toHaveValue(
    "Window cleaning"
  );
  await expect(rows().first().locator('[data-line-field="unitPriceMinor"]')).toHaveValue("125.00");
  await invoice.getByRole("button", { name: "+ Add line" }).click();
  await expect(rows().first().locator('[data-line-field="description"]')).toHaveValue(
    "Window cleaning"
  );
  await expect(rows().first().locator('[data-line-field="unitPriceMinor"]')).toHaveValue("125.00");
  await rows().nth(1).locator('[data-line-field="description"]').fill("Screen repair");
  await rows().nth(1).locator('[data-line-field="unitPriceMinor"]').fill("75.00");
  await invoice.locator('input[name="issueDate"]').fill("2026-09-11");

  await expect(invoice.locator("#invoice-estimated-total")).toContainText("200.00");
  await invoice.getByRole("button", { name: "Create invoice draft and review" }).click();
  await expect(page.locator("#invoice-preview")).toContainText("total CAD 200.00");
  await expect(page.locator("#invoice-preview-panel")).toHaveAttribute("open", "");
  await expect(page.locator("#invoice-document-preview iframe")).toHaveAttribute(
    "srcdoc",
    /Window cleaning/
  );
  await expect(page.locator("#invoice-document-preview iframe")).toHaveAttribute(
    "srcdoc",
    /Screen repair/
  );
  await expect(page.locator("#invoice-document-preview iframe")).toHaveAttribute(
    "srcdoc",
    />DRAFT</
  );
  await expect(page.locator("#invoice-document-preview iframe")).not.toHaveAttribute(
    "srcdoc",
    /DRAFT-[0-9a-f]{8}/i
  );
});

test("invoice composer creates and selects a missing product in place", async ({
  page
}, testInfo) => {
  test.skip(!onlyChromium(testInfo));
  await createQualityWorkspace(page, testInfo, "x3-product");

  const invoice = page.locator("#invoice-form");
  await invoice.getByRole("button", { name: "+ Add customer" }).click();
  const customerDialog = page.locator("#quick-create-dialog");
  await customerDialog.locator('input[name="customerName"]').fill("X3 Product Customer");
  await customerDialog.getByRole("button", { name: "Create and return to invoice" }).click();
  await expect(customerDialog).toBeHidden();

  const row = invoice.locator(".invoice-line-row").first();
  await row.locator('[data-line-field="item"]').fill("Window cleaning");
  await row.getByRole("button", { name: "+ Create item" }).click();
  await expect(page.locator("#quick-create-dialog")).toBeVisible();
  await page.locator("#quick-create-dialog input[name=productName]").fill("Window cleaning");
  await page.locator("#quick-create-dialog input[name=productPrice]").fill("80.00");
  const productDialog = page.locator("#quick-create-dialog");
  if ((await productDialog.locator('select[name="productIncomeAccount"] option').count()) === 0) {
    await productDialog.getByRole("button", { name: "+ Add revenue account" }).click();
    const accountStep = page.locator("#quick-create-dialog");
    await expect(accountStep.locator("#quick-create-account-fields")).toBeVisible();
    await accountStep.locator('input[name="accountCode"]').fill("4100");
    await accountStep.locator('input[name="accountName"]').fill("X3 Sales");
    await accountStep.getByRole("button", { name: "Create account and return" }).click();
    await expect(accountStep.locator("#quick-create-product-fields")).toBeVisible();
  }
  await productDialog.getByRole("button", { name: "Create and return to invoice" }).click();

  await expect(row.locator('[data-line-field="item"]')).toHaveValue(/Window cleaning/);
  await expect(row.locator('[data-line-field="unitPriceMinor"]')).toHaveValue("80.00");
  await expect(row.locator('[data-line-field="quantity"]')).toBeFocused();
});

test("project work forms create and select a project without leaving context", async ({
  page
}, testInfo) => {
  test.skip(!onlyChromium(testInfo));
  await createQualityWorkspace(page, testInfo, "x3-project");

  await page.getByRole("button", { name: "Open Project planning" }).click();
  const projectForm = page.locator("#project-form");
  await expect(projectForm).toBeVisible();
  await projectForm.getByRole("button", { name: "+ Add customer" }).click();
  const customerDialog = page.locator("#quick-create-dialog");
  await customerDialog.locator('input[name="customerName"]').fill("X3 Project Customer");
  await customerDialog.getByRole("button", { name: "Create and return to invoice" }).click();
  await expect(customerDialog).toBeHidden();

  const timeForm = page.locator("#time-entry-form");
  await timeForm.getByRole("button", { name: "+ Add project" }).click();
  await expect(customerDialog.locator("#quick-create-project-fields")).toBeVisible();
  await customerDialog.locator('input[name="projectName"]').fill("X3 Project");
  await customerDialog.getByRole("button", { name: "Create project and return" }).click();
  await expect(customerDialog).toBeHidden();
  await expect(timeForm.locator('select[name="projectId"]')).not.toHaveValue("");
});
