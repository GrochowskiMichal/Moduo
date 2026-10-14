// A month's name keeps only to the part of the month still on screen past the
// name column, so a month almost scrolled away shows no "…ber" fragment.

import { describe, expect, it } from "@rstest/core";

import { shownWidth } from "./timeline-header";

const OCTOBER = { start: 100, end: 130, label: "October" };

describe("shownWidth", () => {
  it("is the whole month while its first day is on screen", () => {
    expect(shownWidth(OCTOBER, 90, 24)).toBe(31 * 24);
  });

  it("is only the days left once the month scrolls under the name column", () => {
    // At Month (24 px a day), the 29th onward: 2 days, too narrow for "October".
    expect(shownWidth(OCTOBER, 129, 24)).toBe(48);
  });

  it("is nothing once the month has gone", () => {
    expect(shownWidth(OCTOBER, 140, 24)).toBe(0);
  });
});
