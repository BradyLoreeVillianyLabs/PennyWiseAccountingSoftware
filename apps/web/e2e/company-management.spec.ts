import { expect, test } from "@playwright/test";

test("profile can create and remove a company without removing the last one", async ({
  page
}, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));

  const failedDashboardResponses: Array<{ status: number; url: string }> = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/v1/dashboard") && response.status() >= 400)
      failedDashboardResponses.push({ status: response.status(), url: response.url() });
  });
  await page.goto("/");
  const email = `company-management-${testInfo.project.name}@example.test`;
  const localIdentity = page.locator("#local-identity-form");
  await localIdentity.locator('input[name="email"]').fill(email);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("Company Management Test Ltd.");
  await organization.locator('input[name="displayName"]').fill("Company Management Test");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();
  await expect(page.locator("#home-data-status-message")).toHaveText(
    "Complete company setup to activate your dashboard."
  );
  await expect.poll(() => failedDashboardResponses).toEqual([]);

  await page.locator("#left-navigation-settings").click();
  await page.locator("#settings-menu").getByRole("button", { name: "Company settings" }).click();
  await expect(page.locator("#company-management-list")).toContainText("Company Management Test");

  const companyForm = page.locator("#company-create-form");
  await companyForm.locator('input[name="legalName"]').fill("Second Company Ltd.");
  await companyForm.locator('input[name="displayName"]').fill("Second Company");
  await companyForm.getByRole("button", { name: "Create company" }).click();
  await expect(page.locator("#notice")).toHaveText("Company created.");
  await expect(page.locator("#company-management-list")).toContainText("Second Company");

  await page.locator("button[data-delete-company]").filter({ hasText: "Remove" }).last().click();
  const archiveDialog = page.locator("#company-delete-dialog");
  await expect(archiveDialog).toBeVisible();
  const confirmation = archiveDialog.locator("#company-delete-confirmation");
  const archive = archiveDialog.getByRole("button", { name: "Archive company" });
  await expect(archive).toBeDisabled();
  await confirmation.fill("Second Company");
  await expect(archive).toBeEnabled();
  await archive.click();
  await expect(page.locator("#notice")).toHaveText(
    "Second Company archived. Its records were retained for audit."
  );
  await expect(page.locator("#company-management-list")).not.toContainText("Second Company");
  await expect(page.locator("button[data-delete-company]")).toHaveCount(1);
  await expect(page.locator("button[data-delete-company]")).toBeDisabled();
});
