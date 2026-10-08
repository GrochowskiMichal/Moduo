import { expect, test } from "@playwright/test";

/**
 * Tasks Board — visual regression (TV-U1: U1-4, U1-5). Column widths (280–400
 * px), one meta line per card, tint selection, faded done cards and each
 * column's "N completed" line, under every density and a spread of shades
 * and accents.
 *
 * Baselines are captured by a human, never by an agent (DESIGN_SYSTEM §5):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/tasks-board.spec.ts --update-snapshots
 */

const STORIES = ["by-status", "recent-completed", "by-bucket"];
const DENSITIES = ["comfortable", "compact", "dense"] as const;
const LOOKS = [
  "shade:black;accent:mono",
  "shade:warm;accent:amber",
  "shade:cool;accent:blue",
  "shade:forest;accent:green",
] as const;

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
    test(`tasks-board-${density}`, async ({ page }) => {
      await snap(page, "by-status", `theme:dark;density:${density}`, `tasks-board-${density}`);
    });
  }
  for (const look of LOOKS) {
    const name = `tasks-board-${look.replace(/[:;]/g, "-")}`;
    test(name, async ({ page }) => {
      await snap(page, "by-status", `theme:dark;${look}`, name);
    });
  }
});
