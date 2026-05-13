import { defineConfig } from '@playwright/test';

/**
 * Playwright config for billing / entitlements e2e tests.
 *
 * Run with:
 *   npx playwright test --config playwright.billing.config.ts
 *
 * Required env vars for full coverage (see e2e/billing/helpers.ts):
 *   E2E_BASE_URL            – app dev server  (default: http://localhost:8081)
 *   E2E_LANDING_URL         – landing dev server (default: http://localhost:3000)
 *   E2E_SUPABASE_URL        – Supabase project URL
 *   E2E_SUPABASE_ANON_KEY   – Supabase anon key
 *   E2E_TEST_EMAIL_DOMAIN   – disposable email domain (default: mailinator.com)
 */
export default defineConfig({
  testDir: './e2e/billing',
  timeout: 45_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8081',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'app-chromium',
      testIgnore: /landing-download/,
      use: {
        browserName: 'chromium',
        baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8081',
      },
    },
    {
      name: 'landing-chromium',
      testMatch: /landing-download/,
      use: {
        browserName: 'chromium',
        baseURL: process.env.E2E_LANDING_URL ?? 'http://localhost:3000',
      },
    },
  ],
  webServer: [
    {
      command: 'bun run dev:web',
      url: process.env.E2E_BASE_URL ?? 'http://localhost:8081',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
