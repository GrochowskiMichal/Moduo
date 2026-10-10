import { defineConfig, devices } from "@playwright/test";

const STORYBOOK_URL = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";

export default defineConfig({
  timeout: 30_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
      testDir: "./e2e",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:8081",
      },
    },
    {
      name: "visual",
      testDir: "./tests/visual",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: STORYBOOK_URL,
        viewport: { width: 1280, height: 720 },
        colorScheme: "dark",
      },
    },
  ],
  webServer: [
    {
      command: "bun run dev:web",
      url: "http://127.0.0.1:8081",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    // The smoke run (`bun run e2e:smoke`, CI) never opens Storybook, so it skips the slow start.
    ...(process.env.E2E_NO_STORYBOOK
      ? []
      : [
          {
            command: "bun run storybook -- --no-open --ci",
            url: STORYBOOK_URL,
            reuseExistingServer: true,
            timeout: 180_000,
          },
        ]),
  ],
});
