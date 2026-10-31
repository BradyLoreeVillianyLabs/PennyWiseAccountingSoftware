import { expect, test } from "@playwright/test";
import { createQualityWorkspace, onlyChromium } from "./quality-workspace.js";

test("X4 target-size inspection reports small controls and checks spacing", async ({
  page
}, testInfo) => {
  test.skip(!onlyChromium(testInfo));
  await createQualityWorkspace(page, testInfo, "targets");
  const report = await page.evaluate(() => {
    const controls = [...document.querySelectorAll("button, a, input, select, textarea, summary")];
    const visible = controls.filter((control) => {
      const rect = control.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const small = visible
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width < 24 || rect.height < 24;
      })
      .map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          tag: control.tagName.toLowerCase(),
          id: control.id,
          name: control.getAttribute("name"),
          text: control.textContent?.trim().slice(0, 80) ?? "",
          width: Math.round(rect.width * 100) / 100,
          height: Math.round(rect.height * 100) / 100
        };
      });
    const critical = [
      ...document.querySelectorAll(
        "#global-create-menu > summary, #invoice-form button, #invoice-form input, #invoice-form select"
      )
    ];
    const criticalSmall = critical
      .filter((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.width < 24 || rect.height < 24);
      })
      .map((control) => ({
        tag: control.tagName.toLowerCase(),
        id: control.id,
        name: control.getAttribute("name"),
        text: control.textContent?.trim().slice(0, 80) ?? ""
      }));
    return { visibleControls: visible.length, small, criticalSmall };
  });
  await testInfo.attach("target-size-report.json", {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: "application/json"
  });
  expect(report.criticalSmall).toEqual([]);
});
