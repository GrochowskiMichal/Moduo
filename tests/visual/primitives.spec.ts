import { test, expect } from "@playwright/test";

/**
 * Visual regression pattern. Each entry points at a Storybook story id
 * (kebab-cased Title path -- kebab-cased story name) and snapshots the
 * isolated iframe view. Run locally with:
 *   bun run storybook        # in one terminal
 *   bunx playwright test --project=visual
 * Update baselines with:
 *   bunx playwright test --project=visual --update-snapshots
 *
 * CI runs the same project; if the rendered story drifts from the
 * checked-in snapshot, the run fails. Approving a visual change is
 * intentionally a human step (commit the updated PNG alongside the
 * change to the component).
 */

const STORIES = [
  { name: "button-default", id: "components-ui-button--default" },
  { name: "button-variants", id: "components-ui-button--variants" },
  { name: "button-sizes", id: "components-ui-button--sizes" },
  { name: "badge-default", id: "components-ui-badge--default" },
  { name: "card-default", id: "components-ui-card--default" },
  { name: "input-default", id: "components-ui-input--default" },
  { name: "label-default", id: "components-ui-label--default" },
  { name: "tabs-default", id: "components-ui-tabs--default" },
  { name: "switch-default", id: "components-ui-switch--default" },
  { name: "select-default", id: "components-ui-select--default" },
  { name: "radio-group-default", id: "components-ui-radio-group--default" },
  { name: "separator-default", id: "components-ui-separator--default" },
  { name: "avatar-default", id: "components-ui-avatar--default" },
  { name: "icon-default", id: "components-ui-icon--default" },
  { name: "tooltip-default", id: "components-ui-tooltip--default" },
];

test.describe("primitives — visual snapshots", () => {
  for (const story of STORIES) {
    test(story.name, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      // Storybook signals readiness by removing the loader; wait for the
      // root container before snapshotting.
      const root = page.locator("#storybook-root, #root").first();
      await root.waitFor({ state: "visible", timeout: 15_000 });
      // Give web-fonts and any css animations a beat to settle.
      await page.waitForTimeout(150);
      await expect(page).toHaveScreenshot(`${story.name}.png`, {
        animations: "disabled",
      });
    });
  }
});
