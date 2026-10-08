import { expect, test } from "@playwright/test";

/**
 * DS-AC1 / DS-AC2 — the state ladder (hover · active · selected rows, both
 * selection looks) and the raised plates (segmented control, tabs) under every
 * dark shade with three accents. One baseline per shade × accent.
 *
 * Baselines are captured by a human, never by an agent (DESIGN_SYSTEM §5):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/state-ladder.spec.ts --update-snapshots
 * then review the PNGs and commit them with the change that motivated them.
 */

const SHADES = ["black", "warm", "cool", "slate", "plum", "forest"] as const;
const ACCENTS = ["mono", "blue", "amber"] as const;

test.describe("state ladder — visual snapshots", () => {
  for (const shade of SHADES) {
    for (const accent of ACCENTS) {
      test(`state-ladder-${shade}-${accent}`, async ({ page }) => {
        await page.goto(
          `/iframe.html?id=foundations-stateladder--default&viewMode=story&globals=theme:dark;shade:${shade};accent:${accent}`,
        );
        const root = page.locator("#storybook-root, #root").first();
        await root.waitFor({ state: "visible", timeout: 15_000 });
        await page.waitForTimeout(150);
        await expect(page).toHaveScreenshot(`state-ladder-${shade}-${accent}.png`, {
          fullPage: true,
          animations: "disabled",
        });
      });
    }
  }
});
