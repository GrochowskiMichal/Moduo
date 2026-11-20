// Calendar lab answers at the network: what the lab seed can't hold (a Google account,
// a teammate's busy week, an offer, the guest page's function) is answered in the
// browser, so no state or journey writes it to the stack or reaches Google.

import type { Page, Route } from "@playwright/test";

type Row = Record<string, unknown>;
const json = (body: unknown) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body),
});
const toolbar = (page: Page) => page.getByRole("toolbar", { name: "Calendar controls" });

/** Read again with the routes in place. */
export async function reread(page: Page) {
  await page.reload();
  await toolbar(page).waitFor({ timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/** The Google functions stay out of the lab: they answer as if not running (503). */
export const noGoogle = (page: Page) =>
  page.route(/\/functions\/v1\/(calendar-google-web|booking-google-connect)/, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );

export const GOOGLE_ACCOUNT = "00000000-0000-4000-8000-00000000a11b";
export const GOOGLE_LOGIN = "robin.hale@gmail.com";

/**
 * A connected Google calendar ("Work", robin.hale@gmail.com) in `status`, joined to the
 * live calendar_accounts read. Remove and Undo answer at the network too, so the account
 * leaves and comes back without a write. Returns a function that says whether it is removed.
 */
export async function googleAccount(page: Page, status: "ok" | "error" | "reauth") {
  const at = new Date(Date.now() - 2 * 3_600_000).toISOString();
  let removed = false;
  let row: Row = {};
  await noGoogle(page);
  await page.route("**/rest/v1/calendar_accounts*", async (route) => {
    const url = new URL(route.request().url());
    // Only the live read: the tombstone read (deleted_at=not.is.null) stays as it is.
    if (route.request().method() !== "GET" || url.search.includes("deleted_at=not.")) {
      return route.continue();
    }
    const response = await route.fetch();
    const rows = (await response.json()) as Row[];
    row = {
      id: GOOGLE_ACCOUNT,
      workspace_id:
        rows[0]?.workspace_id ?? url.searchParams.get("workspace_id")?.replace(/^eq\./, ""),
      owner_id: null,
      provider: "google",
      external_id: `google:${GOOGLE_LOGIN}:work`,
      display_label: "Work",
      is_default_target: false,
      color: null,
      last_sync_at: at,
      status,
      sync_token: null,
      deleted_at: null,
      created_at: at,
      updated_at: at,
    };
    await route.fulfill({ response, json: removed ? rows : [...rows, row] });
  });
  const answer = (path: string, body: (route: Route) => unknown) =>
    page.route(`**/rest/v1/rpc/${path}*`, (route) => route.fulfill(json(body(route))));
  await answer("calendar_op_account_upsert", () => null);
  await answer("calendar_op_account_remove", () => ((removed = true), null));
  await answer("calendar_op_account_restore", () => ((removed = false), [row]));
  await answer("calendar_op_mirror_events", () => ({}));
  return () => removed;
}

/** Ana (the seeded teammate, who shares Busy only) is busy tomorrow morning and early afternoon. */
export async function mateBusy(page: Page) {
  let mate: { calendar_id: string; owner_id: string } | null = null;
  await page.route("**/rest/v1/rpc/calendar_busy_blocks*", async (route) => {
    const req = route.request();
    const body = (req.postDataJSON() ?? {}) as Row;
    const response = await route.fetch();
    const rows = (await response.json()) as Row[];
    // Preview as (p_as) is your own week as she sees it: leave it alone.
    if (body.p_as) return route.fulfill({ response, json: rows });
    if (!mate) {
      const h = req.headers();
      const res = await page.request.post(
        req.url().replace(/calendar_busy_blocks.*/, "calendar_shared_with_me"),
        {
          headers: { apikey: h.apikey ?? "", authorization: h.authorization ?? "" },
          data: { p_workspace_id: body.p_workspace_id },
        },
      );
      mate = ((await res.json()) as (typeof mate)[]).find(Boolean) ?? null;
    }
    if (!mate) return route.fulfill({ response, json: rows });
    const at = (h: number, m = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    const busy = [
      [at(8), at(10, 30)],
      [at(13), at(14, 30)],
    ].map(([start_time, end_time]) => ({
      ...mate,
      start_time,
      end_time,
      kind: "event",
      all_day: false,
    }));
    await route.fulfill({ response, json: [...rows, ...busy] });
  });
}

/** Offers answer at the network: nothing is held on anyone's week. */
export async function fakeOffers(page: Page) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/rest/v1/rpc/calendar_op_offer_create*", (route) =>
    route.fulfill(
      json({
        id: "00000000-0000-4000-8000-00000000c001",
        slug: "lab-offer",
        status: "open",
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        hold_event_ids: [],
      }),
    ),
  );
  await page.route("**/rest/v1/rpc/calendar_op_offer_release*", (route) =>
    route.fulfill(json("released")),
  );
}

/** The guest page's function: the booking link's preview with a few open times; never a booking. */
export async function fakeGuestPage(page: Page) {
  await page.context().route("**/functions/v1/booking-public*", (route) => {
    const body = (route.request().postDataJSON() ?? {}) as Row;
    if (body.action !== "preview") return route.fulfill({ status: 403, body: "{}" });
    const slots: string[] = [];
    for (let d = 1; slots.length < 9; d++) {
      const day = new Date();
      day.setDate(day.getDate() + d);
      if (day.getDay() === 0 || day.getDay() === 6) continue;
      for (const h of [9, 11, 15]) slots.push(new Date(day.setHours(h, 0, 0, 0)).toISOString());
    }
    return route.fulfill(
      json({
        slug: "intro-call-lab",
        name: "Intro call",
        description: "",
        durationMinutes: 30,
        hostName: "Robin Hale",
        hostAvatarUrl: null,
        hostTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        noteEnabled: true,
        guestsEnabled: true,
        questions: [{ id: "q1", label: "What would you like to cover?", required: false }],
        paused: false,
        slots,
        video: "google_meet",
        videoOptions: ["google_meet"],
      }),
    );
  });
}

/**
 * The lab person's own RPCs, with the headers and workspace the page itself uses (read
 * again to catch them): for a journey that makes its own data and deletes it at the end.
 */
export async function asMe(page: Page) {
  const seen = page.waitForRequest((r) => r.url().includes("/rpc/calendar_events_visible"));
  await reread(page);
  const req = await seen;
  const h = req.headers();
  const base = req.url().replace(/\/rpc\/.*/, "/rpc/");
  const ws = (req.postDataJSON() as Row).p_workspace_id;
  return async (fn: string, args: Row) => {
    const res = await page.request.post(base + fn, {
      headers: { apikey: h.apikey ?? "", authorization: h.authorization ?? "" },
      data: { p_workspace_id: ws, ...args },
    });
    return (await res.json()) as Row | Row[];
  };
}
