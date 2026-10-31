import { expect, test } from "@playwright/test";
import { createQualityWorkspace, onlyChromium } from "./quality-workspace.js";

test("X4 invoice workspace reflows at 320px and records viewport evidence", async ({
  page
}, testInfo) => {
  test.skip(!onlyChromium(testInfo));
  test.setTimeout(120_000);
  await createQualityWorkspace(page, testInfo, "viewport");
  const evidence = [];

  await page.setViewportSize({ width: 320, height: 900 });
  const reflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  expect(reflow.documentWidth, JSON.stringify(reflow)).toBeLessThanOrEqual(reflow.viewport + 1);
  expect(reflow.bodyWidth, JSON.stringify(reflow)).toBeLessThanOrEqual(reflow.viewport + 1);
  evidence.push({ width: 320, reflow });

  for (const width of [390, 834, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`invoice-${String(width)}px.png`, {
      body: shot,
      contentType: "image/png"
    });
    evidence.push({ width, height: 900 });
  }

  await page.emulateMedia({ forcedColors: "active" });
  const forcedColorsShot = await page.screenshot({ fullPage: true });
  await testInfo.attach("invoice-forced-colors.png", {
    body: forcedColorsShot,
    contentType: "image/png"
  });
  await expect(page.locator("#invoice-form")).toBeVisible();
  await expect(page.locator("#global-create-menu > summary")).toBeVisible();
  await testInfo.attach("viewport-evidence.json", {
    body: Buffer.from(JSON.stringify(evidence, null, 2)),
    contentType: "application/json"
  });
});
