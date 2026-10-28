// Moduo's product lab config: what /product-lab drives and /product-jury scores. The contract
// is .claude/skills/product-lab/references/config.md. It runs against the production web build
// on the shared LOCAL Supabase stack (bun run local:up; never reset it for a lab run), signed in
// as seeded lab people (seed.ts), so every frame shows test data only.
//
//   bun run build:web
//   node .claude/skills/product-lab/scripts/lab.mjs --label <name>

import type { BrowserContext, Locator, Page } from "@playwright/test";

import { signInPage } from "../tests/support/local-stack.ts";
import { atSmallestWindow, withSecondZone } from "./calendar-acts.ts";
import { composeJourney, composerInput, composingState } from "./calendar-composer.ts";
import { planJourneys } from "./journeys-plan.ts";
import { seed, type Seeded, type Variant } from "./seed.ts";

const PORT = Number(process.env.LAB_PORT ?? 4317);

type Ctx = { context: BrowserContext; page: Page; seed: Seeded; variant: string };
type Target = string | Locator;
/** The helpers the lab passes a journey; using them (not `page`) keeps the input counts honest. */
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

const capture = (page: Page) => page.getByRole("dialog", { name: "Capture" });

/** A task's row in the centre list. */
const rowOf = (page: Page, title: string) =>
  page
    .getByRole("main")
    .getByText(title, { exact: true })
    .first()
    .locator(
      "xpath=ancestor::*[.//button[@aria-label='Mark as done' or @aria-label='Mark as not done']][1]",
    );
/** Done (its glyph flips) or filed away out of the list. */
const doneOrGone = async (page: Page, title: string) =>
  (await page.getByRole("main").getByText(title, { exact: true }).count()) === 0 ||
  (await rowOf(page, title).getByRole("button", { name: "Mark as not done" }).count()) > 0;

/** Ready = the landmark is up and the first reads have landed (Realtime's socket doesn't count). */
const readyWhen =
  (selector: string) =>
  async ({ page }: { page: Page }) => {
    await page.locator(selector).first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  };
const tasksNav = (page: Page) => page.getByRole("navigation", { name: "Tasks" });

// ── Calendar ────────────────────────────────────────────────────────────────────────────
const calToolbar = (page: Page) => page.getByRole("toolbar", { name: "Calendar controls" });
/** The toolbar's text, which carries the visible range ("Oct 25 – Oct 31"). */
const calRange = async (page: Page) => (await calToolbar(page).innerText()).replace(/\s+/g, " ");
/** An event or task block on the grid (titles also show in the right panel, so stay in main). */
const onGrid = (page: Page, title: string) =>
  page.getByRole("main").getByText(title, { exact: true }).first();
