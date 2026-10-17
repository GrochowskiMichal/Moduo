// AC7 proof: the birthday countdown caption. Appears only within 60 days, uses
// "in N days" then "in N weeks", and wraps across the year boundary.

import { describe, expect, it } from "@rstest/core";

import { birthdayCountdown } from "./dates";

// A fixed "now" so the tests are deterministic (2026-07-02, local).
const NOW = new Date(2026, 6, 2); // month is 0-indexed → July

describe("birthdayCountdown", () => {
  it("shows 'today' / 'tomorrow' for the immediate days", () => {
    expect(birthdayCountdown("1990-07-02", NOW)).toBe("today");
    expect(birthdayCountdown("1990-07-03", NOW)).toBe("tomorrow");
  });

  it("shows 'in N days' under two weeks", () => {
    expect(birthdayCountdown("1988-07-12", NOW)).toBe("in 10 days");
  });

  it("shows 'in N weeks' style within 60 days", () => {
    // 2026-07-23 is 21 days out → three weeks.
    expect(birthdayCountdown("1985-07-23", NOW)).toBe("in 3 weeks");
  });

  it("returns null beyond the 60-day horizon", () => {
    // 2026-10-01 is ~91 days out.
    expect(birthdayCountdown("1979-10-01", NOW)).toBeNull();
  });

  it("wraps to next year for a date already past this year", () => {
    // A January birthday, seen in July, counts to next January (>60d) → null…
    expect(birthdayCountdown("1990-01-10", NOW)).toBeNull();
    // …but seen in late December it wraps forward and lands in range:
    // 2026-12-28 → next 2027-01-05 is 8 days out.
    const near = new Date(2026, 11, 28); // Dec 28
    expect(birthdayCountdown("1991-01-05", near)).toBe("in 8 days");
  });

  it("clamps a Feb-29 birthday to Feb 28 in a non-leap year (never rolls to Mar 1)", () => {
    // 2027 is not a leap year → the next occurrence is Feb 28, 8 days from Feb 20
    // (Mar 1 would be 9 days — proving no rollover).
    const feb20NonLeap = new Date(2027, 1, 20);
    expect(birthdayCountdown("2000-02-29", feb20NonLeap)).toBe("in 8 days");
  });

  it("returns null for unparseable or invalid input", () => {
    expect(birthdayCountdown("", NOW)).toBeNull();
    expect(birthdayCountdown("not-a-date", NOW)).toBeNull();
    expect(birthdayCountdown("1990-13-40", NOW)).toBeNull();
  });
});
