/**
 * Shared helpers for billing e2e tests.
 *
 * Tests rely on Supabase / Stripe sandbox environments via env vars:
 *   E2E_BASE_URL          – app base URL  (default: http://localhost:8081)
 *   E2E_SUPABASE_URL      – Supabase project URL
 *   E2E_SUPABASE_ANON_KEY – Supabase anon key
 *   E2E_TEST_EMAIL_DOMAIN – disposable domain for generated email addresses
 *   STRIPE_SECRET_KEY     – Stripe test-mode secret key (for direct API calls)
 */

import { Page } from '@playwright/test';

export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8081';

/** Generate a unique test email address. */
export function testEmail(label: string = 'user'): string {
  const domain = process.env.E2E_TEST_EMAIL_DOMAIN ?? 'mailinator.com';
  return `e2e-${label}-${Date.now()}@${domain}`;
}

/**
 * Complete OTP-less signup by navigating to the auth page and submitting an
 * email address. In CI, the Supabase project should be configured with the
 * magic-link OTP auto-confirm feature (or a test SMTP trap).
 *
 * This helper fills in the email field, clicks the "Send code" button, and
 * then waits for the OTP input to appear — it does NOT enter the code itself
 * because the actual delivery mechanism varies by environment.
 */
export async function fillSignupEmail(page: Page, email: string): Promise<void> {
  await page.goto(`${BASE_URL}/auth?mode=signup`);
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: /send code/i }).click();
}

/** Navigate to the app's billing / paywall section. */
export async function goToBilling(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/settings#billing`);
}

/** Navigate to workspace settings (for invite testing). */
export async function goToWorkspaceSettings(page: Page, workspaceId: string): Promise<void> {
  await page.goto(`${BASE_URL}/workspace/${workspaceId}/settings`);
}
