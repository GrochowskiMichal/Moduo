import { describe, expect, it } from "@rstest/core";

import { apiKeyExpired } from "./api-key-expiry.ts";

const NOW = Date.parse("2026-10-09T12:00:00Z");

describe("apiKeyExpired", () => {
  it("never expires without an expiry", () => {
    expect(apiKeyExpired(null, NOW)).toBe(false);
    expect(apiKeyExpired(undefined, NOW)).toBe(false);
  });

  it("is live before the expiry and dead from it onwards", () => {
    expect(apiKeyExpired("2026-10-09T12:00:01Z", NOW)).toBe(false);
    expect(apiKeyExpired("2026-10-09T12:00:00Z", NOW)).toBe(true);
    expect(apiKeyExpired("2026-01-01T00:00:00Z", NOW)).toBe(true);
  });

  it("fails closed on an unreadable value", () => {
    expect(apiKeyExpired("soon", NOW)).toBe(true);
  });
});
