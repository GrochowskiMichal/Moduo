// The Booking link view's lab state: a booking link opened from the rail, its
// settings in the right panel and its open times dashed on the week. The link
// is answered at the network (the lab seed has none), so nothing is written.
// Kept apart so lab.config.ts stays under the size limit.

import type { Page } from "@playwright/test";

const NINE_TO_FIVE = [{ start: "09:00", end: "17:00" }];

function linkRow(ownerId: string) {
  return {
    id: "00000000-0000-4000-8000-00000000b001",
    slot_id: "00000000-0000-4000-8000-00000000b002",
    slug: "intro-call-lab",
    name: "Intro call",
    link_name: "Intro call",
    description: "",
    owner_user_id: ownerId,
    duration_minutes: 30,
    buffer_before_minutes: 0,
    buffer_after_minutes: 10,
    date_range_days: 30,
    min_notice_minutes: 240,
    host_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    weekly_hours: {
      sun: [],
      mon: NINE_TO_FIVE,
      tue: NINE_TO_FIVE,
      wed: NINE_TO_FIVE,
      thu: NINE_TO_FIVE,
      fri: NINE_TO_FIVE,
      sat: [],
    },
    busy_calendar_ids: ["moduo", "tasks"],
    note_enabled: true,
    guests_enabled: true,
    questions_json: [{ id: "q1", label: "What would you like to cover?", required: false }],
    paused: false,
    video_provider: "google_meet",
    deleted_at: null,
  };
}

/** The booking link answered at the network (the rail, the panel and O read it there). */
export async function routeBookingLink(page: Page) {
  const ownerId = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith("-auth-token"));
    return key ? (JSON.parse(localStorage.getItem(key) ?? "{}").user?.id ?? "") : "";
  });
  const row = linkRow(ownerId);
  await page.route("**/rest/v1/exposed_slot_links*", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const single = (route.request().headers().accept ?? "").includes("vnd.pgrst.object");
    return route.fulfill({ json: single ? row : [row] });
  });
  // The rail reads its links on focus too: a focus event brings the routed one in.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

export const bookingLinkState = {
  act: async ({ page }: { page: Page }) => {
    await routeBookingLink(page);
    await page.getByRole("button", { name: "Intro call", exact: true }).first().click();
    await page.getByText(/open times? this week/).waitFor();
  },
};
