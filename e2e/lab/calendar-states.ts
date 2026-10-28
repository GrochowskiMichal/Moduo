// The Calendar screen's lab states, kept apart so lab.config.ts stays under the size
// limit. Seeded data only; whatever the seed can't hold is answered at the network
// (calendar-network.ts), so no state writes to the stack or reaches Google.

import type { Page } from "@playwright/test";

import { atSmallestWindow, withSecondZone } from "./calendar-acts.ts";
import { routeBookingLink } from "./calendar-booking.ts";
import { composingState } from "./calendar-composer.ts";
import { bookingLinkState, rightClickState } from "./calendar-menus.ts";
import {
  fakeOffers,
  GOOGLE_ACCOUNT,
  GOOGLE_LOGIN,
  googleAccount,
  mateBusy,
  noGoogle,
  reread,
} from "./calendar-network.ts";

type Act = { act: ({ page }: { page: Page }) => Promise<unknown> };
const act = (fn: (page: Page) => Promise<unknown>): Act => ({ act: ({ page }) => fn(page) });

/** An event or task block on the grid (titles also show in the right panel, so stay in main). */
export const onGrid = (page: Page, title: string) =>
  page.getByRole("main").getByText(title, { exact: true }).first();

/** The grid's scroller, scrolled so `hour` sits at the top. */
export const scrollGridTo = (page: Page, hour: number) =>
  page.evaluate((h) => {
    let el = document.querySelector("[data-day-col]")?.parentElement ?? null;
    while (el && !(el.scrollHeight > el.clientHeight + 4)) el = el.parentElement;
    if (el) el.scrollTop = (el.scrollHeight / 24) * h;
  }, hour);

/** The calendars panel on the left (folded below 1600 px since CALR-13). */
export async function leftPanel(page: Page) {
  const expand = page.getByRole("button", { name: "Expand left panel" });
  if (await expand.isVisible()) await expand.click();
  return page.getByRole("complementary").first();
}

/** The Calendar accounts window, opened from the account's line in the calendars panel. */
async function openAccounts(page: Page) {
  await leftPanel(page);
  await page.getByRole("button", { name: GOOGLE_LOGIN }).first().click();
  await page.getByRole("dialog", { name: "Calendar accounts" }).waitFor();
}

/** Ana's lane beside your week, her busy blocks answered at the network. */
export async function mateLaneOn(page: Page) {
  await mateBusy(page);
  await reread(page);
  await leftPanel(page);
  await page.getByRole("switch", { name: "Show Ana Ruiz beside your week" }).click();
  await page.getByText(/Beside your week/).waitFor();
}

/**
 * "Google Calendar didn't sync": a connected Google calendar in the error state joins the
 * accounts and the first few events of the week become its events. Then the page reads again.
 */
async function staleGoogleWeek(page: Page) {
  await googleAccount(page, "error");
  await page.route("**/rest/v1/rpc/calendar_events_visible*", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as Record<string, unknown>[];
    await route.fulfill({
      response,
      json: rows.map((row, i) =>
        i % 3 === 0 ? { ...row, source_account_id: GOOGLE_ACCOUNT } : row,
      ),
    });
  });
  await reread(page);
  await page.getByText("didn't sync").first().waitFor({ timeout: 15_000 });
}

const month = (page: Page) => page.getByRole("radio", { name: "Month" }).click();

