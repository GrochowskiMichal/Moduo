import { describe, expect, it } from "vitest";

import { type EntitlementsRow, isTrialing, planLabel, subscriptionLine } from "./billing";

const row = (overrides: Partial<EntitlementsRow>): EntitlementsRow => ({
  plan_tier: null,
  subscription_status: null,
  trial_days_remaining: null,
  trial_ends_at: null,
  current_period_end: null,
  ...overrides,
});

describe("planLabel", () => {
  it("maps known tiers", () => {
    expect(planLabel("pro")).toBe("Pro");
    expect(planLabel("team")).toBe("Team");
    expect(planLabel("founders")).toBe("Founders");
    // The DB enum spells it "founder"; the auth provider spells it "founders".
    expect(planLabel("founder")).toBe("Founders");
  });

  it("defaults to Free for free/null/unknown", () => {
    expect(planLabel("free")).toBe("Free");
    expect(planLabel(null)).toBe("Free");
    expect(planLabel(undefined)).toBe("Free");
  });
});

describe("subscriptionLine", () => {
  it("reads 'No subscription' for null row, null status, and 'none'", () => {
    expect(subscriptionLine(null)).toBe("No subscription");
    expect(subscriptionLine(row({}))).toBe("No subscription");
    expect(subscriptionLine(row({ subscription_status: "none" }))).toBe("No subscription");
  });

  it("renders trialing with days + end date", () => {
    const line = subscriptionLine(
      row({
        subscription_status: "trialing",
        trial_days_remaining: 4.3,
        trial_ends_at: "2026-07-15T12:00:00Z",
      }),
    );
    expect(line).toContain("Trial — 5 days left");
    expect(line).toContain("ends Jul");
  });

  it("uses the singular for exactly one day", () => {
    expect(
      subscriptionLine(row({ subscription_status: "trialing", trial_days_remaining: 1 })),
    ).toBe("Trial — 1 day left");
  });

  it("reads 'Trial ends today' at zero/negative days", () => {
    expect(
      subscriptionLine(row({ subscription_status: "trialing", trial_days_remaining: 0 })),
    ).toBe("Trial ends today");
    expect(
      subscriptionLine(row({ subscription_status: "trialing", trial_days_remaining: -0.5 })),
    ).toBe("Trial ends today");
  });

  it("degrades gracefully when trialing has no day count", () => {
    expect(subscriptionLine(row({ subscription_status: "trialing" }))).toBe("Trial active");
  });

  it("renders active with a renewal date, and bare without one", () => {
    expect(
      subscriptionLine(
        row({ subscription_status: "active", current_period_end: "2026-08-01T12:00:00Z" }),
      ),
    ).toContain("Active — renews");
    expect(subscriptionLine(row({ subscription_status: "active" }))).toBe("Active");
  });

  it("renders canceled with access-until when a period end exists", () => {
    expect(
      subscriptionLine(
        row({ subscription_status: "canceled", current_period_end: "2026-08-01T12:00:00Z" }),
      ),
    ).toContain("Canceled — access until");
    expect(subscriptionLine(row({ subscription_status: "canceled" }))).toBe("Canceled");
  });

  it("ignores unparseable dates instead of rendering 'Invalid Date'", () => {
    expect(
      subscriptionLine(
        row({ subscription_status: "trialing", trial_days_remaining: 3, trial_ends_at: "nope" }),
      ),
    ).toBe("Trial — 3 days left");
  });

  it("passes unknown statuses through", () => {
    expect(subscriptionLine(row({ subscription_status: "past_due" }))).toBe("Payment past due");
    expect(subscriptionLine(row({ subscription_status: "incomplete" }))).toBe("incomplete");
  });
});

describe("isTrialing", () => {
  it("is true only for trialing", () => {
    expect(isTrialing(row({ subscription_status: "trialing" }))).toBe(true);
    expect(isTrialing(row({ subscription_status: "active" }))).toBe(false);
    expect(isTrialing(null)).toBe(false);
  });
});
