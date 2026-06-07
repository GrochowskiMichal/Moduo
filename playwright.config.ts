import { defineConfig, devices } from "@playwright/test";

const STORYBOOK_URL = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";

export default defineConfig({
  testDir: ".",
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
      testMatch: ["e2e/**/*.spec.ts"],
      testIgnore: ["**/visual/**"],
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://127.0.0.1:8081",
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
  webServer: [
    {
      command: "MODUO_TARGET=web ./node_modules/.bin/rsbuild dev --host 127.0.0.1 --port 8081",
      url: "http://127.0.0.1:8081",
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "./node_modules/.bin/storybook dev -p 6006 --no-open --ci",
      url: STORYBOOK_URL,
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
