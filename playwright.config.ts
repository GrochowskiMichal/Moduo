import { defineConfig, devices } from "@playwright/test";
import { e2eAppUrl, e2ePort, runsProject } from "./scripts/agent/e2e-env";

const STORYBOOK_URL = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";
// An e2e run against a dev server you started yourself (a worktree's own
// port, pointed at the local stack): set E2E_BASE_URL and no servers start.
const E2E_BASE_URL = process.env.E2E_BASE_URL;
// Without it the run starts this worktree's own dev server on a port derived
// from the worktree's path (scripts/agent/e2e-env.ts), never 8081, and never
// reuses a server it did not start: a run in worktree A must not test whatever
// B left on 8081. `bun run e2e` in the main checkout works the same way.
const APP_URL = E2E_BASE_URL ?? e2eAppUrl;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "e2e",
      testIgnore: ["**/visual/**", "**/perf/**", "**/clips/**"],
      // One spec at a time: every spec signs in as the same seed person in
      // the same workspace on the local stack, so parallel files read each
      // other's rows (a bell's newest notices, a project's order, the
      // offline queue's sync line). Serial, the whole suite passes together.
      workers: 1,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: APP_URL,
      },
    },
    {
      // The 10,000-task budget (TV-D11b): `bun run perf`, on the local stack.
      name: "perf",
      testMatch: ["**/perf/**/*.spec.ts"],
      timeout: 120_000,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: APP_URL,
      },
    },
    // Tasks' welcome clips (TV-U17): frames of the real app, written to
    // public/welcome. Only with MODUO_CLIPS=1, so a plain `playwright test`
    // (bun run e2e) never rewrites them; run by hand when the UI changes.
    ...(process.env.MODUO_CLIPS
      ? [
          {
            name: "clips",
            testMatch: ["**/clips/**/*.spec.ts"],
            timeout: 180_000,
            use: {
              ...devices["Desktop Chrome"],
              baseURL: APP_URL,
            },
          },
        ]
      : []),
    {
      name: "visual",
      testMatch: ["**/visual/**/*.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        baseURL: STORYBOOK_URL,
        viewport: { width: 1280, height: 720 },
        colorScheme: "dark",
      },
    },
  ],
  webServer: E2E_BASE_URL
    ? []
    : [
        // Playwright starts every entry whatever `--project` says, so each
        // server boots only when a project that needs it is part of the run.
        ...(["e2e", "perf", "clips"].some((name) => runsProject(name))
          ? [
              {
                // Rsbuild directly (not `bun run dev:web`): that script pins
                // --port 8081 on the command line, which would beat the port here.
                command: `./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port ${e2ePort}`,
                env: { MODUO_TARGET: "web" },
                url: APP_URL,
                reuseExistingServer: false,
                timeout: 120_000,
              },
            ]
          : []),
        ...(runsProject("visual")
          ? [
              {
                command: "bun run storybook -- --no-open --ci",
                url: STORYBOOK_URL,
                reuseExistingServer: true,
                timeout: 180_000,
              },
            ]
          : []),
      ],
});