const quickCreateTitle = (page: Page) => page.getByRole("textbox", { name: "Event title" }).first();
const localKey = (d: Date) =>
  `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
/**
 * "Google Calendar didn't sync": the lab has no Google account, so the reads are rewritten in
 * the browser. A connected Google calendar in the error state joins the accounts, the first
 * few events of the week become its events, and its sync writes are answered without touching
 * the stack. Then the page reads again.
 */
async function staleGoogleWeek(page: Page) {
  const accountId = "00000000-0000-4000-8000-00000000a11b";
  const lastSync = new Date(Date.now() - 2 * 3_600_000).toISOString();
  await page.route("**/rest/v1/calendar_accounts*", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as Record<string, unknown>[];
    const workspaceId =
      rows[0]?.workspace_id ??
      new URL(route.request().url()).searchParams.get("workspace_id")?.replace(/^eq\./, "");
    await route.fulfill({
      response,
      json: [
        ...rows,
        {
          id: accountId,
          workspace_id: workspaceId,
          owner_id: null,
          provider: "google",
          external_id: "google:robin.hale@gmail.com:work",
          display_label: "Work",
          is_default_target: false,
          color: null,
          last_sync_at: lastSync,
          status: "error",
          sync_token: null,
          deleted_at: null,
          created_at: lastSync,
          updated_at: lastSync,
        },
      ],
    });
  });
  await page.route("**/rest/v1/rpc/calendar_events_visible*", async (route) => {
    const response = await route.fetch();
    const rows = (await response.json()) as Record<string, unknown>[];
    await route.fulfill({
      response,
      json: rows.map((row, i) => (i % 3 === 0 ? { ...row, source_account_id: accountId } : row)),
    });
  });
  await page.route("**/rest/v1/rpc/calendar_op_account_upsert*", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "null" }),
  );
  await page.reload();
  await page.getByText("didn't sync").first().waitFor({ timeout: 15_000 });
}

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
/** The grid's scroller, scrolled so `hour` sits at the top. */
const scrollGridTo = (page: Page, hour: number) =>
  page.evaluate((h) => {
    let el = document.querySelector("[data-day-col]")?.parentElement ?? null;
    while (el && !(el.scrollHeight > el.clientHeight + 4)) el = el.parentElement;
    if (el) el.scrollTop = (el.scrollHeight / 24) * h;
  }, hour);
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
/** The sidebar's Inbox row once it counts `n` (a capture lands there, not in All). */
/** The Inbox's count now (journeys share one seeded person, so proofs are relative). */
const inboxNow = async (page: Page) => {
  const text = await tasksNav(page)
    .getByRole("button", { name: /^Inbox/ })
    .first()
    .textContent();
  return Number(/(\d+)/.exec(text ?? "")?.[1] ?? 0);
};

export default {
  purpose:
    "A desktop workspace where a founder runs the week: tasks, notes, calendar and scheduling, email, contacts and team chat in one app, linked to each other",
  users:
    "Founders, solo operators and small teams; open all day, used in short bursts dozens of times a day, keyboard-heavy",
  platform: "macos-desktop",
  primaryTheme: "dark",

  baseURL: `http://127.0.0.1:${PORT}`,
  server: {
    command: `MODUO_TARGET=web ../../node_modules/.bin/rsbuild preview --host 127.0.0.1 --port ${PORT}`,
    cwd: "apps/app",
    timeout: 60_000,
  },

  viewport: { width: 1440, height: 900 },
  windows: [
    [1024, 700],
    [1280, 800],
    [1920, 1080],
  ],
  // Dark only: light-mode tuning is out of scope (AGENTS.md), and Moduo's theme is a synced
  // appearance setting (lib/appearance.ts) that the cloud copy wins over a seeded local mirror,
  // so a light capture needs the lab person's user_preferences set first. Reduced motion still runs.
  themes: ["dark"],

  tokens: {
    files: ["apps/app/src/styles/tokens.css"],
    // People's own content and canvases are legitimate variety, not drift.
    exclude: [
      "[data-lexical-editor] *",
      "[contenteditable='true'] *",
      ".react-flow *",
      // Avatars carry each person's own colour.
      "[data-slot^='avatar']",
      "[data-slot^='avatar'] *",
      "img",
      "svg *",
    ],
  },

  // The shared local stack runs without its Edge Function runtime unless someone started
  // `bun run local:functions`, so start-trial and friends answer 503 there. Environment, not app.
  ignore: { console: ["status of 503"], requests: ["/functions/v1/"] },

  async setup({ log }: { log: (...a: string[]) => void }) {
    return seed(log);
  },

  async auth({ page, seed: seeded, variant }: Ctx) {
    const who =
      seeded.people[(variant as Variant) in seeded.people ? (variant as Variant) : "default"];
    await signInPage(page, who.session, who.workspaceId, { welcome: variant === "first-run" });
    // Pre-answer the analytics prompt so it doesn't cover every frame.
    await page.addInitScript((id) => {
      window.localStorage.setItem(`moduo:consent:${id}`, "denied");
    }, who.session.user.id);
  },

  screens: [
    {
      id: "home",
      title: "Home",
      path: "/",
      ready: readyWhen("nav[aria-label='Workspace navigation']"),
      states: { default: {}, firstRun: { seed: "first-run" }, offline: { offline: true } },
    },
    {
      id: "notes",
      title: "Notes",
      path: "/notes",
      // The Inbox header is there in every state (an empty section has no tree).
      ready: readyWhen("[data-drop-header='inbox']"),
      states: {
        default: {},
        empty: { seed: "empty" },
        error: { fail: { match: "**/rest/v1/notes*", status: 500 } },
      },
    },
    {
      id: "calendar",
      title: "Calendar",
      path: "/calendar",
      ready: readyWhen("[role='toolbar'][aria-label='Calendar controls']"),
      // Day, Week and Month (CALR-12); no Agenda yet.
      states: {
        default: {},
        empty: { seed: "empty" },
        day: {
          act: async ({ page }: { page: Page }) => page.getByRole("radio", { name: "Day" }).click(),
        },
        // Day view, tomorrow: the design review carries its people and Meet beside it.
        dayPrep: {
          act: async ({ page }: { page: Page }) => {
            await page.getByRole("radio", { name: "Day" }).click();
            await page.getByRole("button", { name: "Next period (→)" }).click();
          },
        },
        month: {
          act: async ({ page }: { page: Page }) =>
            page.getByRole("radio", { name: "Month" }).click(),
        },
        // A crowded month: "N more" on the busy days, bars, due counts.
        monthDense: {
          seed: "dense",
          act: async ({ page }: { page: Page }) =>
            page.getByRole("radio", { name: "Month" }).click(),
        },
        // The dense person's week: 60 events, 300 tasks with due dates spread across it.
        dense: { seed: "dense" },
        // The same week in the afternoon, where three and four meetings overlap.
        overlaps: {
          seed: "dense",
          act: async ({ page }: { page: Page }) => scrollGridTo(page, 13),
        },
        // Monday's stack of all-day items and trips at the smallest window (1024 x 700).
        allDayOverflow: { seed: "dense", act: atSmallestWindow },
        long: { seed: "long" },
        // CALR-13: one side panel (Plan) at the smallest window; a second zone (Z).
        narrow: { act: atSmallestWindow },
        twoZones: { act: withSecondZone },
        eventOpen: {
          act: async ({ page }: { page: Page }) => onGrid(page, "Design review with Ana").click(),
        },
        eventDetail: {
          act: async ({ page }: { page: Page }) => {
            await onGrid(page, "Design review with Ana").click();
            await page.getByRole("dialog").getByRole("button", { name: "Open" }).click();
          },
        },
        loading: { delay: { match: "**/rest/v1/**", ms: 5000 }, capture: "early" },
        // The app is up and only the week's events are on their way: the skeletons in the
        // last known shape (the state above holds the whole app at its boot screen).
        loadingEvents: {
          delay: { match: "**/rest/v1/rpc/calendar_events_visible*", ms: 5000 },
          capture: "early",
        },
        error: { fail: { match: "**/rest/v1/rpc/calendar_events_visible*", status: 500 } },
        // One Google calendar didn't sync: the banner, "Not synced" in the rail, stale marks.
        syncError: { act: async ({ page }: { page: Page }) => staleGoogleWeek(page) },
        offline: { offline: true },
        composing: composingState,
      },
    },
    {
      id: "contacts",
      title: "Contacts",
      path: "/contacts",
      ready: readyWhen("nav[aria-label='Workspace navigation']"),
      states: { default: {}, empty: { seed: "empty" } },
    },
    {
      id: "chat",
      title: "Chat",
      path: "/chat",
      ready: readyWhen("nav[aria-label='Conversations']"),
      states: { default: {}, offline: { offline: true } },
    },
    {
      id: "email",
      title: "Email",
      path: "/email",
      ready: readyWhen("nav[aria-label='Workspace navigation']"),
      states: { default: {} },
    },
    {
      id: "tasks",
      title: "Tasks",
      path: "/tasks?place=all",
      ready: readyWhen("nav[aria-label='Tasks']"),
      states: {
        default: {},
        // A cleared Inbox, the empty state people actually meet (a new workspace gets starter
        // tasks and the welcome instead: that is firstRun).
        empty: { path: "/tasks?place=inbox" },
        dense: { seed: "dense" },
        long: { seed: "long" },
        firstRun: { seed: "first-run", path: "/tasks" },
        loading: { delay: { match: "**/rest/v1/**", ms: 5000 }, capture: "early" },
        error: { fail: { match: "**/rest/v1/tasks*", status: 500 } },
        offline: { offline: true },
      },
    },
  ],

  journeys: [
    {
      id: "capture-task",
      screen: "tasks",
      goal: "Write down a task the moment it comes to mind, without leaving what you are doing",
      target: { keys: 42, clicks: 1 },
      async keyboard({ press, type, step, page }: J) {
        const before = await inboxNow(page);
        await press("Meta+Shift+K");
        await step("capture open", { expect: capture(page) });
        await type("Call the bank about the card limit");
        await press("Enter");
        await step("task saved", {
          gone: capture(page),
          expect: async () => (await inboxNow(page)) > before,
        });
      },
      async pointer({ click, type, step, page }: J) {
        const before = await inboxNow(page);
        await click(page.getByRole("button", { name: "New", exact: true }));
        await step("new task open", { expect: capture(page) });
        await type("Ask Ana for the logo files");
        await click(capture(page).getByRole("button", { name: /^Create(?!\s*more)/ }));
        await step("task saved", {
          gone: capture(page),
          expect: async () => (await inboxNow(page)) > before,
        });
      },
    },
    {
      id: "open-task",
      screen: "tasks",
      goal: "Open a task to read and change its details",
      target: { keys: 2, clicks: 1 },
      async keyboard({ press, step, page }: J) {
        await press("ArrowDown");
        await step("next task selected");
        await press("Enter");
        await step("task open", { expect: async () => /[?&]id=/.test(page.url()), view: true });
      },
      async pointer({ click, step, page }: J) {
        await click(page.getByRole("main").getByText("Call Priya about the term sheet").first());
        await step("details open", {
          expect: page.getByText("Call Priya about the term sheet").nth(1),
        });
      },
    },
    {
      id: "complete-task",
      screen: "tasks",
      goal: "Tick off a task you just finished",
      target: { keys: 2, clicks: 1 },
      async keyboard({ press, step, page }: J) {
        await press("j");
        await step("next task selected");
        await press("x");
        await step("task done", {
          expect: () => doneOrGone(page, "Review the pricing page with Ana"),
        });
      },
      async pointer({ click, step, page }: J) {
        await click(
          rowOf(page, "Write the launch announcement").getByRole("button", {
            name: "Mark as done",
          }),
        );
        await step("task done", {
          expect: () => doneOrGone(page, "Write the launch announcement"),
        });
      },
    },
    {
      id: "go-to-calendar",
      screen: "tasks",
      goal: "Check what's on the calendar today",
      target: { keys: 0, clicks: 1 },
      async pointer({ click, step, page }: J) {
        await click(
          page
            .getByRole("navigation", { name: "Workspace navigation" })
            .getByText("Calendar", { exact: true }),
        );
        await step("calendar", { expect: page.getByText("Team standup").first(), view: true });
      },
    },
    {
      id: "switch-view",
      screen: "tasks",
      goal: "See the same tasks as a board, then as a timeline",
      target: { keys: 0, clicks: 2 },
      async pointer({ click, step, page }: J) {
        await click(page.getByRole("radio", { name: "Board view" }));
        await step("board", {
          expect: page.getByRole("radio", { name: "Board view", checked: true }),
          view: true,
        });
        await click(page.getByRole("radio", { name: "Timeline view" }));
        await step("timeline", {
          expect: page.getByRole("radio", { name: "Timeline view", checked: true }),
          view: true,
        });
      },
    },
    {
      id: "home-capture",
      screen: "home",
      goal: "Jot a task from Home and see it join the list",
      target: { keys: 30, clicks: 1 },
      async pointer({ click, type, press, step, page }: J) {
        await click(page.getByPlaceholder(/Capture a task/));
        await type("Order business cards");
        await press("Enter");
        await step("task in the list", { expect: page.getByText("Order business cards").first() });
      },
    },
    {
      id: "new-note",
      screen: "notes",
      goal: "Start a new note and give it a title",
      target: { keys: 22, clicks: 0 },
      async keyboard({ press, type, step, page }: J) {
        await press("Meta+n");
        await step("blank note", {
          expect: page.locator(".notes-editor-v2 [contenteditable]").first(),
        });
        await type("Weekly review, week 43");
        await step("note in the tree", {
          expect: page.getByRole("treeitem", { name: /Weekly review, week 43/ }).first(),
        });
      },
    },
    {
      id: "send-message",
      screen: "chat",
      goal: "Reply to a teammate in the team channel",
      target: { keys: 40, clicks: 1 },
      async pointer({ click, type, press, step, page }: J) {
        await click(page.locator('[data-chat-composer] [contenteditable="true"]'));
        await type("Sending the deck to Priya now, thanks!");
        await press("Enter");
        await step("message sent", {
          expect: page.getByRole("article").filter({ hasText: "Sending the deck to Priya now" }),
        });
      },
    },
    // ── Calendar ──────────────────────────────────────────────────────────────────────────
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
        const toast = page.getByText("Event deleted", { exact: true });
        await press("Backspace");
        await step("deleted", { expect: toast });
        await press("Meta+z");
        await step("restored", { gone: toast });
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
        const toast = page.getByText("Event added", { exact: true });
        await press("Meta+d");
        await step("duplicated", { expect: toast });
        await press("Meta+z");
        await step("taken back", { gone: toast });
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
            (await page
              .getByRole("button", { name: "Complete Draft the homepage copy" })
              .count()) === 0,
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
      // Below 1600 px the calendars panel starts folded (CALR-13): open it first.
      target: { keys: 0, clicks: 2 },
      async pointer({ click, step, page }: J) {
        const before = await calRange(page);
        const expand = page.getByRole("button", { name: "Expand left panel" });
        if (await expand.isVisible()) await click(expand);
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
  ],
  overlays: [
    {
      id: "capture",
      screen: "tasks",
      kind: "dialog",
      open: "Meta+Shift+K",
      selector: "[role='dialog']",
      close: "Escape",
    },
    {
      id: "search",
      screen: "tasks",
      kind: "dialog",
      open: "Meta+k",
      selector: "[role='dialog']",
      close: "Escape",
    },
    {
      id: "display-options",
      screen: "tasks",
      kind: "popover",
      open: async ({ page }: { page: Page }) =>
        page.getByRole("button", { name: "Display", exact: true }).click(),
      selector: "[role='dialog']",
      close: "Escape",
    },
    {
      id: "event-card",
      screen: "calendar",
      kind: "popover",
      open: async ({ page }: { page: Page }) => onGrid(page, "Team standup").click(),
      selector: "[role='dialog']",
      close: "Escape",
    },
    {
      id: "quick-create",
      screen: "calendar",
      kind: "popover",
      open: "Meta+n",
      selector: "[role='dialog']",
      close: "Escape",
    },
    {
      id: "row-menu",
      screen: "tasks",
      kind: "menu",
      open: async ({ page }: { page: Page }) =>
        page
          .getByRole("main")
          .getByText("Pick the hero photo", { exact: true })
          .click({ button: "right" }),
      selector: "[role='menu']",
      close: "Escape",
    },
  ],
};
