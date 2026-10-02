/**
 * trial-extension.spec.ts
 *
 * Verifies the trial-extension edge function contract:
 * - Returns 400 for non-POST requests.
 * - Returns 401 / 400 when called without a valid Stripe signature.
 *
 * Full end-to-end extension (payment_method.attached webhook → 30-day trial)
 * is covered by the Stripe sandbox webhook test in CI.
 */

import { expect, test } from "@playwright/test";

const EDGE_BASE = process.env.E2E_SUPABASE_URL
  ? `${process.env.E2E_SUPABASE_URL}/functions/v1`
  : null;

test.describe("trial-extension edge function", () => {
  test.skip(!EDGE_BASE, "E2E_SUPABASE_URL not set — skipping edge function tests");

  test("GET /trial-extension returns 405", async ({ request }) => {
    const res = await request.get(`${EDGE_BASE}/trial-extension`);
    expect(res.status()).toBe(405);
  });

  test("POST /trial-extension without signature returns 400", async ({ request }) => {
    const res = await request.post(`${EDGE_BASE}/trial-extension`, {
      data: { type: "payment_method.attached", data: {} },
      headers: { "Content-Type": "application/json" },
    });
    // Stripe signature verification should fail → 400 or 401.
    expect([400, 401]).toContain(res.status());
  });

  test("POST /start-trial without auth returns 401", async ({ request }) => {
    const res = await request.post(`${EDGE_BASE}/start-trial`, {
      data: {},
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});
