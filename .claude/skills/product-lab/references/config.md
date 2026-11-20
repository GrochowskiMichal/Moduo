# lab.config.mjs: how a project describes itself to the lab

The lab knows nothing about an app until the project declares it. One ES module, default export,
found in this order: `--config <path>`, `./lab.config.mjs`, `./e2e/lab/lab.config.mjs`,
`./.lab/lab.config.mjs`. Node 22.6+ runs it, so it may import `.ts` helpers with explicit
extensions (type annotations are stripped; no enums or namespaces).

```js
export default {
  // Context for the critic. Never the product's name: the critic is blind to brand claims.
  purpose: "A desktop workspace where founders run tasks, notes, calendar, email and chat",
  users: "Founders, solo operators and teams of up to about 20, daily, many hours a week",
  platform: "macos-desktop", // macos-desktop | windows-desktop | web | web-mobile
  primaryTheme: "dark",

  baseURL: "http://127.0.0.1:4173",
  // Optional. The lab starts it when baseURL does not answer, and stops it at the end.
  server: { command: "bun run preview:web --port 4173", cwd: ".", timeout: 120000 },

  viewport: { width: 1440, height: 900 },
  windows: [[1024, 700], [1280, 800], [1440, 900], [1920, 1080]],
  themes: ["dark", "light"],               // the first one is primary
  // Optional: how to switch theme when prefers-color-scheme is not enough.
  async theme({ context, page }, theme) {},

  // Design tokens: CSS files whose custom properties are the system, plus elements whose
  // values are user content and stay out of the drift score.
  tokens: {
    files: ["apps/app/src/styles/tokens.css"],
    exclude: ["[data-lexical-editor] *", ".react-flow__viewport *", "[data-user-color]"],
  },

  // Seed data and sign in. setup() runs once; auth() runs for every new browser context.
  async setup({ log }) { return { /* anything auth() and the states need */ }; },
  async auth({ context, page, seed, variant }) {},   // variant: a state's `seed` name or "default"
  async teardown({ seed }) {},

  screens: [
    {
      id: "tasks",
      title: "Tasks list",
      path: "/tasks",
      ready: "[data-slot='tasks-view']:not([aria-busy])",  // selector or async ({ page }) => {}
      states: {
        default: {},
        empty:   { seed: "empty" },                 // auth() gets variant "empty"
        dense:   { seed: "dense" },
        long:    { seed: "long" },
        loading: { delay: { match: "**/rest/v1/**", ms: 4000 }, capture: "early" },
        error:   { fail: { match: "**/rest/v1/tasks*", status: 500 } },
        offline: { offline: true },
        firstRun:{ seed: "first-run" },
      },
    },
  ],

  // Essential journeys, 10-15. The goal is what the critic reads; the steps are a script.
  journeys: [
    {
      id: "capture-task",
      screen: "tasks",
      goal: "Write down a task for tomorrow without leaving the keyboard",
      target: { keys: 18, clicks: 0 },   // the shortest known path, per mode that matters
      async keyboard({ page, step, type, press }) {
        await press("Meta+K"); await step("command menu open");
        await type("Call the bank tomorrow"); await press("Enter"); await step("task saved");
      },
      async pointer({ page, step, click }) {},
    },
  ],

  // Overlays to time and interrupt: menus, popovers, dialogs, sheets, panels.
  overlays: [
    { id: "command-menu", screen: "tasks", kind: "menu",
      open: async ({ page }) => page.keyboard.press("Meta+K"),
      selector: "[role='dialog']", close: "Escape" },
  ],

  hover: { selector: "button, a[href], [role='tab'], [role='menuitem'], [role='option']", max: 12 },
  focus: { stops: 25 },

  // Environment noise, never app bugs: a local service that isn't running. Regex strings.
  ignore: { console: ["status of 503"], requests: ["/functions/v1/"] },
};
```

## Rules

- **Seeded data only.** The lab screenshots everything it sees. Point it at a local or disposable
  backend with seeded people, never at production or a real account.
- **Helpers passed to journeys** wrap Playwright so the counters stay honest: `press(keys)`,
  `type(text)` (counts one key per character), `click(locator | selector)` (counts the click and
  the pointer travel from the last point), `step(label)` (frame plus trace slice). Calling
  `page` directly works but is not counted, so the keystroke cost would be wrong.
- **States** are applied in this order: `seed` (new context signed in as that variant), `offline`,
  `delay`, `fail`, then the screen's `path` and `ready`. `capture: "early"` screenshots 600 ms
  after navigation instead of waiting for `ready` (for loading states).
- **Missing pieces are fine.** A screen with only `default` still gets windows, focus, hover,
  tokens and axe. A journey with only `keyboard` is run keyboard-only and the report says so.
- **No config at all:** `lab.mjs --init` writes a starter `./lab.config.mjs` with every gap
  marked `TODO`. Fill seeds, screens and journeys before trusting a run.
- **`ignore` is for the environment only.** Every pattern hides evidence from the critic and the
  reliability gate, so each one needs a comment saying which service is missing and why.
- **Journey steps** take options: `step(label, { expect, gone, view, timeout })`. `expect` is a
  selector or locator that must become visible, or an async predicate polled until true (for
  proofs no single element shows: a count went up, the URL changed); `gone` must become hidden.
  Either one missing stops the journey with a `no-response` hard fail. `view: true` counts the
  wait as a view switch (feel row 9).
- **Journeys share the seeded data within a run** (keyboard runs first, then pointer). Write
  proofs relative to what the screen showed before (`count > before`), never absolute counts,
  and give each mode its own item to act on.
