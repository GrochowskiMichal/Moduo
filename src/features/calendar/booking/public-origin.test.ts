import { describe, expect, test } from "vitest";
import { bookingPublicOrigin, bookingPublicUrl } from "./public-origin";

describe("bookingPublicOrigin", () => {
  test("keeps local dev on the dev server", () => {
    expect(bookingPublicOrigin({ hostname: "127.0.0.1", origin: "http://127.0.0.1:8081" })).toBe(
      "http://127.0.0.1:8081",
    );
    expect(bookingPublicOrigin({ hostname: "localhost", origin: "http://localhost:8081" })).toBe(
      "http://localhost:8081",
    );
  });

  test("uses the public staging host from either staging hostname", () => {
    expect(
      bookingPublicOrigin({
        hostname: "app.staging.moduo.app",
        origin: "https://app.staging.moduo.app",
      }),
    ).toBe("https://staging.moduo.app");
    expect(
      bookingPublicUrl("intro", {
        hostname: "staging.moduo.app",
        origin: "https://staging.moduo.app",
      }),
    ).toBe("https://staging.moduo.app/book/intro");
  });

  test("uses moduo.app in production, including the app host", () => {
    expect(
      bookingPublicUrl("intro", { hostname: "app.moduo.app", origin: "https://app.moduo.app" }),
    ).toBe("https://moduo.app/book/intro");
  });
});
