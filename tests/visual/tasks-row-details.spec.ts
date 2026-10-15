import { expect, test } from "@playwright/test";

/**
 * A List row's details at three centre widths (MOD-138, MOD-125): measured in
 * a real browser, since jsdom lays nothing out. No screenshots, so it needs no
 * baselines:
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/tasks-row-details.spec.ts
 *
 * - the agent's mark and the counts end at the title cell's end on every row
 *   (they never move with the title's length);
 * - the title never shortens below about ten characters, or its cell;
 * - nothing in the cell runs past it, over the columns.
 */

type Row = {
  cellWidth: number;
  cellRight: number;
  /** The title as drawn, and as wide as its words would be. */
  title: number;
  words: number;
  /** Ten characters of the title's own face. */
  floor: number;
  detailsRight: number | null;
  /** How far past the cell's end anything in it is drawn. */
  overflow: number;
};

test("a row's details stay at its end, the title keeps its floor", async ({ page }) => {
  await page.goto(
    "/iframe.html?id=tasks-tasklistview--narrow-rows&viewMode=story&globals=theme:dark",
  );
  await page.locator('[role="row"][data-task-id]').first().waitFor({ timeout: 15_000 });
  const rows: Row[] = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="row"][data-task-id]')].map((row) => {
      const cell = row.querySelector<HTMLElement>('[data-slot="row-title"]') as HTMLElement;
      const title = cell.querySelector<HTMLElement>("[data-row-title]") as HTMLElement;
      const details = cell.querySelector<HTMLElement>('[data-slot="row-details"]');
      const box = cell.getBoundingClientRect();
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;width:10ch";
      title.appendChild(probe);
      const floor = probe.getBoundingClientRect().width;
      probe.remove();
      // The furthest right anything in the cell is drawn: inside a box that
      // clips, only as far as the box (late fixes show only on hover).
      let right = box.left;
      for (const el of cell.querySelectorAll<HTMLElement>("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || el.closest(".sr-only, .invisible")) continue;
        let start = r.left;
        let end = r.right;
        for (let p = el.parentElement; p && p !== cell; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== "visible") {
            const clip = p.getBoundingClientRect();
            start = Math.max(start, clip.left);
            end = Math.min(end, clip.right);
          }
        }
        // Wholly clipped away: not drawn.
        if (end - start < 0.5) continue;
        right = Math.max(right, end);
      }
      return {
        cellWidth: box.width,
        cellRight: box.right,
        title: title.getBoundingClientRect().width,
        words: title.scrollWidth,
        floor,
        // A cell under the title's floor leaves the details no room at all.
        detailsRight:
          details && details.getBoundingClientRect().width > 0
            ? details.getBoundingClientRect().right
            : null,
        overflow: right - box.right,
      };
    }),
  );
  expect(rows.length).toBeGreaterThan(6);
  for (const row of rows) {
    // A title keeps its whole width up to the floor, and the floor itself
    // (never more than its cell) once it's longer.
    expect(row.title).toBeGreaterThanOrEqual(Math.min(row.words, row.floor, row.cellWidth) - 1);
    if (row.detailsRight !== null)
      expect(Math.abs(row.detailsRight - row.cellRight)).toBeLessThan(1);
    expect(row.overflow).toBeLessThan(1);
  }
});
