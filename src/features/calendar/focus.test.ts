import { describe, expect, it } from "@rstest/core";

import { canFocusBlock } from "./focus";

describe("focus — offered only on current-ish blocks (AC10)", () => {
  const now = new Date(2026, 6, 2, 14, 0).getTime();

  it("offers focus on an elapsed block", () => {
    expect(canFocusBlock({ startMs: new Date(2026, 6, 2, 9, 0).getTime(), done: false }, now)).toBe(
      true,
    );
  });
  it("offers focus on a block starting within the hour", () => {
    expect(
      canFocusBlock({ startMs: new Date(2026, 6, 2, 14, 30).getTime(), done: false }, now),
    ).toBe(true);
  });
  it("declines a far-future block", () => {
    expect(
      canFocusBlock({ startMs: new Date(2026, 6, 2, 16, 0).getTime(), done: false }, now),
    ).toBe(false);
  });
  it("declines a done block", () => {
    expect(canFocusBlock({ startMs: new Date(2026, 6, 2, 9, 0).getTime(), done: true }, now)).toBe(
      false,
    );
  });
});
