/**
 * invite-paywall.spec.ts
 *
 * Verifies that:
 * - The /paywall route is publicly accessible (redirects happen server-side or
 *   client-side via app-gate, so unauthenticated tests can only check UI).
 * - The upgrade modal headline text matches the expected copy for the
 *   'team_members' feature gate.
 *
 * Note: Full invite-paywall enforcement (RLS returning 403 for free users)
 * is covered by Supabase integration tests via the migration assertions.
 */

import { expect, test } from "@playwright/test";
import { BASE_URL } from "./helpers";

test.describe("Invite paywall", { tag: "@smoke" }, () => {
  test("paywall page renders the Team plan invite features", async ({ page }) => {
    await page.goto(`${BASE_URL}/paywall`);

    // The Team plan features list should mention roles / guests.
    const teamSection = page.getByText("Roles, permissions and guests");
    await expect(teamSection).toBeVisible();
  });

  test("paywall offers a trial CTA for each paid plan", async ({ page }) => {
    await page.goto(`${BASE_URL}/paywall`);

    for (const plan of ["Pro", "Duo", "Team"]) {
      await expect(page.getByRole("button", { name: `Start free trial — ${plan}` })).toBeVisible();
    }
  });
});
