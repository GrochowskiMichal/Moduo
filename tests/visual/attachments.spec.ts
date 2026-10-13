import { expect, test } from "@playwright/test";

/**
 * Attachments — visual regression (AT-2, AT2-2/AT2-4): the strip under the
 * description, every tile state (uploading, offline, interrupted, failed, full,
 * too big, almost full; owner and member), and the viewer (image and file).
 * Local/manual + CI(visual project) only — NOT part of `bun run verify`.
 * Baselines are a deliberate human capture (docs/gotchas/ui.md):
 *   bun run storybook
 *   bunx playwright test --project=visual tests/visual/attachments.spec.ts --update-snapshots
 */

const STORIES = [
  { name: "attachments-ready", id: "attachments-attachmentstrip--ready" },
  { name: "attachments-empty", id: "attachments-attachmentstrip--empty" },
  { name: "attachments-read-only", id: "attachments-attachmentstrip--read-only" },
  { name: "attachments-uploading", id: "attachments-attachmentstrip--uploading" },
  { name: "attachments-problems", id: "attachments-attachmentstrip--problems" },
  { name: "attachments-problems-member", id: "attachments-attachmentstrip--problems-as-member" },
  { name: "attachments-viewer", id: "attachments-attachmentstrip--viewer" },
  { name: "attachments-viewer-file", id: "attachments-attachmentstrip--viewer-file" },
];

test.describe("attachments — visual snapshots", () => {
  for (const story of STORIES) {
    test(story.name, async ({ page }) => {
      await page.goto(`/iframe.html?id=${story.id}&viewMode=story`);
      const root = page.locator("#storybook-root, #root").first();
      await root.waitFor({ state: "attached", timeout: 15_000 });
      await page.waitForTimeout(300);
      await expect(page).toHaveScreenshot(`${story.name}.png`, { animations: "disabled" });
    });
  }
});
