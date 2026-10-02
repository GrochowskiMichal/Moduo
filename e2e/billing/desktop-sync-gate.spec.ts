/**
 * desktop-sync-gate.spec.ts
 *
 * Verifies the sync worker tier-gate behaviour via the edge function contract.
 *
 * The actual Rust sync worker can only be tested in a Tauri integration
 * environment. These tests instead validate:
 * 1. The profiles REST endpoint returns a plan_tier field.
 * 2. The user_entitlements view is accessible (returns expected columns).
 *
 * Full desktop sync gate (worker self-termination for free tier) is covered by
 * Rust unit tests co-located with src-tauri/src/sync/mod.rs.
 */

import { expect, test } from "@playwright/test";

const SUPABASE_URL = process.env.E2E_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.E2E_SUPABASE_PUBLISHABLE_KEY;

test.describe("Desktop sync tier gate", () => {
  test.skip(
    !SUPABASE_URL || !PUBLISHABLE_KEY,
    "E2E_SUPABASE_URL / E2E_SUPABASE_PUBLISHABLE_KEY not set",
  );

  test("profiles table exposes plan_tier column", async ({ request }) => {
    // Unauthenticated request returns 200 with RLS-filtered (empty) results.
    const res = await request.get(`${SUPABASE_URL}/rest/v1/profiles?select=plan_tier&limit=1`, {
      headers: {
        apikey: PUBLISHABLE_KEY!,
        Authorization: `Bearer ${PUBLISHABLE_KEY!}`,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });

  test("user_entitlements view is accessible", async ({ request }) => {
    const res = await request.get(
      `${SUPABASE_URL}/rest/v1/user_entitlements?select=plan_tier,subscription_status,trial_days_remaining&limit=1`,
      {
        headers: {
          apikey: PUBLISHABLE_KEY!,
          Authorization: `Bearer ${PUBLISHABLE_KEY!}`,
        },
      },
    );
    // View exists → 200 (even if rows are empty for anon).
    expect(res.status()).toBe(200);
  });
});
