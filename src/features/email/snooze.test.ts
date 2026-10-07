import { describe, expect, it } from "@rstest/core";

import { formatSnoozeUntil, normalizeSnoozeAt, snoozePresets } from "./snooze";

// Local-time constructor + local-getter assertions → timezone-agnostic.
const wed = new Date(2026, 6, 8, 14, 30, 0); // Wed 2026-07-08 14:30
const sat = new Date(2026, 6, 11, 10, 0, 0); // Sat 2026-07-11 10:00
const mon = new Date(2026, 6, 13, 8, 0, 0); //  Mon 2026-07-13 08:00

describe("snoozePresets", () => {
  it("later_today is now + 3h", () => {
    const p = snoozePresets(wed).find((x) => x.id === "later_today")!;
    expect(p.at.getTime()).toBe(wed.getTime() + 3 * 3600_000);
  });

  it("tomorrow is the next day at 09:00 local", () => {
    const p = snoozePresets(wed).find((x) => x.id === "tomorrow")!;
    expect(p.at.getDate()).toBe(9);
    expect(p.at.getHours()).toBe(9);
    expect(p.at.getMinutes()).toBe(0);
  });

  it("this_weekend is the upcoming Saturday morning", () => {
    const p = snoozePresets(wed).find((x) => x.id === "this_weekend")!;
    expect(p.at.getDay()).toBe(6); // Saturday
    expect(p.at.getDate()).toBe(11);
    expect(p.at.getHours()).toBe(9);
  });

  it("this_weekend jumps to NEXT Saturday when today is already Saturday", () => {
    const p = snoozePresets(sat).find((x) => x.id === "this_weekend")!;
    expect(p.at.getDay()).toBe(6);
    expect(p.at.getDate()).toBe(18); // a week later, never today/past
    expect(p.at.getTime()).toBeGreaterThan(sat.getTime());
  });

  it("next_week is the upcoming Monday morning", () => {
    const p = snoozePresets(wed).find((x) => x.id === "next_week")!;
    expect(p.at.getDay()).toBe(1); // Monday
    expect(p.at.getDate()).toBe(13);
    expect(p.at.getHours()).toBe(9);
  });

  it("next_week jumps to NEXT Monday when today is already Monday", () => {
    const p = snoozePresets(mon).find((x) => x.id === "next_week")!;
    expect(p.at.getDay()).toBe(1);
    expect(p.at.getDate()).toBe(20); // a week later
    expect(p.at.getTime()).toBeGreaterThan(mon.getTime());
  });

  it("every preset is strictly in the future", () => {
    for (const base of [wed, sat, mon]) {
      for (const p of snoozePresets(base)) {
        expect(p.at.getTime()).toBeGreaterThan(base.getTime());
      }
    }
  });
});

describe("normalizeSnoozeAt", () => {
  it("keeps a future instant", () => {
    const at = new Date(wed.getTime() + 3600_000);
    expect(normalizeSnoozeAt(at, wed)?.getTime()).toBe(at.getTime());
  });
  it("rejects a past/now instant", () => {
    expect(normalizeSnoozeAt(new Date(wed.getTime() - 1), wed)).toBeNull();
    expect(normalizeSnoozeAt(new Date(wed.getTime()), wed)).toBeNull();
  });
  it("rejects an invalid date", () => {
    expect(normalizeSnoozeAt(new Date("nope"), wed)).toBeNull();
  });
});

describe("formatSnoozeUntil", () => {
  it("same-day shows a bare time (no weekday prefix)", () => {
    const at = new Date(2026, 6, 8, 18, 0, 0).toISOString();
    const label = formatSnoozeUntil(at, wed);
    expect(label).not.toBe("");
    expect(label.startsWith("Tomorrow")).toBe(false);
  });
  it("next day is prefixed 'Tomorrow'", () => {
    const at = new Date(2026, 6, 9, 9, 0, 0).toISOString();
    expect(formatSnoozeUntil(at, wed).startsWith("Tomorrow")).toBe(true);
  });
  it("invalid iso → empty string", () => {
    expect(formatSnoozeUntil("not-a-date", wed)).toBe("");
  });
});
