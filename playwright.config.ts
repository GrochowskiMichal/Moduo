import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:8081",
    trace: "on-first-retry",
  },
  webServer: {
    command: "bun run dev:web",
    url: "http://localhost:8081",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
