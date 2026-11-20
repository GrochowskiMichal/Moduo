// Home's lab states beyond the plain ones: the Today widget's now-and-next line
// (a meeting on now with a Meet link, then the next one), answered at the
// network so the line shows whatever time the lab runs. Kept apart so
// lab.config.ts stays under the size limit.

import type { Page } from "@playwright/test";

const at = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function meeting(
  id: string,
  title: string,
  from: number,
  to: number,
  ownerId: string,
  workspaceId: string,
) {
  return {
    id,
    workspace_id: workspaceId,
    owner_id: ownerId,
    calendar_id: "moduo",
    calendar_ref: null,
    source_account_id: null,
    external_event_id: null,
    title,
    description: "",
    location: null,
    start_time: at(from),
    end_time: at(to),
    all_day: false,
    recurring: false,
    recurrence_rule: null,
    status: "confirmed",
    color: null,
    attendees: [],
    conference_url: id.endsWith("1") ? "https://meet.google.com/abc-defg-hij" : null,
    conference_provider: id.endsWith("1") ? "google_meet" : null,
    is_private: false,
    kind: "event",
    exdates: [],
    created_at: at(-60),
    updated_at: at(-60),
    deleted_at: null,
  };
}

/** A meeting on now (joinable) and the next one, on Home's Today widget. */
export const homeNowNextState = {
  act: async ({ page }: { page: Page }) => {
    const ownerId = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((k) => k.endsWith("-auth-token"));
      return key ? (JSON.parse(localStorage.getItem(key) ?? "{}").user?.id ?? "") : "";
    });
    await page.route("**/rest/v1/rpc/calendar_events_visible*", async (route) => {
      const response = await route.fetch();
      const rows = (await response.json()) as Record<string, unknown>[];
      const ws = String(rows[0]?.workspace_id ?? "");
      await route.fulfill({
        response,
        json: [
          ...rows,
          meeting(
            "00000000-0000-4000-8000-0000000c2101",
            "Design review with Ana",
            -15,
            30,
            ownerId,
            ws,
          ),
          meeting("00000000-0000-4000-8000-0000000c2102", "1:1 with Sam", 45, 75, ownerId, ws),
        ],
      });
    });
    await page.reload();
    await page
      .getByRole("button", { name: /^Now: Design review with Ana/ })
      .waitFor({ timeout: 15_000 });
  },
};
