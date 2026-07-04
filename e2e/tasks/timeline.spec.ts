// AC1/AC5 smoke — switch to Timeline, drag a bar one week, see the persisted
// new schedule (specs/tasks-timeline.md). Pointer moves are frame-stepped per
// the dnd gotcha (synchronous synthetic moves are dropped).
// Not part of `bun run verify`; needs a running app + authed session with at
// least TWO dated tasks (the second bar is the fixed reference that cancels
// out any axis-window origin shift the drag itself causes).
import { test, expect } from "@playwright/test";

const APP = process.env.E2E_APP_URL;

test.describe("Tasks Timeline — switch + drag-to-reschedule (AC1, AC5)", () => {
  test.skip(!APP, "E2E_APP_URL not set — run against a live authed session");

  test("a bar dragged a week right persists the new schedule", async ({ page }) => {
    await page.goto(`${APP}/tasks`);

    // AC1 — the third Plan view.
    await page.getByRole("radio", { name: "Timeline view" }).click();
    await expect(page.locator("[data-timeline-bar]").first()).toBeVisible();

    // Month zoom for a deterministic 40px day.
    await page.getByRole("radio", { name: "Month" }).click();

    // Pin the dragged bar and a reference bar by task id — lane rows re-sort
    // by start day after the move, so `.first()` would swap tasks under us.
    const all = page.locator("[data-timeline-bar]");
    test.skip((await all.count()) < 2, "need ≥2 dated bars — seed scheduled tasks first");
    const dragId = (await all.nth(0).getAttribute("data-timeline-bar"))!;
    const refId = (await all.nth(1).getAttribute("data-timeline-bar"))!;
    const dragBar = page.locator(`[data-timeline-bar="${dragId}"]`);
    const refBar = page.locator(`[data-timeline-bar="${refId}"]`);

    const dayWidth = 40;
    const box = (await dragBar.boundingBox())!;
    const refBefore = (await refBar.boundingBox())!;
    const grabX = box.x + box.width / 2; // body, clear of the edge zones
    const grabY = box.y + box.height / 2;

    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(grabX + (7 * dayWidth * i) / 8, grabY);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();

    // Relative-to-reference delta cancels any window-origin/scroll shift.
    const moved = (await dragBar.boundingBox())!;
    const refAfter = (await refBar.boundingBox())!;
    expect(Math.round(moved.x - refAfter.x - (box.x - refBefore.x))).toBe(7 * dayWidth);

    // …and the write persisted across a reload (AC5).
    await page.reload();
    await expect(page.locator(`[data-timeline-bar="${dragId}"]`)).toBeVisible();
    const persisted = (await page.locator(`[data-timeline-bar="${dragId}"]`).boundingBox())!;
    const refPersisted = (await page.locator(`[data-timeline-bar="${refId}"]`).boundingBox())!;
    expect(Math.round(persisted.x - refPersisted.x - (box.x - refBefore.x))).toBe(7 * dayWidth);
  });
});
