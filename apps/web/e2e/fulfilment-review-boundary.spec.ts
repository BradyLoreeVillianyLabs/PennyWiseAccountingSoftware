import { expect, test } from "@playwright/test";

/**
 * The Orders & fulfilment workspace exists to make the D3/D4/D5 services
 * reachable without weakening the connector review boundary. The boundary is the
 * property worth testing: provider data must stay non-posting until a person
 * explicitly converts an order.
 *
 * This asserts the negative as well as the positive — opening the workspace and
 * selecting an order must create no invoice — because a screen that posts as a
 * side effect of navigation would be the most damaging way to get this wrong.
 */
test("store orders stay non-posting until an operator converts them", async ({
  page
}, testInfo) => {
  test.skip(!["chromium", "chrome"].includes(testInfo.project.name));

  const email = `fulfilment-boundary-${testInfo.project.name}@example.test`;
  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await localIdentity.locator('input[name="email"]').fill(email);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();

  const organization = page.locator("#organization-form");
  await organization.locator('input[name="legalName"]').fill("Fulfilment Boundary Ltd.");
  await organization.locator('input[name="displayName"]').fill("Fulfilment Boundary");
  await organization.getByRole("button", { name: "Create" }).click();
  await expect(page.locator("#notice")).toHaveText("Organization created.");
  await page.locator("#invoice-first-run-full-setup").click();

  // Local development identity is header-backed, exactly as the app's own api()
  // helper sends it. A bare fetch would be unauthenticated.
  const callApi = async (path: string, init: RequestInit = {}) =>
    page.evaluate(
      async ({ path, method, body }) => {
        const email = sessionStorage.getItem("clearledger_local_identity");
        const organizationId = sessionStorage.getItem("clearledger_active_organization");
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (email) {
          headers["x-clearledger-user-email"] = email;
          headers["x-clearledger-user-name"] = email;
        }
        if (organizationId) headers["x-clearledger-organization-id"] = organizationId;
        const response = await fetch(`/api${path}`, {
          credentials: "include",
          method,
          ...(body === undefined ? {} : { body }),
          headers
        });
        const text = await response.text();
        return { status: response.status, body: text };
      },
      {
        path,
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? init.body : undefined
      }
    );

  // Stage the sample store order through the API the workspace itself reads.
  const staged = await callApi("/v1/organizations/current/commerce/demo", {
    method: "POST",
    body: "{}"
  });
  expect([200, 201], `demo staging returned ${staged.body}`).toContain(staged.status);

  const invoiceCount = async () => {
    const result = await callApi("/v1/invoices");
    if (result.status !== 200) return -1;
    const body = JSON.parse(result.body) as { invoices?: unknown[] };
    return Array.isArray(body.invoices) ? body.invoices.length : -1;
  };

  const before = await invoiceCount();

  await page
    .locator("#left-navigation-list button")
    .filter({ hasText: /Orders & fulfilment$/ })
    .first()
    .click();
  await expect(page.locator("#fulfilment-workspace")).toBeVisible();

  const order = page.locator(".fulfilment-order").first();
  await expect(order).toBeVisible();
  await expect(order).toContainText("Review required");

  await order.click();
  await expect(page.locator("#fulfilment-detail")).toContainText("Not ready to convert yet.");

  // The service's own requirements are shown rather than a friendlier rewrite,
  // because they are what tells the operator how to proceed.
  await expect(page.locator(".fulfilment-gaps li").first()).toBeVisible();

  // Conversion is refused while the preflight reports the order is not ready.
  await expect(page.locator(".fulfilment-convert")).toBeDisabled();

  // The boundary: reaching this point created nothing in the books.
  expect(await invoiceCount()).toBe(before);

  // Operational documents must not imply accounting, and must say so.
  await expect(page.locator("#fulfilment-picking-section")).toContainText(
    "never changes your books"
  );
  await expect(page.locator("#fulfilment-shipping-section")).toContainText(
    "never buys, resells, or refunds postage"
  );
});
