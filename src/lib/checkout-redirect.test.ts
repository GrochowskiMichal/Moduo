import { describe, expect, it } from "vitest";

import { checkoutRedirectUrl } from "./checkout-redirect";

describe("checkoutRedirectUrl", () => {
  it("points at the create-checkout-session function with the price_id", () => {
    const url = checkoutRedirectUrl("price_123", null);
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/functions/v1/create-checkout-session");
    expect(parsed.searchParams.get("price_id")).toBe("price_123");
  });

  it("includes the access_token when a session token is available", () => {
    const url = checkoutRedirectUrl("price_123", "eyJhbGciOiJIUzI1NiJ9.abc");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("access_token")).toBe("eyJhbGciOiJIUzI1NiJ9.abc");
  });

  it("omits access_token when no session token is available", () => {
    const url = checkoutRedirectUrl("price_123", null);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("access_token")).toBeNull();
  });

  it("URL-encodes a token with reserved characters without double-encoding", () => {
    const token = "a+b/c=d&e";
    const url = checkoutRedirectUrl("price_123", token);
    const parsed = new URL(url);
    expect(parsed.searchParams.get("access_token")).toBe(token);
  });
});
