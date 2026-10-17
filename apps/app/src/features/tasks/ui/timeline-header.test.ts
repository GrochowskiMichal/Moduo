// A month's name keeps only to the part of the month still on screen past the
// name column, so a month almost scrolled away shows no "…ber" fragment.

import { describe, expect, it } from "@rstest/core";

import { shownWidth } from "./timeline-header";

const OCTOBER = { start: 100, end: 130, label: "October" };

describe("shownWidth", () => {
  it("is the whole month while its first day is on screen", () => {
    expect(shownWidth(OCTOBER, 90, 24)).toBe(31 * 24);
  });

  it("is only the whole days left once the month scrolls under the name column", () => {
    // At Month (24 px a day), from a sliver of the 29th: the 30th and 31st, too
    // narrow for "October".
    expect(shownWidth(OCTOBER, 128, 24)).toBe(48);
    // At Week (120 px a day), a sliver of the 31st alone shows no name.
    expect(shownWidth(OCTOBER, 130, 120)).toBe(0);
  });

  it("is nothing once the month has gone", () => {
    expect(shownWidth(OCTOBER, 140, 24)).toBe(0);
  });
});