// Day, Week and Month (CALR-12); no Agenda yet.
export const calendarStates = {
  default: {},
  empty: { seed: "empty" },
  day: act((page) => page.getByRole("radio", { name: "Day" }).click()),
  // Day view, tomorrow: the design review carries its people and Meet beside it.
  dayPrep: act(async (page) => {
    await page.getByRole("radio", { name: "Day" }).click();
    await page.getByRole("button", { name: /^Next period/ }).click();
  }),
  month: act(month),
  // A crowded month: "N more" on the busy days, bars, due counts.
  monthDense: { seed: "dense", ...act(month) },
  // The dense person's week: 60 events, 300 tasks with due dates spread across it.
  dense: { seed: "dense" },
  // The same week in the afternoon, where three and four meetings overlap.
  overlaps: { seed: "dense", ...act((page) => scrollGridTo(page, 13)) },
  // Monday's stack of all-day items and trips at the smallest window (1024 x 700).
  allDayOverflow: { seed: "dense", act: atSmallestWindow },
  long: { seed: "long" },
  // CALR-13: one side panel (Plan) at the smallest window; a second zone (Z).
  narrow: { act: atSmallestWindow },
  twoZones: { act: withSecondZone },
  eventOpen: act((page) => onGrid(page, "Design review with Ana").click()),
  eventDetail: act(async (page) => {
    await onGrid(page, "Design review with Ana").click();
    await page.getByRole("dialog").getByRole("button", { name: "Open" }).click();
  }),
  rightClick: rightClickState,
  // From the calendars panel's Booking links (folded below 1600 px).
  bookingLink: act(async (page) => {
    await leftPanel(page);
    await bookingLinkState.act({ page });
  }),
  loading: { delay: { match: "**/rest/v1/**", ms: 5000 }, capture: "early" },
  // The app is up and only the week's events are on their way: the skeletons in the
  // last known shape (the state above holds the whole app at its boot screen).
  loadingEvents: {
    delay: { match: "**/rest/v1/rpc/calendar_events_visible*", ms: 5000 },
    capture: "early",
  },
  error: { fail: { match: "**/rest/v1/rpc/calendar_events_visible*", status: 500 } },
  // One Google calendar didn't sync: the banner, "Not synced" in the rail, stale marks.
  syncError: act(staleGoogleWeek),
  offline: { offline: true },
  composing: composingState,
  // Share your calendar: who can open it and at what level.
  share: act(async (page) => {
    const panel = await leftPanel(page);
    await panel.getByRole("button", { name: "Share", exact: true }).first().click();
    await page.getByText("Who can open this").waitFor();
  }),
  // Your week as Ana sees it: Busy only, the banner naming her level.
  // From the calendars panel, which names your calendars to the banner.
  previewAs: act(async (page) => {
    await (await leftPanel(page)).getByRole("button", { name: "Preview as…" }).click();
    await page.getByRole("menuitem", { name: "Ana Ruiz" }).click();
    await page.getByRole("button", { name: "Change what Ana sees" }).waitFor();
  }),
  // Ana's lane turned on beside your week, with her busy blocks.
  teammatesOn: act(mateLaneOn),
  // Offering times from the booking link: O, then two times picked on the week.
  offering: act(async (page) => {
    // O opens your first booking link itself (a click on the rail's link would keep focus
    // on that button, which takes ↵ for itself).
    await fakeOffers(page);
    await routeBookingLink(page);
    await page.keyboard.press("o");
    await page.getByText(/Pick times on the week/).waitFor();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.locator("[data-picked]").nth(1).waitFor();
  }),
  // Calendar accounts with a Google login: its calendars, Sync now, Remove.
  accounts: act(async (page) => {
    await googleAccount(page, "ok");
    await reread(page);
    await openAccounts(page);
  }),
  // Connect Google's consent step. It stops before Continue: nothing leaves for Google.
  connectConsent: act(async (page) => {
    await page.route(/accounts\.google\.com/, (route) => route.abort());
    await noGoogle(page);
    await leftPanel(page);
    await page.getByRole("button", { name: "Connect a calendar…" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Google/ })
      .click();
    await page.getByRole("button", { name: /Continue to Google/ }).waitFor();
  }),
  // A Google login that stopped accepting Moduo's access: the banner and the rail's Reconnect.
  reconnect: act(async (page) => {
    await googleAccount(page, "reauth");
    await reread(page);
    await leftPanel(page);
    await page.getByRole("button", { name: "Reconnect", exact: true }).first().waitFor();
  }),
};
