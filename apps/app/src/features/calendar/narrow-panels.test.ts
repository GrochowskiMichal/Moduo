// AC14 (CALR-13): in Calendar, below 1600 px the calendars panel folds and
// below 1360 px Plan folds too, one side panel open at a time; widening the
// window gives back the panels you had at full width.

import { describe, expect, it } from "@rstest/core";

import {
  FOLD_CALENDARS_BELOW,
  ONE_PANEL_BELOW,
  panelBand,
  panelsOnEnter,
  panelsOnToggle,
} from "./narrow-panels";

const BOTH = { left: true, right: true };

describe("the bands", () => {
  it("folds the calendars panel below 1600 px and keeps one panel below 1360 px", () => {
    expect(FOLD_CALENDARS_BELOW).toBe(1600);
    expect(ONE_PANEL_BELOW).toBe(1360);
    expect(panelBand(1920)).toBe("wide");
    expect(panelBand(1600)).toBe("wide");
    expect(panelBand(1599)).toBe("fold-calendars");
    expect(panelBand(1360)).toBe("fold-calendars");
    expect(panelBand(1359)).toBe("one-panel");
    expect(panelBand(1280)).toBe("one-panel");
    expect(panelBand(1024)).toBe("one-panel");
  });
});

describe("entering a band", () => {
  it("restores the full-width panels when the window is wide", () => {
    expect(panelsOnEnter("wide", BOTH)).toEqual(BOTH);
    expect(panelsOnEnter("wide", { left: false, right: true })).toEqual({
      left: false,
      right: true,
    });
  });

  it("folds the calendars panel and keeps Plan as you had it below 1600 px", () => {
    expect(panelsOnEnter("fold-calendars", BOTH)).toEqual({ left: false, right: true });
    expect(panelsOnEnter("fold-calendars", { left: true, right: false })).toEqual({
      left: false,
      right: false,
    });
  });

  it("shows one side panel at 1280 and 1024 px: Plan, never both", () => {
    expect(panelsOnEnter("one-panel", BOTH)).toEqual({ left: false, right: true });
  });
});

describe("toggling inside a band", () => {
  it("below 1360 px opening the calendars panel folds Plan", () => {
    expect(
      panelsOnToggle("one-panel", { left: false, right: true }, { left: true, right: true }),
    ).toEqual({ left: true, right: false });
  });

  it("below 1360 px opening Plan folds the calendars panel", () => {
    expect(
      panelsOnToggle("one-panel", { left: true, right: false }, { left: true, right: true }),
    ).toEqual({ left: false, right: true });
  });

  it("closing a panel, or toggling between 1360 and 1600 px, is left as it is", () => {
    expect(
      panelsOnToggle("one-panel", { left: false, right: true }, { left: false, right: false }),
    ).toEqual({ left: false, right: false });
    expect(
      panelsOnToggle("fold-calendars", { left: false, right: true }, { left: true, right: true }),
    ).toEqual(BOTH);
    expect(panelsOnToggle("wide", { left: false, right: true }, BOTH)).toEqual(BOTH);
  });
});
