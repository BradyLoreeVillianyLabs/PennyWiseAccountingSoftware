import { test } from "@playwright/test";
import { assertNoNewSeriousOrCritical, scanState } from "./accessibility-utils.js";
import { createQualityWorkspace, onlyChromium } from "./quality-workspace.js";

test("X4 axe states retain the baseline and reject new serious or critical findings", async ({
  page
}, testInfo) => {
  test.skip(!onlyChromium(testInfo));
  test.setTimeout(120_000);

  const fingerprints = [];
  await page.goto("/");
  fingerprints.push(...(await scanState(page, testInfo, "signed-out")));

  await createQualityWorkspace(page, testInfo, "axe");
  fingerprints.push(...(await scanState(page, testInfo, "filled")));

  const invoice = page.locator("#invoice-form");
  await invoice.locator('input[name="unitPriceMinor"]').fill("-1");
  await invoice.locator('button[type="submit"]').click();
  await page.locator("#notice").waitFor({ state: "visible" });
  fingerprints.push(...(await scanState(page, testInfo, "error")));

  await page.locator("#global-create-menu > summary").click();
  fingerprints.push(...(await scanState(page, testInfo, "dialog-open")));
  await page.locator("#global-create-menu > summary").click();

  await page.locator("#left-navigation-settings").click();
  fingerprints.push(...(await scanState(page, testInfo, "side-panel-open")));

  const comparison = assertNoNewSeriousOrCritical(fingerprints);
  testInfo.annotations.push({
    type: "axe-baseline",
    description: comparison.baselineUpdated
      ? "Baseline updated under explicit AXE_UPDATE_BASELINE=true."
      : `Known fingerprints retained; lower-impact new findings: ${String(comparison.lowerImpactNew.length)}.`
  });
});
