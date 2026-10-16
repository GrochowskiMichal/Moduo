import { describe, expect, it } from "@rstest/core";

// Statuses as people read them (CV-17, AC11.1, AC11.3, AC11.4): the shape for
// each state, the words, "until", the line above the composer and the person
// picker's suffix, and what "clear after" turns into.

import {
  clearAtFor,
  composerHoldLine,
  nowLine,
  peopleNowFromRows,
  pickerSuffix,
  presenceLabel,
  presenceStateOf,
  statusFromRow,
  statusLine,
} from "./model";

const NOW = new Date(2026, 9, 16, 10, 0, 0); // Fri 16 Oct 2026, 10:00 local
const later = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe("the five shapes (AC11.1)", () => {
  it("green = reachable, outline = away, bar = do not disturb, target = Focusing, nothing = offline", () => {
    expect(presenceStateOf({ online: true, away: false })).toBe("reachable");
    expect(presenceStateOf({ online: true, away: true })).toBe("away");
    expect(presenceStateOf({ online: true, away: false, dnd: true })).toBe("dnd");
    expect(presenceStateOf({ online: true, away: false, focusing: true })).toBe("focusing");
    expect(presenceStateOf({ online: false, away: false })).toBe("offline");
    expect(presenceStateOf({ online: true, away: false, inCall: true })).toBe("in_call");
  });

  it("do not disturb and Focusing show whatever presence says; DND wins", () => {
    expect(presenceStateOf({ online: false, away: false, dnd: true })).toBe("dnd");
    expect(presenceStateOf({ online: false, away: false, focusing: true })).toBe("focusing");
    expect(presenceStateOf({ online: true, away: true, focusing: true, dnd: true })).toBe("dnd");
  });

  it("each shape has words; offline has none", () => {
    expect(presenceLabel("reachable")).toBe("Online");
    expect(presenceLabel("away")).toBe("Away");
    expect(presenceLabel("dnd")).toBe("Do not disturb");
    expect(presenceLabel("focusing")).toBe("Focusing");
    expect(presenceLabel("in_call")).toBe("In a call");
    expect(presenceLabel("offline")).toBe("");
  });
});

describe("statuses (AC11.4)", () => {
  const vacation = {
    emoji: "🌴",
    text: "On vacation",
    dnd: true,
    clear_at: new Date(2026, 9, 20, 23, 59).toISOString(),
    preset: "vacation",
    set_at: NOW.toISOString(),
  };

  it("reads a row; a cleared or past one is none", () => {
    expect(statusFromRow(vacation, NOW.getTime())).toMatchObject({ preset: "vacation", dnd: true });
    expect(statusFromRow({ ...vacation, set_at: null }, NOW.getTime())).toBeNull();
    expect(
      statusFromRow({ ...vacation, clear_at: later(-1) }, NOW.getTime()),
    ).toBeNull();
    expect(statusFromRow({ ...vacation, preset: "lunch" }, NOW.getTime())?.preset).toBeNull();
  });

  it("says the status with its end: a time today, else a date", () => {
    const s = statusFromRow(vacation, NOW.getTime());
    expect(statusLine(s, NOW)).toBe("🌴 On vacation · until Oct 20");
    const meeting = statusFromRow(
      { emoji: "📅", text: "In a meeting", clear_at: later(1), set_at: NOW.toISOString() },
      NOW.getTime(),
    );
    expect(statusLine(meeting, NOW)).toMatch(/^📅 In a meeting · until 11:00/);
    const dnd = statusFromRow({ dnd: true, set_at: NOW.toISOString() }, NOW.getTime());
    expect(statusLine(dnd, NOW)).toBe("Do not disturb");
  });

  it("the line above the box, only when they won't be pinged", () => {
    const people = peopleNowFromRows(
      [{ user_id: "jana", status: vacation, focusing: false }],
      NOW.getTime(),
    );
    expect(composerHoldLine("Jana", people.get("jana"), NOW)).toBe(
      "Jana is on vacation until Oct 20. They won't be notified; your message waits in their Catch up.",
    );
    const meeting = peopleNowFromRows(
      [{ user_id: "mo", status: { text: "In a meeting", preset: "meeting", set_at: NOW.toISOString() } }],
      NOW.getTime(),
    );
    expect(composerHoldLine("Mo", meeting.get("mo"), NOW)).toBeNull();
  });

  it("the shared person picker reads “on vacation until Oct 20”", () => {
    const people = peopleNowFromRows([{ user_id: "jana", status: vacation }], NOW.getTime());
    expect(pickerSuffix(people.get("jana"), NOW)).toBe("on vacation until Oct 20");
    expect(pickerSuffix(undefined, NOW)).toBe("");
  });
});

describe("Focusing (AC11.3)", () => {
  it("“Focusing”, “until” only when the server gives one, the task only when it names one", () => {
    const people = peopleNowFromRows(
      [
        { user_id: "a", focusing: true, focus_until: null },
        { user_id: "b", focusing: true, focus_until: later(5), focus_task_title: "Hero v3" },
      ],
      NOW.getTime(),
    );
    expect(nowLine(people.get("a"), "focusing", NOW)).toBe("Focusing");
    expect(nowLine(people.get("b"), "focusing", NOW)).toMatch(/^Focusing · until 3:00/);
    expect(nowLine(people.get("b"), "focusing", NOW, { task: true })).toMatch(
      /^Focusing on Hero v3 · until 3:00/,
    );
    expect(nowLine(undefined, "away", NOW)).toBe("Away");
    expect(nowLine(undefined, "reachable", NOW)).toBe("");
  });
});

describe("clear after", () => {
  it("30 min, 1 h, end of today, end of this week, a date, never", () => {
    expect(clearAtFor("30m", NOW)).toBe(new Date(NOW.getTime() + 30 * 60_000).toISOString());
    expect(clearAtFor("1h", NOW)).toBe(later(1));
    expect(new Date(clearAtFor("today", NOW)!).getHours()).toBe(23);
    // Week starting Monday: the week ends Sunday the 18th.
    expect(new Date(clearAtFor("this_week", NOW, { weekStart: 1 })!).getDate()).toBe(18);
    // Week starting Sunday: it ends Saturday the 17th.
    expect(new Date(clearAtFor("this_week", NOW, { weekStart: 0 })!).getDate()).toBe(17);
    expect(new Date(clearAtFor("date", NOW, { date: new Date(2026, 9, 20) })!).getDate()).toBe(20);
    expect(clearAtFor("date", NOW)).toBeNull();
    expect(clearAtFor("never", NOW)).toBeNull();
  });
});
