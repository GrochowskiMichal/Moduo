import { expect, test } from "@playwright/test";

/**
 * Tasks Board — visual regression (TV-U1: U1-4, U1-5). Column widths (280–400
 * px), one meta line per card, tint selection, faded done cards and each
 * column's "N completed" line, under every density × radius, every dark shade
 * and every accent.
 *
 * Baselines are captured by a human, never by an agent (DESIGN_SYSTEM §5):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/tasks-board.spec.ts --update-snapshots
 */

const STORIES = ["by-status", "recent-completed", "by-bucket"];
const DENSITIES = ["comfortable", "compact", "dense"] as const;
const RADII = ["sharp", "soft", "round"] as const;
const SHADES = ["black", "warm", "cool", "slate", "plum", "forest"] as const;
const ACCENTS = ["pink", "violet", "blue", "green", "amber", "red", "teal", "mono"] as const;

async function snap(
  page: import("@playwright/test").Page,
  story: string,
  globals: string,
  name: string,
) {
  await page.goto(
    `/iframe.html?id=tasks-taskboardview--${story}&viewMode=story&globals=${globals}`,
  );
  const root = page.locator("#storybook-root, #root").first();
  await root.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(150);
  await expect(page).toHaveScreenshot(`${name}.png`, { animations: "disabled" });
}

test.describe("tasks board — visual snapshots", () => {
  for (const story of STORIES) {
    test(`tasks-board-${story}`, async ({ page }) => {
      await snap(page, story, "theme:dark", `tasks-board-${story}`);
    });
  }
  for (const density of DENSITIES) {
    for (const radius of RADII) {
      test(`tasks-board-${density}-${radius}`, async ({ page }) => {
        await snap(
          page,
          "by-status",
          `theme:dark;density:${density};radius:${radius}`,
          `tasks-board-${density}-${radius}`,
        );
      });
    }
  }
  for (const shade of SHADES) {
    test(`tasks-board-shade-${shade}`, async ({ page }) => {
      await snap(page, "by-status", `theme:dark;shade:${shade}`, `tasks-board-shade-${shade}`);
    });
  }
  for (const accent of ACCENTS) {
    test(`tasks-board-accent-${accent}`, async ({ page }) => {
      await snap(page, "by-status", `theme:dark;accent:${accent}`, `tasks-board-accent-${accent}`);
    });
  }
});
