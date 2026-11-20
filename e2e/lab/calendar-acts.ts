// Calendar lab states' actions (CALR-13), kept apart so lab.config.ts stays
// under the size ratchet.

import type { Page } from "@playwright/test";

/** The smallest window the app supports (1024 x 700). */
export const atSmallestWindow = async ({ page }: { page: Page }) =>
  page.setViewportSize({ width: 1024, height: 700 });

/** A second time zone (Z) beside your own: PT, its hours in the gutter. */
export async function withSecondZone({ page }: { page: Page }) {
  await page.evaluate(() =>
    window.localStorage.setItem(
      "moduo:calendar:second-zone",
      JSON.stringify({ zone: "America/Los_Angeles", shown: true }),
    ),
  );
  await page.reload();
  await page.getByRole("toolbar", { name: "Calendar controls" }).waitFor();
}
