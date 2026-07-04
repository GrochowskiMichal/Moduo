/**
 * hub.spec.ts — block CO-2, AC2 (open a contact → grouped roll-up, zero logging).
 *
 * Drives the live app: selecting a seeded contact renders the LastTouchLine and
 * the relation_kind-grouped roll-up from linked data alone — with NO "log
 * activity" affordance anywhere in the hub. Manual/local: needs the app running
 * + a seeded contact with links. NOT part of `bun run verify` (e2e stays local —
 * gotchas.md). Skips unless E2E_APP_URL is set.
 *
 * Env:
 *   E2E_APP_URL            — running app base URL (authed session assumed)
 *   E2E_CONTACT_NAME       — a seeded contact's display name to open
 */

import { test, expect } from "@playwright/test";

const APP = process.env.E2E_APP_URL;
const CONTACT_NAME = process.env.E2E_CONTACT_NAME;

test.describe("Contacts hub — zero-logging roll-up (CO-2, AC2)", () => {
  test.skip(!APP || !CONTACT_NAME, "E2E_APP_URL / E2E_CONTACT_NAME not set");

  test("opening a contact renders the grouped roll-up and last touch, with no log-activity control", async ({ page }) => {
    await page.goto(`${APP}/contacts`);

    // Open the seeded contact from the directory.
    await page.getByRole("button", { name: new RegExp(CONTACT_NAME as string) }).first().click();

    // The quiet last-touch line is present (derived, not logged).
    await expect(page.getByText(/Last touch:|No activity yet/)).toBeVisible();

    // The roll-up groups by the fixed section headings (at least one present).
    await expect(
      page.getByText(/Open work|Money|Conversations|Notes|Other/).first(),
    ).toBeVisible();

    // The defining invariant: there is NO "log activity" affordance anywhere.
    await expect(page.getByRole("button", { name: /log activity/i })).toHaveCount(0);
  });
});
