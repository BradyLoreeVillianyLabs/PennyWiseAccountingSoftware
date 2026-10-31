import { expect, test } from "@playwright/test";
import { createQualityWorkspace, onlyChromium } from "./quality-workspace.js";

test("X4 records lab interaction timings for invoice, report, and filtering actions", async ({
  page
}, testInfo) => {
  test.skip(!onlyChromium(testInfo));
  test.setTimeout(120_000);
  await createQualityWorkspace(page, testInfo, "inp");
  const supported = await page.evaluate(() => "PerformanceObserver" in globalThis);
  test.skip(!supported, "Event Timing PerformanceObserver is unavailable in this browser.");

  await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __pennywiseEventObserver?: PerformanceObserver;
    };
    target.__pennywiseEventObserver = new PerformanceObserver(() => undefined);
    try {
      target.__pennywiseEventObserver.observe({
        type: "event",
        buffered: true,
        durationThreshold: 16
      } as PerformanceObserverInit);
    } catch {
      target.__pennywiseEventObserver = undefined;
    }
  });
  await page.locator('#invoice-form input[name="unitPriceMinor"]').fill("125.00");
  await page.locator("#global-search-menu > summary").click();
  await page.locator("#global-search-input").fill("report");
  await page.keyboard.press("Escape");
  const timings = await page.evaluate(() => {
    const target = globalThis as typeof globalThis & {
      __pennywiseEventObserver?: PerformanceObserver;
    };
    target.__pennywiseEventObserver?.disconnect();
    const entries = performance.getEntriesByType("event");
    return entries.map((entry) => ({ name: entry.name, duration: entry.duration }));
  });
  await testInfo.attach("inp-lab.json", {
    body: Buffer.from(JSON.stringify({ browser: testInfo.project.name, timings }, null, 2)),
    contentType: "application/json"
  });
  const measured = timings.map(({ duration }) => duration).filter(Number.isFinite);
  if (measured.length > 0) {
    const ordered = [...measured].sort((left, right) => left - right);
    const p75 = ordered[Math.ceil(ordered.length * 0.75) - 1] ?? 0;
    expect(
      p75,
      `Lab p75 interaction duration exceeded 200ms: ${JSON.stringify(timings)}`
    ).toBeLessThanOrEqual(200);
  }
});
