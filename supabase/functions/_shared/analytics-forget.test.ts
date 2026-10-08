import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import { FORGET_SETTLE_MS, forgetAnalytics } from "./analytics-forget.ts";
import type { ErasurePostHog, PostHogEraseResult } from "./posthog-erasure.ts";

const USER = "11111111-1111-4111-8111-111111111111";

/** The order things happen in: "sleep <ms>", "erase <distinct id>". */
let steps: string[];

const sleep = async (ms: number) => {
  steps.push(`sleep ${ms}`);
};

function posthog(answer: PostHogEraseResult | Error): ErasurePostHog {
  return {
    async erasePerson(distinctId) {
      steps.push(`erase ${distinctId}`);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

beforeEach(() => {
  steps = [];
  rs.spyOn(console, "warn").mockImplementation(() => {});
  rs.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rs.restoreAllMocks();
});

describe("forgetAnalytics", () => {
  it("waits for the app's last batch to land, then erases the caller's person", async () => {
    const result = await forgetAnalytics(
      { posthog: posthog({ status: "queued" }), sleep },
      USER,
    );

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(steps).toEqual([`sleep ${FORGET_SETTLE_MS}`, `erase ${USER}`]);
    expect(FORGET_SETTLE_MS).toBeGreaterThanOrEqual(5_000);
  });

  it("answers 503 without waiting when PostHog isn't set up, so the app asks again later", async () => {
    const result = await forgetAnalytics({ posthog: null, sleep }, USER);

    expect(result.status).toBe(503);
    expect(steps).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      "[analytics-forget] PostHog erasure isn't configured",
      USER,
    );
  });

  it("answers 503 when PostHog refuses, and logs the user id for a manual deletion", async () => {
    const result = await forgetAnalytics(
      { posthog: posthog({ status: "refused", httpStatus: 403 }), sleep },
      USER,
    );

    expect(result.status).toBe(503);
    expect(console.warn).toHaveBeenCalledWith("[analytics-forget] PostHog refused", USER, 403);
  });

  it("answers 502 when PostHog fails, so the app asks again later", async () => {
    const result = await forgetAnalytics(
      { posthog: posthog(new Error("PostHog 503: busy")), sleep },
      USER,
    );

    expect(result).toEqual({
      status: 502,
      body: { error: "Couldn't delete your analytics right now. Moduo will try again later." },
    });
    expect(console.error).toHaveBeenCalled();
  });
});
