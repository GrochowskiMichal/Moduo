import { expect, test } from "@playwright/test";

/**
 * Tasks List rows — visual regression (TV-U1: U1-1, U1-2, U1-3, U1-5). The row
 * anatomy (fixed columns, quiet counts, the priority glyph, done rows, the
 * "N completed" line) under every density and radius, every dark shade, and
 * a spread of accents.
 *
 * Baselines are captured by a human, never by an agent (DESIGN_SYSTEM §5):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/tasks-list.spec.ts --update-snapshots
 * Relative dates ("Today", weekdays) follow the wall clock, so recapture
 * rather than trusting a diff taken on another day.
 */

const STORIES = [
  "single-bucket",
  "all-by-bucket",
  "all-flat",
  "completed-all",
  "with-energy",
  "read-only",
];
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
  await page.goto(`/iframe.html?id=tasks-tasklistview--${story}&viewMode=story&globals=${globals}`);
  const root = page.locator("#storybook-root, #root").first();
  await root.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(150);
  await expect(page).toHaveScreenshot(`${name}.png`, { animations: "disabled" });
}

test.describe("tasks list — visual snapshots", () => {
  for (const story of STORIES) {
    test(`tasks-list-${story}`, async ({ page }) => {
      await snap(page, story, "theme:dark", `tasks-list-${story}`);
    });
  }
  for (const density of DENSITIES) {
    for (const radius of RADII) {
      test(`tasks-list-${density}-${radius}`, async ({ page }) => {
        await snap(
          page,
          "all-by-bucket",
          `theme:dark;density:${density};radius:${radius}`,
          `tasks-list-${density}-${radius}`,
        );
      });
    }
  }
  for (const shade of SHADES) {
    test(`tasks-list-shade-${shade}`, async ({ page }) => {
      await snap(page, "single-bucket", `theme:dark;shade:${shade}`, `tasks-list-shade-${shade}`);
    });
  }
  for (const accent of ACCENTS) {
    test(`tasks-list-accent-${accent}`, async ({ page }) => {
      await snap(
        page,
        "single-bucket",
        `theme:dark;accent:${accent}`,
        `tasks-list-accent-${accent}`,
      );
    });
  }
});
