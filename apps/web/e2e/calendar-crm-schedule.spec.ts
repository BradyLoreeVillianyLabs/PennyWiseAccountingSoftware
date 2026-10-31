import { expect, test } from "@playwright/test";

test("CRM appointments appear as timed blocks with readable details and can be rescheduled", async ({
  page
}, testInfo) => {
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/");
  const localIdentity = page.locator("#local-identity-form");
  await expect(localIdentity).toBeVisible();
  await localIdentity
    .locator('input[name="email"]')
    .fill(`calendar-schedule-${testInfo.project.name}@example.test`);
  await localIdentity.getByRole("button", { name: "Continue locally" }).click();
  const demoOption = page.locator(".demo-company-option");
  await expect(demoOption).toBeVisible();
  await demoOption.getByRole("button", { name: "Create demo company" }).click();
  await expect(page.locator("#notice")).toContainText("Fictional is ready", { timeout: 90_000 });

  if (
    testInfo.project.name.startsWith("mobile-") &&
    !(await page.locator("#left-navigation-pane").isVisible())
  )
    await page.getByRole("button", { name: "Open navigation pane" }).click();
  await page
    .locator(
      '#left-navigation-list [data-workspace-target="projects-workspace"][data-planning-tab="calendar"]'
    )
    .click();
  const workItemForm = page.locator("#project-work-item-form");
  await expect(workItemForm).toBeVisible();
  await workItemForm.locator('select[name="kind"]').selectOption("APPOINTMENT");
  await workItemForm.locator('input[name="title"]').fill("CRM schedule usability review");
  await workItemForm
    .locator('textarea[name="description"]')
    .fill("Review the client timeline and confirm the next field visit.");
  await workItemForm.locator('input[name="location"]').fill("North site office");
  await workItemForm.locator('input[name="startAt"]').fill("2026-08-13T10:00");
  await workItemForm.locator('input[name="endAt"]').fill("2026-08-13T11:00");
  await workItemForm.getByRole("button", { name: "Create planning item" }).click();
  await expect(page.locator("#notice")).toContainText("Planning item added", { timeout: 30_000 });

  await page.locator('#projects-workspace [data-planning-tab="calendar"]').click();
  const calendarDate = page.locator("#calendar-date");
  await calendarDate.fill("2026-08-13");
  await calendarDate.dispatchEvent("change");
  await expect(page.locator("#calendar-loading")).toBeHidden({ timeout: 30_000 });
  const appointment = page
    .locator("#calendar-timed-grid [data-calendar-event-id]")
    .filter({ hasText: "CRM schedule usability review" })
    .first();
  await expect(appointment).toBeVisible({ timeout: 30_000 });
  if (testInfo.project.name.startsWith("mobile-"))
    await expect(appointment).not.toHaveAttribute("draggable", "true");
  if (testInfo.project.name.startsWith("mobile-")) await appointment.tap();
  else await appointment.click();
  expect(browserErrors).toEqual([]);

  const details = page.locator("#calendar-event-details");
  await expect(details).toContainText("CRM schedule usability review");
  await expect(details).toContainText("North site office");
  await expect(details).toContainText(
    "Review the client timeline and confirm the next field visit."
  );
  await expect(details).not.toContainText(/source|authority/i);

  const moveEditor = details.locator(".calendar-move-editor");
  await expect(moveEditor).toBeVisible();
  const moveDate = moveEditor.locator('input[name="date"]');
  const moveTime = moveEditor.locator('input[name="time"]');
  await moveDate.fill("2026-08-14");
  await moveTime.fill("11:30");
  await expect(moveDate).toHaveValue("2026-08-14");
  await expect(moveTime).toHaveValue("11:30");
  await moveEditor.getByRole("button", { name: "Save time" }).click();
  await expect(page.locator("#notice")).toContainText("moved to", { timeout: 30_000 });
  await expect(details).toContainText(/11:30/);

  if (["chrome", "chromium"].includes(testInfo.project.name)) {
    const movedAppointment = page
      .getByRole("button", { name: /CRM schedule usability review/ })
      .first();
    const dropTarget = page.locator('[data-calendar-drop-date="2026-08-15"]');
    await expect(dropTarget).toBeVisible();
    await movedAppointment.dragTo(dropTarget, { targetPosition: { x: 80, y: 190 } });
    await expect(page.locator("#notice")).toContainText("moved to", { timeout: 30_000 });
  }
});
