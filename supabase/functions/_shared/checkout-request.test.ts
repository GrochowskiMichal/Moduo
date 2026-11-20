// MOD-550 · create-checkout-session's request: no caller-chosen discount, and
// Stripe returns the browser only to Moduo's own hosts (the dev server's only
// on the local stack).
import { describe, expect, it } from "@rstest/core";

import {
  checkoutBody,
  DEV_REDIRECT_ORIGINS,
  isLocalStack,
  REDIRECT_ORIGINS,
  safeRedirectWith,
} from "./checkout-request.ts";

const HOSTED = { supabaseUrl: "https://abcdefgh.supabase.co", appUrl: "https://app.moduo.app" };
const LOCAL = { supabaseUrl: "http://kong:8000", appUrl: undefined };
const FALLBACK = "https://app.moduo.app/?upgrade=success";

describe("checkoutBody", () => {
  it("never carries a coupon, however it is sent", () => {
    const body = checkoutBody({
      plan: "pro",
      interval: "yearly",
      coupon: "FOUNDERS",
      couponCode: "abc123",
      discounts: [{ coupon: "FOUNDERS" }],
      promotion_code: "promo_1",
    });
    expect(body).toEqual({
      plan: "pro",
      interval: "yearly",
      seats: undefined,
      withCard: false,
      successUrl: undefined,
      cancelUrl: undefined,
    });
    expect(Object.keys(body)).not.toContain("coupon");
  });

  it("reads the plan fields as before", () => {
    expect(
      checkoutBody({
        plan: " team ",
        billing_cycle: "monthly",
        seats: 5,
        withCard: true,
        successUrl: "https://app.moduo.app/?upgrade=success",
        cancelUrl: "https://app.moduo.app/?upgrade=cancelled",
      }),
    ).toEqual({
      plan: "team",
      interval: "monthly",
      seats: 5,
      withCard: true,
      successUrl: "https://app.moduo.app/?upgrade=success",
      cancelUrl: "https://app.moduo.app/?upgrade=cancelled",
    });
    expect(checkoutBody({ seats: 2.5, withCard: "true" })).toMatchObject({
      seats: undefined,
      withCard: false,
    });
    expect(checkoutBody(null).plan).toBeUndefined();
    expect(checkoutBody("pro").plan).toBeUndefined();
  });
});

describe("isLocalStack", () => {
  it("is the stack's own Kong or loopback, never a hosted project", () => {
    for (const url of [
      "http://kong:8000",
      "http://127.0.0.1:54321",
      "http://localhost:54321",
      "http://[::1]:54321",
      "http://host.docker.internal:54321",
    ]) {
      expect(isLocalStack(url)).toBe(true);
    }
    for (const url of ["https://abcdefgh.supabase.co", "https://kong.evil.com", "", null, undefined, "nope"]) {
      expect(isLocalStack(url)).toBe(false);
    }
  });
});

describe("safeRedirectWith", () => {
  it("keeps Moduo's own hosts everywhere", () => {
    for (const origin of REDIRECT_ORIGINS) {
      expect(safeRedirectWith(`${origin}/?upgrade=success`, FALLBACK, HOSTED)).toBe(
        `${origin}/?upgrade=success`,
      );
    }
  });

  it("sends a hosted project's dev-server and desktop returns to the fallback", () => {
    for (const url of [
      ...DEV_REDIRECT_ORIGINS.map((o) => `${o}/?upgrade=success`),
      "http://localhost:3000/",
      "tauri://localhost/",
      "http://tauri.localhost/",
      "https://tauri.localhost/",
    ]) {
      expect(safeRedirectWith(url, FALLBACK, HOSTED)).toBe(FALLBACK);
    }
  });

  it("allows the dev server on the local stack only", () => {
    for (const origin of DEV_REDIRECT_ORIGINS) {
      expect(safeRedirectWith(`${origin}/?upgrade=success`, FALLBACK, LOCAL)).toBe(
        `${origin}/?upgrade=success`,
      );
    }
    expect(safeRedirectWith("http://localhost:3000/", FALLBACK, LOCAL)).toBe(FALLBACK);
  });

  it("refuses other hosts, look-alikes and userinfo", () => {
    for (const url of [
      "https://evil.com/",
      "https://app.moduo.app.evil.com/",
      "https://evil.com@app.moduo.app/",
      "http://app.moduo.app/",
      "javascript:alert(1)",
      "//evil.com",
      "not a url",
    ]) {
      expect(safeRedirectWith(url, FALLBACK, HOSTED)).toBe(FALLBACK);
    }
    expect(safeRedirectWith(undefined, FALLBACK, HOSTED)).toBe(FALLBACK);
    expect(safeRedirectWith("", FALLBACK, HOSTED)).toBe(FALLBACK);
  });

  it("adds APP_URL's origin when the project names one", () => {
    const env = { supabaseUrl: HOSTED.supabaseUrl, appUrl: "https://preview.moduo.app/some/path" };
    expect(safeRedirectWith("https://preview.moduo.app/?upgrade=success", FALLBACK, env)).toBe(
      "https://preview.moduo.app/?upgrade=success",
    );
    expect(safeRedirectWith("https://x.moduo.app/", FALLBACK, { ...env, appUrl: "garbage" })).toBe(
      FALLBACK,
    );
  });
});
