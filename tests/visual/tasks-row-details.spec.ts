import { expect, type Page, test } from "@playwright/test";

/**
 * A List row's details (MOD-138, MOD-125), measured in a real browser, since
 * jsdom lays nothing out. No screenshots, so it needs no baselines:
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/tasks-row-details.spec.ts
 *
 * Standard, at three centre widths (NarrowRows): the agent's mark and the
 * counts end at the title cell's end on every row; the title never shortens
 * below about ten characters (nor its cell, less an agent's dot); an agent's
 * dot always shows; a hidden count leaves at most one count's room blank;
 * nothing in the cell runs past it, over the columns. Detailed (DetailedRows):
 * the details follow the title, whole, and nothing runs over the columns.
 */

type Row = {
  cellWidth: number;
  cellRight: number;
  /** The title as drawn, and as wide as its words would be. */
  title: number;
  titleRight: number;
  words: number;
  /** Ten characters of the title's own face. */
  floor: number;
  /** The details' box, when it has any width. */
  details: { left: number; right: number } | null;
  /** How much of the agent's dot shows (null: no agent). */
  dot: number | null;
  /** The counts box's width and its drawn counts' (null: no counts). */
  counts: { box: number; drawn: number; widest: number; lead: number } | null;
  /** How far past the cell's end anything in it is drawn. */
  overflow: number;
};

async function measure(page: Page, story: string): Promise<Row[]> {
  await page.goto(`/iframe.html?id=tasks-tasklistview--${story}&viewMode=story&globals=theme:dark`);
  await page.locator('[role="row"][data-task-id]').first().waitFor({ timeout: 15_000 });
  return page.evaluate(() => {
    const cell = (row: HTMLElement) =>
      row.querySelector<HTMLElement>('[data-slot="row-title"]') as HTMLElement;
    // What of an element is drawn: its box, cut by every clipping ancestor
    // inside the cell (late fixes and screen-reader text are never drawn).
    const drawn = (el: Element, within: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (el.closest(".sr-only, .invisible")) return null;
      let left = r.left;
      let right = r.right;
      let top = r.top;
      let bottom = r.bottom;
      for (let p = el.parentElement; p && p !== within; p = p.parentElement) {
        const style = getComputedStyle(p);
        const clip = p.getBoundingClientRect();
        if (style.overflowX !== "visible") {
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
        if (style.overflowY !== "visible") {
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
        }
      }
      return right - left < 0.5 || bottom - top < 0.5 ? null : { left, right };
    };
    return [...document.querySelectorAll<HTMLElement>('[role="row"][data-task-id]')].map((row) => {
      const box = cell(row);
      const rect = box.getBoundingClientRect();
      const title = box.querySelector<HTMLElement>("[data-row-title]") as HTMLElement;
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;width:10ch";
      title.appendChild(probe);
      const floor = probe.getBoundingClientRect().width;
      probe.remove();
      const details = box.querySelector<HTMLElement>('[data-slot="row-details"]');
      const detailsBox = details?.getBoundingClientRect();
      const dotEl = box.querySelector('[data-slot="row-agent"] > span[aria-hidden]');
      const dot = dotEl ? drawn(dotEl, box) : null;
      const countsEl = box.querySelector<HTMLElement>('[data-slot="row-details-counts"]');
      const counts = countsEl
        ? {
            box: countsEl.getBoundingClientRect().width,
            widest: Math.max(...[...countsEl.children].map((c) => c.getBoundingClientRect().width)),
            drawn: [...countsEl.children].reduce((sum, child) => {
              const d = drawn(child, box);
              return sum + (d ? d.right - d.left + 10 : 0);
            }, 0),
            // How far in from the box's start the first drawn count sits.
            lead: Math.min(
              ...[...countsEl.children].map((child) => {
                const d = drawn(child, box);
                return d ? d.left - countsEl.getBoundingClientRect().left : Infinity;
              }),
            ),
          }
        : null;
      let right = rect.left;
      for (const el of box.querySelectorAll("*")) {
        const d = drawn(el, box);
        if (d) right = Math.max(right, d.right);
      }
      return {
        cellWidth: rect.width,
        cellRight: rect.right,
        title: title.getBoundingClientRect().width,
        titleRight: title.getBoundingClientRect().right,
        words: title.scrollWidth,
        floor,
        details:
          detailsBox && detailsBox.width > 0
            ? { left: detailsBox.left, right: detailsBox.right }
            : null,
        dot: dotEl ? (dot ? dot.right - dot.left : 0) : null,
        counts,
        overflow: right - rect.right,
      };
    });
  });
}

test("Standard rows: details at the end, the title's floor, the agent's dot", async ({ page }) => {
  const rows = await measure(page, "narrow-rows");
  expect(rows.length).toBeGreaterThan(6);
  for (const row of rows) {
    const room = row.dot === null ? row.cellWidth : row.cellWidth - 22;
    expect(row.title).toBeGreaterThanOrEqual(Math.min(row.words, row.floor, room) - 1);
    if (row.details) expect(Math.abs(row.details.right - row.cellRight)).toBeLessThan(1);
    if (row.dot !== null) expect(row.dot).toBeGreaterThan(5);
    // A hidden count leaves less room blank than one count and its gap.
    if (row.counts) {
      expect(row.counts.box - Math.max(0, row.counts.drawn - 10)).toBeLessThan(
        row.counts.widest + 10,
      );
    }
    expect(row.overflow).toBeLessThan(1);
  }
});

test("Detailed rows: details follow the title, nothing over the columns", async ({ page }) => {
  const rows = await measure(page, "detailed-rows");
  expect(rows.length).toBeGreaterThan(6);
  for (const row of rows) {
    expect(row.title).toBeGreaterThanOrEqual(Math.min(row.words, row.floor, row.cellWidth) - 1);
    // Right after the title: the row's 10 px gap, no blank between, and the
    // counts left start the box (a hidden one's room falls at the end).
    if (row.details) expect(Math.abs(row.details.left - row.titleRight - 10)).toBeLessThan(1);
    if (row.counts && Number.isFinite(row.counts.lead)) {
      expect(row.counts.lead).toBeLessThan(1);
    }
    expect(row.overflow).toBeLessThan(1);
  }
});
