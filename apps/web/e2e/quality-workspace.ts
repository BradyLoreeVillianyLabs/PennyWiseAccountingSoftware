import { expect, type Page, type TestInfo } from "@playwright/test";

export async function createQualityWorkspace(page: Page, testInfo: TestInfo, suffix: string) {
  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await expect(localIdentity).toBeVisible();
  await localIdentity
    .locator('input[name="email"]')
    .fill(`quality-${suffix}-${testInfo.project.name}@example.test`);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await expect(organization).toBeVisible();
  await organization.locator('input[name="legalName"]').fill(`Quality ${suffix} Ltd.`);
  await organization.locator('input[name="displayName"]').fill(`Quality ${suffix}`);
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();
  await page.locator('#left-navigation-list [data-left-navigation-key="sales"]').click();
  await expect(page.locator("#sales-workspace")).toBeVisible();
  await expect(page.locator("#invoice-form")).toBeVisible();
}

export function onlyChromium(testInfo: TestInfo) {
  return ["chromium", "chrome"].includes(testInfo.project.name);
}
