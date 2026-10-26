/**
 * trial-functions.spec.ts
 *
 * Auth contract of the billing edge functions. Trials and plans are decided server-side
 * (start-trial, extend-trial, create-checkout-session) and land via the Stripe Sync Engine.
 */

import { expect, test } from "@playwright/test";

const EDGE_BASE = process.env.E2E_SUPABASE_URL
  ? `${process.env.E2E_SUPABASE_URL}/functions/v1`
  : null;

test.describe("billing edge functions", () => {
  test.skip(!EDGE_BASE, "E2E_SUPABASE_URL not set — skipping edge function tests");

  for (const fn of ["start-trial", "extend-trial", "create-checkout-session"]) {
    test(`POST /${fn} without auth returns 401`, async ({ request }) => {
      const res = await request.post(`${EDGE_BASE}/${fn}`, {
        data: {},
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status()).toBe(401);
    });
  }

  test("GET /extend-trial returns 405", async ({ request }) => {
    const res = await request.get(`${EDGE_BASE}/extend-trial`);
    expect(res.status()).toBe(405);
  });

  // MOD-550: checkout creates Stripe objects, so only POST reaches it, and the
  // token never travels in the URL.
  test("GET /create-checkout-session returns 405, even with ?access_token", async ({ request }) => {
    const res = await request.get(`${EDGE_BASE}/create-checkout-session?plan=pro&access_token=x`);
    expect(res.status()).toBe(405);
  });

  test("POST /create-checkout-session with only ?access_token returns 401", async ({ request }) => {
    const res = await request.post(`${EDGE_BASE}/create-checkout-session?access_token=x`, {
      data: { plan: "pro" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(401);
  });
});
