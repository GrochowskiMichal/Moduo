import { describe, expect, it } from "@rstest/core";

import {
  APP_ORIGINS,
  appOrigin,
  BOOKING_ORIGINS,
  bookingCancelUrl,
  bookingOrigin,
  CANONICAL_APP_ORIGIN,
  CANONICAL_BOOKING_ORIGIN,
  workspaceInviteUrl,
} from "./app-origin.ts";

describe("bookingOrigin", () => {
  it("keeps every allow-listed host", () => {
    for (const origin of BOOKING_ORIGINS) expect(bookingOrigin(origin)).toBe(origin);
  });

  it("reduces an allow-listed URL to its origin", () => {
    expect(bookingOrigin("https://staging.moduo.app/")).toBe("https://staging.moduo.app");
    expect(bookingOrigin("https://moduo.app/book/abc?x=1#y")).toBe("https://moduo.app");
    expect(bookingOrigin("  HTTPS://WWW.MODUO.APP  ")).toBe("https://www.moduo.app");
    expect(bookingOrigin("https://moduo.app:443")).toBe("https://moduo.app");
  });

  it("falls back to moduo.app for anything else", () => {
    const forged = [
      "https://evil.example",
      "https://moduo.app.evil.example",
      "https://evilmoduo.app",
      "https://moduo.app@evil.example",
      "https://moduo.app:8443",
      "http://moduo.app",
      "http://localhost:3000",
      "http://localhost:8081",
      "http://127.0.0.1:8081",
      "https://app.moduo.app",
      "//evil.example",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "moduo.app",
      "",
      "   ",
    ];
    for (const hint of forged) expect(bookingOrigin(hint)).toBe(CANONICAL_BOOKING_ORIGIN);
  });

  it("falls back for non-strings", () => {
    for (const hint of [undefined, null, 42, {}, ["https://moduo.app"]]) {
      expect(bookingOrigin(hint)).toBe(CANONICAL_BOOKING_ORIGIN);
    }
  });
});

describe("bookingCancelUrl", () => {
  it("never points a forged origin's link off our hosts", () => {
    const url = bookingCancelUrl(bookingOrigin("https://evil.example"), "tok-1");
    expect(url).toBe("https://moduo.app/book/cancel?token=tok-1");
  });

  it("encodes the token", () => {
    const url = new URL(bookingCancelUrl("https://staging.moduo.app", "a&b=c d"));
    expect(url.origin).toBe("https://staging.moduo.app");
    expect(url.pathname).toBe("/book/cancel");
    expect(url.searchParams.get("token")).toBe("a&b=c d");
  });
});

describe("appOrigin", () => {
  it("defaults to the production app", () => {
    expect(appOrigin(undefined)).toBe(CANONICAL_APP_ORIGIN);
    expect(appOrigin(null)).toBe(CANONICAL_APP_ORIGIN);
    expect(appOrigin("")).toBe(CANONICAL_APP_ORIGIN);
  });

  it("uses a configured app host, without its path", () => {
    for (const origin of APP_ORIGINS) expect(appOrigin(origin)).toBe(origin);
    expect(appOrigin("https://app.staging.moduo.app/")).toBe("https://app.staging.moduo.app");
    expect(appOrigin("https://app.moduo.app/settings")).toBe("https://app.moduo.app");
  });

  it("ignores anything that isn't an app host, including the marketing site", () => {
    for (const configured of [
      "https://moduo.app",
      "https://staging.moduo.app",
      "https://evil.example",
      "http://evil.example",
      "http://localhost:3000",
      "not a url",
      "javascript:alert(1)",
    ]) {
      expect(appOrigin(configured)).toBe(CANONICAL_APP_ORIGIN);
    }
  });
});

describe("workspaceInviteUrl", () => {
  it("links to the /join route's invite param, encoding base64 tokens", () => {
    const token = "ab+c/d==";
    const url = new URL(workspaceInviteUrl(CANONICAL_APP_ORIGIN, token));
    expect(url.origin).toBe("https://app.moduo.app");
    expect(url.pathname).toBe("/join");
    expect(url.searchParams.get("invite")).toBe(token);
    expect(url.toString()).toBe("https://app.moduo.app/join?invite=ab%2Bc%2Fd%3D%3D");
  });
});
