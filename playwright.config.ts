import { defineConfig, devices } from "@playwright/test";

const STORYBOOK_URL = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";
// An e2e run against a dev server you started yourself (a worktree's own
// port, pointed at the local stack): set E2E_BASE_URL and no servers start.
const E2E_BASE_URL = process.env.E2E_BASE_URL;

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
      testIgnore: ["**/visual/**"],
      use: {
        ...devices["Desktop Chrome"],
        baseURL: E2E_BASE_URL ?? "http://127.0.0.1:8081",
      },
    },
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
        {
          command: "bun run dev:web",
          url: "http://127.0.0.1:8081",
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: "bun run storybook -- --no-open --ci",
          url: STORYBOOK_URL,
          reuseExistingServer: true,
          timeout: 180_000,
        },
      ],
});
