// A widget body holds as many rows as its height over a drawn row's.

import { describe, expect, it } from "@rstest/core";

import { rowsThatFit } from "./use-rows-that-fit";

describe("rowsThatFit", () => {
  it("counts whole rows in the body", () => {
    // The Home walkthrough's Upcoming cell: ~300 px over 34 px rows (+2 gap).
    expect(rowsThatFit(300, 36)).toBe(8);
    expect(rowsThatFit(35, 36)).toBe(0);
  });

  it("says nothing before a row or a height is known", () => {
    expect(rowsThatFit(300, 2)).toBeNull();
    expect(rowsThatFit(0, 36)).toBeNull();
  });
});
