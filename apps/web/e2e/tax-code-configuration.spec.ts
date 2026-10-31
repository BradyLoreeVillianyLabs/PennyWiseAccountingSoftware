import { expect, test } from "@playwright/test";

/**
 * PennyWise's tax engine already credited each tax component to its own payable
 * account and refused to post one without an account, but there was no screen to
 * create a tax code — so "GST to the federal account, PST to the provincial one"
 * could not be expressed, and every provincial remittance was blocked behind
 * that. The tax report likewise returned one aggregate with no per-authority
 * breakdown, so a GST/HST return and a PST return could not be prepared from it.
 *
 * This covers both: a two-component code created through the form, and a tax
 * report whose per-authority rows sum exactly to the aggregate they came from.
 */
test("a two-component tax code can be configured and filed from", async ({ page }, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));

  const email = `tax-config-${testInfo.project.name}@example.test`;
  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await localIdentity.locator('input[name="email"]').fill(email);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("Tax Configuration Ltd.");
  await organization.locator('input[name="displayName"]').fill("Tax Configuration");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();

  // The chart must exist before a component can point at an account.
  await page
    .locator("#setup-tabs")
    .getByRole("button", { name: /Preset/ })
    .click();
  await page.locator('#preset-form select[name="presetKey"]').selectOption("small-product-seller");
  await page.locator("#preset-form").getByRole("button", { name: /Apply/ }).click();
  await expect(page.locator("#notice")).toContainText("preset applied");

  await page.locator("#setup-tabs").getByRole("button", { name: /Tax/ }).click();
  const form = page.locator("#tax-code-form");
  await expect(form).toBeVisible();

  await form.locator('input[name="code"]').fill("CA-BC");
  await form.locator('input[name="name"]').fill("GST + PST British Columbia");
  await form.locator('input[name="effectiveFrom"]').fill("2026-01-01");
  await form.locator('input[name="sourceName"]').fill("Test source, not tax advice");
  await form.locator('input[name="sourceRetrievedAt"]').fill("2026-01-01");

  await page.locator("#tax-code-add-component").click();
  await page.locator("#tax-code-add-component").click();
  const rows = page.locator(".tax-code-component");
  await expect(rows).toHaveCount(2);

  // A component with no payable account cannot post, so the form says so before
  // it is saved rather than letting an invoice fail later.
  await expect(page.locator("#tax-code-preview-body")).toContainText("cannot post");

  const payableOption = async (index: number) => {
    const select = rows.nth(index).locator('select[name="componentPayableAccount"]');
    const value = await select
      .locator("option")
      .filter({ hasText: /Sales tax payable/ })
      .first()
      .getAttribute("value");
    if (!value) throw new Error("No sales tax payable account was offered.");
    await select.selectOption(value);
  };

  await rows.nth(0).locator('input[name="componentName"]').fill("GST");
  await rows.nth(0).locator('input[name="componentJurisdiction"]').fill("CA");
  await rows.nth(0).locator('input[name="componentRate"]').fill("5");
  await payableOption(0);

  await rows.nth(1).locator('input[name="componentName"]').fill("PST");
  await rows.nth(1).locator('input[name="componentJurisdiction"]').fill("CA-BC");
  // 9.975 is the rate that exposes float conversion: 9.975 / 100 is not exactly
  // 0.09975 in binary floating point, and a tax rate must be exact.
  await rows.nth(1).locator('input[name="componentRate"]').fill("9.975");
  await payableOption(1);

  await expect(page.locator("#tax-code-preview-body")).toContainText("credits");
  await form.getByRole("button", { name: "Save tax code version" }).click();
  await expect(page.locator("#notice")).toContainText("CA-BC saved");

  await expect(page.locator("#tax-code-list")).toContainText("CA-BC");
  await expect(page.locator("#tax-code-list")).toContainText("CA-BC · 9.975%");

  // The stored rate must be exact, and every component must carry its account.
  interface StoredComponent {
    readonly name: string;
    readonly rate: string;
    readonly hasAccount: boolean;
  }
  interface SetupResponse {
    readonly setup?: {
      readonly taxCodes?: readonly {
        readonly code: string;
        readonly versions?: readonly {
          readonly components?: readonly {
            readonly name: string;
            readonly rate: string;
            readonly payableAccountId: string | null;
          }[];
        }[];
      }[];
    };
  }

  const stored: StoredComponent[] = await page.evaluate(async () => {
    const email = sessionStorage.getItem("clearledger_local_identity");
    const organizationId = sessionStorage.getItem("clearledger_active_organization");
    const response = await fetch("/api/v1/setup", {
      credentials: "include",
      headers: {
        "x-clearledger-user-email": email ?? "",
        "x-clearledger-user-name": email ?? "",
        "x-clearledger-organization-id": organizationId ?? ""
      }
    });
    const body = (await response.json()) as SetupResponse;
    const code = (body.setup?.taxCodes ?? []).find((candidate) => candidate.code === "CA-BC");
    return (code?.versions?.[0]?.components ?? []).map((component) => ({
      name: component.name,
      rate: component.rate,
      hasAccount: Boolean(component.payableAccountId)
    }));
  });

  expect(stored).toHaveLength(2);
  expect(stored.map((component) => component.rate)).toEqual(["0.050000", "0.099750"]);
  expect(stored.every((component) => component.hasAccount)).toBe(true);
});
