import { describe, expect, it } from "@rstest/core";

import { formatSnoozeUntil, normalizeSnoozeAt, parseSnoozeText, snoozePresets } from "./snooze";

// Local-time constructor + local-getter assertions → timezone-agnostic.
const wed = new Date(2026, 6, 8, 14, 30, 0); // Wed 2026-07-08 14:30
const sat = new Date(2026, 6, 11, 10, 0, 0); // Sat 2026-07-11 10:00
const mon = new Date(2026, 6, 13, 8, 0, 0); //  Mon 2026-07-13 08:00

describe("snoozePresets", () => {
  it("later_today is today at 18:00 (specs/mail-v3.md §8)", () => {
    const p = snoozePresets(wed).find((x) => x.id === "later_today")!;
    expect(p.at.getDate()).toBe(8);
    expect(p.at.getHours()).toBe(18);
    expect(p.at.getMinutes()).toBe(0);
  });

  it("later_today is left out once 18:00 has passed", () => {
    const evening = new Date(2026, 6, 8, 18, 30, 0);
    expect(snoozePresets(evening).map((p) => p.id)).toEqual([
      "tomorrow",
      "this_weekend",
      "next_week",
      "someday",
    ]);
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

  it("someday is a morning 90 days out, last in the menu (MR-14)", () => {
    const list = snoozePresets(wed);
    const p = list[list.length - 1]!;
    expect(p.id).toBe("someday");
    expect(p.at.getHours()).toBe(9);
    const days = Math.round((p.at.getTime() - wed.getTime()) / 86_400_000);
    expect(days).toBeGreaterThanOrEqual(89);
    expect(days).toBeLessThanOrEqual(90);
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

describe("parseSnoozeText (AC27)", () => {
  const at = (text: string, now = wed) => parseSnoozeText(text, now);
  const parts = (d: Date | null) =>
    d ? [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()] : null;

  it("parses thu 9am, in 3 days, next week, dec 2", () => {
    // Now: Wed 2026-07-08 14:30.
    expect(parts(at("thu 9am"))).toEqual([2026, 7, 9, 9, 0]);
    expect(parts(at("in 3 days"))).toEqual([2026, 7, 11, 9, 0]);
    expect(parts(at("next week"))).toEqual([2026, 7, 13, 9, 0]);
    expect(parts(at("dec 2"))).toEqual([2026, 12, 2, 9, 0]);
  });

  it("reads spacing, case, full names and times in many shapes", () => {
    expect(parts(at("Thursday 9 AM"))).toEqual([2026, 7, 9, 9, 0]);
    expect(parts(at("thu at 9:30pm"))).toEqual([2026, 7, 9, 21, 30]);
    expect(parts(at("tomorrow 3pm"))).toEqual([2026, 7, 9, 15, 0]);
    expect(parts(at("2 december"))).toEqual([2026, 12, 2, 9, 0]);
    expect(parts(at("dec 2nd 5pm"))).toEqual([2026, 12, 2, 17, 0]);
    expect(parts(at("sat"))).toEqual([2026, 7, 11, 9, 0]);
    expect(parts(at("thu 9"))).toEqual([2026, 7, 9, 9, 0]);
  });

  it("rolls a time, a weekday or a date that has passed forward", () => {
    // 9am already passed today → tomorrow; 18:00 is still ahead → today.
    expect(parts(at("9am"))).toEqual([2026, 7, 9, 9, 0]);
    expect(parts(at("18:00"))).toEqual([2026, 7, 8, 18, 0]);
    // "wed 9am" on a Wednesday afternoon → next Wednesday.
    expect(parts(at("wed 9am"))).toEqual([2026, 7, 15, 9, 0]);
    // A date already past this year → next year.
    expect(parts(at("jan 5"))).toEqual([2027, 1, 5, 9, 0]);
  });

  it("counts hours from now", () => {
    expect(at("in 2 hours")?.getTime()).toBe(wed.getTime() + 2 * 3600_000);
    expect(parts(at("in a week"))).toEqual([2026, 7, 15, 9, 0]);
  });

  it("can't read nonsense, impossible times or dates", () => {
    for (const text of ["", "soonish", "thu 25pm", "feb 30", "thu 9am 10am", "in many days"]) {
      expect(at(text)).toBeNull();
    }
  });
});
