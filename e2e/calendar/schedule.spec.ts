// AC6/AC7 — drag task → block → complete (specs/calendar.md). Pointer moves
// are frame-stepped per the dnd gotcha (dnd-kit drops same-tick events).
// Not part of `bun run verify`; needs a running app + authed session.
import { expect, test } from "@playwright/test";

const APP = process.env.E2E_APP_URL;

test.describe("Calendar — drag-to-schedule + complete-in-block (AC6, AC7)", () => {
  test.skip(!APP, "E2E_APP_URL not set — run against a live authed session");

  test("a task dragged onto the grid becomes a block; ticking completes it", async ({ page }) => {
    await page.goto(`${APP}/calendar`);
    await page.waitForSelector("[data-day-col]");

    // Drag the first panel task row onto Tuesday around 10:00.
    const row = page.locator("[data-slot='segmented-control'] ~ div [role='button']").first();
    const rowBox = await row.boundingBox();
    test.skip(!rowBox, "no draggable task rows — seed a backlog task first");

    const col = page.locator("[data-day-col]").nth(1);
    const colBox = (await col.boundingBox())!;
    const targetY = colBox.y + (600 / 1440) * colBox.height; // ~10:00

    await page.mouse.move(rowBox!.x + 40, rowBox!.y + rowBox!.height / 2);
    await page.mouse.down();
    // Frame-stepped moves so dnd-kit's rAF loop sees them.
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(
        rowBox!.x + 40 + ((colBox.x + colBox.width / 2 - rowBox!.x - 40) * i) / 8,
        rowBox!.y + ((targetY - rowBox!.y) * i) / 8,
      );
      await page.waitForTimeout(30);
    }
    await page.mouse.up();

    // The block appears on the grid…
    const block = page.locator("[data-task-block]").first();
    await expect(block).toBeVisible();

    // …and its checkbox completes the task in place.
    await block.locator("button").first().click();
    await expect(block.locator("[class*='line-through']")).toBeVisible();
  });
});
