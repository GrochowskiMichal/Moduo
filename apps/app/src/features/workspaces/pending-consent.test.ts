// MCPO-4 · resume after sign-in (specs/mcp-oauth.md AC6): the consent page's
// sign-in survives the email-code sign-in, is taken once, and goes stale.
import { afterEach, describe, expect, it } from "@rstest/core";

import {
  consentPath,
  hasPendingConsent,
  PENDING_CONSENT_KEY,
  PENDING_CONSENT_TTL_MS,
  setPendingConsent,
  takePendingConsent,
} from "./pending-consent";

afterEach(() => window.localStorage.clear());

describe("pending consent: resume after sign-in", () => {
  it("survives until it is taken, and is taken once", () => {
    setPendingConsent("8f2c-auth", 1_000);
    expect(hasPendingConsent(2_000)).toBe(true);
    // Peeking leaves it for the sign-in to take.
    expect(hasPendingConsent(2_000)).toBe(true);
    expect(takePendingConsent(2_000)).toBe("8f2c-auth");
    expect(takePendingConsent(2_000)).toBeNull();
    expect(hasPendingConsent(2_000)).toBe(false);
    expect(window.localStorage.getItem(PENDING_CONSENT_KEY)).toBeNull();
  });

  it("expires after 10 minutes", () => {
    setPendingConsent("8f2c-auth", 0);
    expect(hasPendingConsent(PENDING_CONSENT_TTL_MS + 1)).toBe(false);
    expect(takePendingConsent(PENDING_CONSENT_TTL_MS + 1)).toBeNull();
    // A stale one is cleared, not left to steer a later sign-in.
    expect(window.localStorage.getItem(PENDING_CONSENT_KEY)).toBeNull();
    setPendingConsent("8f2c-auth", 0);
    expect(takePendingConsent(PENDING_CONSENT_TTL_MS)).toBe("8f2c-auth");
  });

  it("ignores what isn't one (empty, garbage, a clock gone backwards)", () => {
    setPendingConsent("   ");
    expect(window.localStorage.getItem(PENDING_CONSENT_KEY)).toBeNull();
    window.localStorage.setItem(PENDING_CONSENT_KEY, "not json");
    expect(takePendingConsent()).toBeNull();
    window.localStorage.setItem(PENDING_CONSENT_KEY, JSON.stringify({ authorizationId: 7, at: 0 }));
    expect(takePendingConsent(1)).toBeNull();
    setPendingConsent("8f2c-auth", 5_000);
    expect(takePendingConsent(1_000)).toBeNull();
  });

  it("links back to the consent page with the id encoded", () => {
    expect(consentPath("a b/c")).toBe("/oauth/consent?authorization_id=a%20b%2Fc");
  });
});
