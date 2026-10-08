import { describe, expect, it } from "@rstest/core";

import { canFocusBlock, formatFocusClock, loggedMessage } from "./focus";

describe("focus — clock formatting (AC10)", () => {
  it("shows MM:SS under an hour", () => {
    expect(formatFocusClock(0)).toBe("00:00");
    expect(formatFocusClock(9)).toBe("00:09");
    expect(formatFocusClock(23 * 60 + 14)).toBe("23:14");
  });

  it("shows H:MM:SS past an hour", () => {
    expect(formatFocusClock(3600)).toBe("1:00:00");
    expect(formatFocusClock(3600 + 5 * 60 + 3)).toBe("1:05:03");
  });

  it("floors partial seconds and clamps negatives", () => {
    expect(formatFocusClock(90.9)).toBe("01:30");
    expect(formatFocusClock(-5)).toBe("00:00");
  });
});

describe("focus — logged summary (AC10)", () => {
  it("reports rounded minutes against the task title", () => {
    expect(loggedMessage(47 * 60, "write offer")).toBe("47m logged to write offer");
  });
  it("handles sub-minute sessions kindly", () => {
    expect(loggedMessage(30, "quick note")).toBe("Less than a minute logged to quick note");
  });
  it("falls back when the title is blank", () => {
    expect(loggedMessage(120, "  ")).toBe("2m logged to this task");
  });
});

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
