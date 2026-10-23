// Moduo's product lab config: what /product-lab drives and /product-jury scores. The contract
// is .claude/skills/product-lab/references/config.md. It runs against the production web build
// on the shared LOCAL Supabase stack (bun run local:up; never reset it for a lab run), signed in
// as seeded lab people (seed.ts), so every frame shows test data only.
//
//   bun run build:web
//   node .claude/skills/product-lab/scripts/lab.mjs --label <name>

import type { BrowserContext, Locator, Page } from "@playwright/test";

import { signInPage } from "../tests/support/local-stack.ts";
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
      ready: readyWhen("[role='tree'][aria-label='Notes']"),
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
      ready: readyWhen("nav[aria-label='Workspace navigation']"),
      states: { default: {}, empty: { seed: "empty" } },
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
