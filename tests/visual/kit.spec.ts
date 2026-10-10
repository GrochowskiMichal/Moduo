import { expect, type Page, test } from "@playwright/test";

import { KIT, kitStoryId } from "../../src/components/ui/kit";

/**
 * The north-star kit at three densities (tasks-v3 AC14.1, DS-6). Each kit
 * primitive's `Densities` story renders it once per density step; this opens
 * every one in Storybook, checks it rendered (no error boundary, no console
 * error) and that each copy really sits on its step's tokens. Computed styles
 * only, so there are no baselines to capture. Local/manual + CI (visual
 * project), NOT part of `bun run verify` (src/components/ui/kit.test.ts checks
 * the stories exist; src/components/text-rules.test.ts proves the lint guards):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/kit.spec.ts
 */

const STEPS = {
  comfortable: { rowH: 36, ctrlH: 32, ctrlHSm: 26 },
  compact: { rowH: 32, ctrlH: 30, ctrlHSm: 24 },
  dense: { rowH: 28, ctrlH: 26, ctrlHSm: 22 },
} as const;

async function openStory(page: Page, id: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.locator("#storybook-root, #root").first().waitFor({ state: "visible" });
  return errors;
}

const px = (page: Page, testId: string, token: string) =>
  page
    .getByTestId(testId)
    .evaluate((el, t) => Number.parseFloat(getComputedStyle(el).getPropertyValue(t)) * 16, token);

test.describe("north-star kit at three densities", () => {
  for (const entry of KIT) {
    test(entry.name, async ({ page }) => {
      const errors = await openStory(page, kitStoryId(entry));
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      for (const [step, sizes] of Object.entries(STEPS)) {
        const section = page.getByTestId(`density-${step}`);
        await expect(section).toBeVisible();
        expect(await px(page, `density-${step}`, "--row-h")).toBe(sizes.rowH);
        expect(await px(page, `density-${step}`, "--ctrl-h")).toBe(sizes.ctrlH);
        expect(await px(page, `density-${step}`, "--ctrl-h-sm")).toBe(sizes.ctrlHSm);
      }
      expect(errors).toEqual([]);
    });
  }

  test("a Row's height follows its density step", async ({ page }) => {
    await openStory(page, "components-ui-row--densities");
    for (const [step, sizes] of Object.entries(STEPS)) {
      const row = page.getByTestId(`density-${step}`).locator("[data-slot=row]").first();
      const height = await row.evaluate((el) => el.getBoundingClientRect().height);
      expect(Math.round(height)).toBe(sizes.rowH);
    }
  });

  test("a menu opened at a density takes it (DisplayMenu)", async ({ page }) => {
    await openStory(page, "components-ui-display-menu--densities");
    const rows = page.getByRole("dialog", { name: "Display options" });
    await expect(rows).toHaveCount(3);
  });

  test("the stale stories render: the app chrome and the toolbar grammar", async ({ page }) => {
    for (const id of ["components-app-app-chrome--default", "components-ui-toolbar--default"]) {
      const errors = await openStory(page, id);
      await expect(page.getByText("Something went wrong")).toHaveCount(0);
      expect(errors, id).toEqual([]);
    }
  });
});
