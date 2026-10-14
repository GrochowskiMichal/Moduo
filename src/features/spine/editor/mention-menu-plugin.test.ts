// The `@ # /` menu keeps inside its host (the capture dialog, else the window):
// at the caret when it fits, pulled left when it would run past the right edge.

import { describe, expect, it } from "@rstest/core";

import { menuLeftWithin } from "./mention-menu-plugin";

describe("menuLeftWithin", () => {
  it("sits at the caret when the menu fits", () => {
    expect(menuLeftWithin(500, 240, 440, 1000)).toBe(500);
  });

  it("pulls left so the menu ends at the dialog's right edge", () => {
    // The capture's tag menu: caret near the dialog's right edge (999).
    expect(menuLeftWithin(900, 240, 441, 999)).toBe(759);
  });

  it("uses the drawn width, not the minimum", () => {
    expect(menuLeftWithin(900, 300, 441, 999)).toBe(699);
  });

  it("never goes past the left edge when the host is narrower than the menu", () => {
    expect(menuLeftWithin(300, 400, 280, 600)).toBe(280);
  });
});
