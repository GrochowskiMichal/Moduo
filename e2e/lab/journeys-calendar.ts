// Calendar's lab journeys, kept apart so lab.config.ts stays under the size limit. Same
// contract as the config's journeys; whatever the seed can't hold is answered at the
// network (calendar-network.ts), and a journey that makes data deletes it at the end.

import type { Locator, Page } from "@playwright/test";

import { routeBookingLink } from "./calendar-booking.ts";
import { composeJourney, composerInput } from "./calendar-composer.ts";
import {
  asMe,
  fakeGuestPage,
  fakeOffers,
  GOOGLE_LOGIN,
  googleAccount,
  mateBusy,
  reread,
} from "./calendar-network.ts";
import { onGrid } from "./calendar-states.ts";
import { planJourneys } from "./journeys-plan.ts";

type Target = string | Locator;
type J = {
  page: Page;
  press: (keys: string) => Promise<void>;
  type: (text: string) => Promise<void>;
  click: (target: Target, opts?: object) => Promise<void>;
  step: (
    label: string,
    opts?: {
      expect?: Target | (() => Promise<boolean>);
      gone?: Target;
      view?: boolean;
      timeout?: number;
    },
  ) => Promise<void>;
};

const calToolbar = (page: Page) => page.getByRole("toolbar", { name: "Calendar controls" });
/** The toolbar's text, which carries the visible range ("Oct 25 – Oct 31"). */
const calRange = async (page: Page) => (await calToolbar(page).innerText()).replace(/\s+/g, " ");
const quickCreateTitle = (page: Page) => page.getByRole("textbox", { name: "Event title" }).first();
const localKey = (d: Date) =>
  `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
const toast = (page: Page, text: string | RegExp) =>
  page.getByText(text, { exact: typeof text === "string" }).first();
/** The calendars panel starts folded below 1600 px (CALR-13): a person opens it first. */
const openLeft = async (page: Page, click: J["click"]) => {
  const expand = page.getByRole("button", { name: "Expand left panel" });
  if (await expand.isVisible()) await click(expand);
};

/**
 * A point on empty grid inside the visible scroll area of day `offset` (tomorrow by default),
 * relative to its column: the place a person would click or drop. Falls back to today's
 * column when that day isn't in the visible week.
 */
async function freeSlot(page: Page, offset = 1) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  const keys = [localKey(day), localKey(new Date())];
  return page.evaluate((candidates) => {
    for (const key of candidates) {
      const col = document.querySelector<HTMLElement>(`[data-day-col][data-day-key='${key}']`);
      if (!col) continue;
      let scroller: HTMLElement | null = col.parentElement;
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 4)) {
        scroller = scroller.parentElement;
      }
      const view = (scroller ?? col).getBoundingClientRect();
      const box = col.getBoundingClientRect();
      const x = box.left + box.width / 2;
      for (let y = view.top + view.height * 0.3; y < view.bottom - 24; y += 14) {
        const hit = document.elementFromPoint(x, y);
        if (hit && col.contains(hit) && !hit.closest("[data-chip]")) {
          return { key, x: box.width / 2, y: y - box.top, clientX: x, clientY: y };
        }
      }
    }
    return null;
  }, keys);
}
/** The mini month's button for a day a week away, staying inside the month it shows. */
const miniMonthDay = (page: Page) => {
  const today = new Date();
  const d = new Date(today);
  d.setDate(today.getDate() - 7);
  if (d.getMonth() !== today.getMonth()) d.setDate(today.getDate() + 7);
  const month = d.toLocaleString("en-US", { month: "long" });
  return page
    .getByRole("complementary")
    .getByRole("button", {
      name: new RegExp(`${month} ${d.getDate()}(st|nd|rd|th), ${d.getFullYear()}$`),
    })
    .first();
};

const REPEAT = "Daily check-in";

export const calendarJourneys = [
  {
    id: "cal-jump",
    screen: "tasks",
    goal: "Jump to the calendar from another module without the mouse",
    target: { keys: 2, clicks: 1 },
    async keyboard({ press, step, page }: J) {
      await press("Meta+4");
      await step("calendar", { expect: calToolbar(page), view: true });
    },
  },
  {
    id: "cal-day-week",
    screen: "calendar",
    goal: "Zoom into one day, then back out to the whole week",
    target: { keys: 2, clicks: 2 },
    async keyboard({ press, step, page }: J) {
      await press("d");
      await step("day", {
        expect: page.getByRole("radio", { name: "Day", checked: true }),
        view: true,
      });
      await press("w");
      await step("week", {
        expect: page.getByRole("radio", { name: "Week", checked: true }),
        view: true,
      });
    },
    async pointer({ click, step, page }: J) {
      await click(page.getByRole("radio", { name: "Day" }));
      await step("day", {
        expect: page.getByRole("radio", { name: "Day", checked: true }),
        view: true,
      });
      await click(page.getByRole("radio", { name: "Week" }));
      await step("week", {
        expect: page.getByRole("radio", { name: "Week", checked: true }),
        view: true,
      });
    },
  },
  {
    id: "cal-next-week",
    screen: "calendar",
    goal: "Look ahead at next week, then come back to today",
    target: { keys: 2, clicks: 2 },
    async keyboard({ press, step, page }: J) {
      const before = await calRange(page);
      // ⌘→ since CALR-4: bare arrows move the grid cursor.
      await press("Meta+ArrowRight");
      await step("next week", {
        expect: async () => (await calRange(page)) !== before,
        view: true,
      });
      await press("t");
      await step("back to today", {
        expect: async () => (await calRange(page)) === before,
        view: true,
      });
    },
    async pointer({ click, step, page }: J) {
      const before = await calRange(page);
      await click(page.getByRole("button", { name: /^Next period/ }));
      await step("next week", {
        expect: async () => (await calRange(page)) !== before,
        view: true,
      });
      await click(calToolbar(page).getByRole("button", { name: "Today", exact: true }));
      await step("back to today", {
        expect: async () => (await calRange(page)) === before,
        view: true,
      });
    },
  },
  {
    id: "cal-quick-create",
    screen: "calendar",
    goal: "Put a half-hour call on the calendar right now",
    target: { keys: 22, clicks: 1 },
    async keyboard({ press, type, step, page }: J) {
      await press("Meta+n");
      await step("composer", { expect: composerInput(page) });
      await type("Call the accountant");
      await press("Enter");
      await step("event on the grid", {
        gone: composerInput(page),
        expect: onGrid(page, "Call the accountant"),
      });
    },
    async pointer({ click, type, press, step, page }: J) {
      await click(page.getByRole("button", { name: /^Create new/ }));
      await step("composer", { expect: composerInput(page) });
      await type("Pay the design invoice");
      await press("Enter");
      await step("event on the grid", {
        gone: composerInput(page),
        expect: onGrid(page, "Pay the design invoice"),
      });
    },
  },
  composeJourney,
  {
    id: "cal-compose-teammate",
    screen: "calendar",
    goal: "Type a sync with a teammate tomorrow morning and hop to a time you're both free",
    target: { keys: 36, clicks: 0 },
    async keyboard({ press, type, step, page }: J) {
      await mateBusy(page);
      await reread(page);
      await press("n");
      await step("composer", { expect: composerInput(page) });
      await type("Sync with Ana tomorrow morning");
      const box = page.getByRole("dialog", { name: "New event" });
      await step("her lane and verdict", {
        expect: box.getByText(/Ana Ruiz is (free|busy|in focus time)/),
        view: true,
      });
      await press("Tab");
      await step("both free", { expect: box.getByText(/Ana Ruiz is free/) });
      await press("Enter");
      await step("added", { expect: toast(page, "Event added") });
      await press("Meta+z");
      await step("taken back", { gone: toast(page, "Event added") });
    },
  },
  {
    id: "cal-draw-block",
    screen: "calendar",
    goal: "Block time tomorrow by clicking an empty slot and naming it",
    target: { keys: 24, clicks: 1 },
    async pointer({ click, type, press, step, page }: J) {
      const spot = await freeSlot(page);
      if (!spot) throw new Error("no free slot in view");
      await click(page.locator(`[data-day-col][data-day-key='${spot.key}']`), {
        position: { x: spot.x, y: spot.y },
      });
      await step("new block", { expect: quickCreateTitle(page) });
      await type("Prep for the board call");
      await press("Enter");
      await step("block saved", {
        gone: quickCreateTitle(page),
        expect: onGrid(page, "Prep for the board call"),
      });
    },
  },
  {
    id: "cal-open-event",
    screen: "calendar",
    goal: "Open tomorrow's design review to see what it's about and who it's with",
    target: { keys: 0, clicks: 2 },
    async pointer({ click, step, page }: J) {
      await click(onGrid(page, "Design review with Ana"));
      await step("event card", {
        expect: page.getByRole("dialog").getByRole("button", { name: "Open" }),
      });
      await click(page.getByRole("dialog").getByRole("button", { name: "Open" }));
      await step("event details", {
        expect: page.getByRole("complementary").getByRole("textbox", { name: "Event title" }),
      });
    },
  },
  {
    id: "cal-delete-undo",
    screen: "calendar",
    goal: "Delete an event by mistake, then take it back",
    target: { keys: 3, clicks: 3 },
    // CALR-4: a Moduo event deletes at once; Undo (or ⌘Z) is the safety net.
    async keyboard({ press, step, page }: J) {
      await press("j");
      await step("picked", {
        expect: page.locator("[data-chip='event'] [data-selected='true']"),
      });
      const deleted = page.getByText("Event deleted", { exact: true });
      await press("Backspace");
      await step("deleted", { expect: deleted });
      await press("Meta+z");
      await step("restored", { gone: deleted });
    },
    async pointer({ click, step, page }: J) {
      await click(onGrid(page, "Board prep"));
      await step("event card", {
        expect: page.getByRole("dialog").getByRole("button", { name: "Delete" }),
      });
      await click(page.getByRole("dialog").getByRole("button", { name: "Delete" }));
      await step("deleted", { expect: page.getByRole("button", { name: "Undo" }) });
      await click(page.getByRole("button", { name: "Undo" }));
      await step("restored", { expect: onGrid(page, "Board prep") });
    },
  },
  {
    id: "cal-duplicate-undo",
    screen: "calendar",
    goal: "Pick an event by keys, duplicate it, then take the copy back",
    target: { keys: 3, clicks: 0 },
    async keyboard({ press, step, page }: J) {
      await press("j");
      await step("picked", {
        expect: page.locator("[data-chip='event'] [data-selected='true']"),
      });
      const added = page.getByText("Event added", { exact: true });
      await press("Meta+d");
      await step("duplicated", { expect: added });
      await press("Meta+z");
      await step("taken back", { gone: added });
    },
  },
  {
    id: "cal-copy-paste",
    screen: "calendar",
    goal: "Copy an event by keys, paste it into the next free time, then take the copy back",
    target: { keys: 7, clicks: 0 },
    async keyboard({ press, step, page }: J) {
      await press("j");
      await step("picked", {
        expect: page.locator("[data-chip='event'] [data-selected='true']"),
      });
      await press("Meta+c");
      await step("copied", { expect: toast(page, "Event copied") });
      await press("Meta+v");
      await step("pasted", { expect: toast(page, "Event added") });
      await press("Meta+z");
      await step("taken back", { gone: toast(page, "Event added") });
    },
  },
  {
    id: "cal-edit-occurrence",
    screen: "calendar",
    goal: "Move just one day of a repeating check-in a little later, leaving the rest",
    target: { keys: 4, clicks: 1 },
    // The repeat is made for the journey (the seed has none) and deleted at the end.
    async keyboard({ click, press, step, page }: J) {
      const rpc = await asMe(page);
      const start = new Date();
      start.setDate(start.getDate() + 1);
      start.setHours(16, 30, 0, 0);
      const made = await rpc("calendar_op_event_create", {
        p_title: REPEAT,
        p_starts_at: start.toISOString(),
        p_ends_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
        p_rrule: "FREQ=DAILY;COUNT=5",
      });
      const id = String((Array.isArray(made) ? made[0] : made)?.id ?? "");
      try {
        await reread(page);
        await click(onGrid(page, REPEAT));
        await press("Escape");
        await step("picked", {
          expect: page.locator("[data-chip='event'] [data-selected='true']"),
        });
        await press("Alt+ArrowDown");
        const ask = page.getByRole("dialog", { name: "Change a repeating event" });
        await step("this one or all", { expect: ask });
        await press("Enter");
        await step("only this one moved", { gone: ask, expect: toast(page, "Event moved") });
      } finally {
        if (id) await rpc("calendar_op_event_delete", { p_event_id: id }).catch(() => null);
      }
    },
  },
  {
    id: "cal-complete-due",
    screen: "calendar",
    goal: "Tick off a task that is due today without leaving the calendar",
    target: { keys: 0, clicks: 1 },
    async pointer({ click, step, page }: J) {
      await click(
        page.getByRole("complementary").getByRole("button", {
          name: "Complete Draft the homepage copy",
          exact: true,
        }),
      );
      await step("task done", {
        expect: async () =>
          (await page.getByRole("button", { name: "Reopen Draft the homepage copy" }).count()) >
            0 ||
          (await page.getByRole("button", { name: "Complete Draft the homepage copy" }).count()) ===
            0,
      });
    },
  },
  {
    // dnd-kit needs a real pointer drag, which the helpers don't count: this journey's
    // click and travel figures read 0 for the drag itself.
    id: "cal-schedule-task",
    screen: "calendar",
    goal: "Give a backlog task a time tomorrow by dragging it onto the week",
    target: { keys: 0, clicks: 1 },
    async pointer({ step, page }: J) {
      const title = "Write the backend engineer role";
      const row = page
        .getByRole("complementary")
        .getByRole("button", { name: new RegExp(title) })
        .first();
      const from = await row.boundingBox();
      const spot = await freeSlot(page);
      if (!from || !spot) throw new Error("no task row or free slot in view");
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 - 12, from.y + from.height / 2 + 8, {
        steps: 4,
      });
      await page.waitForTimeout(100);
      await page.mouse.move(spot.clientX, spot.clientY, { steps: 12 });
      await page.waitForTimeout(150);
      await page.mouse.up();
      await step("task on the grid", { expect: onGrid(page, title) });
    },
  },
  ...planJourneys,
  {
    id: "cal-go-to-date",
    screen: "calendar",
    goal: "Look at the same day last week from the month in the sidebar",
    target: { keys: 0, clicks: 2 },
    async pointer({ click, step, page }: J) {
      const before = await calRange(page);
      await openLeft(page, click);
      await click(miniMonthDay(page));
      await step("that week", {
        expect: async () => (await calRange(page)) !== before,
        view: true,
      });
    },
  },
  {
    id: "cal-panel-switch",
    screen: "calendar",
    goal: "Swap the right panel from your task list to the notes about the selected event",
    target: { keys: 0, clicks: 3 },
    async pointer({ click, step, page }: J) {
      await click(onGrid(page, "Team standup"));
      await step("event selected", { expect: page.getByRole("dialog") });
      await click(page.getByRole("button", { name: /^Panel view:/ }));
      const notes = page
        .getByRole("menuitemradio", { name: "Notes" })
        .or(page.getByRole("menuitem", { name: "Notes" }))
        .first();
      await step("panel views", { expect: notes });
      await click(notes);
      await step("notes view", {
        expect: page.getByRole("button", { name: "Panel view: Notes" }),
      });
    },
  },
  {
    id: "cal-offer-times",
    screen: "calendar",
    goal: "Offer three specific times from your booking link and copy the offer, all by keys",
    target: { keys: 6, clicks: 0 },
    // The link and the offer answer at the network: nothing is held on the week.
    async keyboard({ press, step, page }: J) {
      await fakeOffers(page);
      await routeBookingLink(page);
      await press("o");
      const picked = page.locator("[data-picked]");
      await step("offering", { expect: page.getByText(/Pick times on the week/), view: true });
      await press("Enter");
      await press("Enter");
      await press("Enter");
      await step("three times", { expect: picked.nth(2) });
      await press("Meta+c");
      await step("copied", { expect: toast(page, "Offer link copied.") });
    },
  },
  {
    id: "cal-preview-teammate",
    screen: "calendar",
    goal: "See your week as a teammate sees it, then leave the preview",
    target: { keys: 1, clicks: 2 },
    async pointer({ click, press, step, page }: J) {
      await click(page.getByRole("button", { name: "Preview as…" }).first());
      await step("people", { expect: page.getByRole("menuitem", { name: "Ana Ruiz" }) });
      await click(page.getByRole("menuitem", { name: "Ana Ruiz" }));
      const banner = page.getByText(/Your week as Ana Ruiz sees it/);
      await step("her view", { expect: banner, view: true });
      await press("Escape");
      await step("your week again", { gone: banner, view: true });
    },
  },
  {
    id: "cal-booking-guest",
    screen: "calendar",
    goal: "Open your booking link, then its page the way a guest sees it",
    target: { keys: 0, clicks: 3 },
    // The link and the guest page's function answer at the network; nothing is booked.
    async pointer({ click, step, page }: J) {
      await routeBookingLink(page);
      await fakeGuestPage(page);
      await openLeft(page, click);
      await click(page.getByRole("button", { name: "Intro call", exact: true }).first());
      await step("link open", { expect: page.getByText(/open times? this week/), view: true });
      const popup = page.waitForEvent("popup");
      await click(page.getByRole("button", { name: "Guest's view" }));
      const guest = await popup;
      const url = guest.url();
      await guest.close();
      // The guest's tab, shown in this one so the frame captures it.
      await page.goto(url);
      await step("guest's view", { expect: page.getByText("Intro call").first(), view: true });
    },
  },
  {
    id: "cal-remove-account",
    screen: "calendar",
    goal: "Remove a connected Google account, then take it back with Undo",
    target: { keys: 0, clicks: 4 },
    // The account and its removal answer at the network: nobody's data leaves.
    async pointer({ click, step, page }: J) {
      await googleAccount(page, "ok");
      await reread(page);
      await openLeft(page, click);
      await click(page.getByRole("button", { name: GOOGLE_LOGIN }).first());
      const dialog = page.getByRole("dialog", { name: "Calendar accounts" });
      await step("accounts", { expect: dialog });
      await click(dialog.getByRole("button", { name: "Remove this account…" }));
      const removed = dialog.getByText(/was removed/);
      await step("removed", { expect: removed });
      await click(dialog.getByRole("button", { name: "Undo" }));
      await step("back", { gone: removed, expect: dialog.getByText(GOOGLE_LOGIN).first() });
    },
  },
];
