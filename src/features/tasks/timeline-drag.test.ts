// TV-TL2 · working on the Timeline's canvas (REPLAN 70): what a drag of a
// span does, what a click on an undated project row places, the edge scroll,
// ⇧T's zoom, and how tasks' dates move (a due date, a session's time kept, a
// repeat's occurrence or pattern), with the toast's words.

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import type { Task } from "./model";
import {
  asksAboutRepeat,
  autoScrollStep,
  drawnSpan,
  fitZoom,
  moveSpan,
  NEW_BAR_DAYS,
  newBarSpan,
  planDay,
  planShift,
  shiftInstant,
  spanKeys,
} from "./timeline-drag";
import { dayNumOfKey } from "./timeline-scale";

const NOW = new Date(2026, 9, 13, 10, 0);
// The days are this machine's calendar days: the pattern reads them in its zone.
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function task(over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", title: "Write the brief", bucketId: "p", position: "a" }),
    id: "t1",
    ...over,
  };
}

const day = (key: string) => dayNumOfKey(key) ?? Number.NaN;

describe("spans", () => {
  it("moves as a whole, and resizes from either end without turning inside out", () => {
    const span = { start: 10, end: 20 };
    expect(moveSpan(span, "move", 3)).toEqual({ start: 13, end: 23 });
    expect(moveSpan(span, "start", -2)).toEqual({ start: 8, end: 20 });
    expect(moveSpan(span, "start", 15)).toEqual({ start: 20, end: 20 });
    expect(moveSpan(span, "end", 4)).toEqual({ start: 10, end: 24 });
    expect(moveSpan(span, "end", -30)).toEqual({ start: 10, end: 10 });
  });

  it("draws between two days whichever way the pointer went", () => {
    expect(drawnSpan(12, 5)).toEqual({ start: 5, end: 12 });
    expect(drawnSpan(5, 12)).toEqual({ start: 5, end: 12 });
  });

  it("a click places a bar as long as the zoom suggests (7 · 14 · 30 · 90 days)", () => {
    expect(NEW_BAR_DAYS).toEqual({ week: 7, month: 14, quarter: 30, year: 90 });
    expect(newBarSpan(100, "month")).toEqual({ start: 100, end: 113 });
    expect(newBarSpan(100, "week")).toEqual({ start: 100, end: 106 });
  });

  it("says a span's days as the server keeps them", () => {
    expect(spanKeys({ start: day("2026-10-13"), end: day("2026-10-24") })).toEqual({
      start: "2026-10-13",
      end: "2026-10-24",
    });
  });
});

describe("edge scroll", () => {
  const box = { left: 300, right: 1300, top: 100, bottom: 800 };
  it("is still in the middle and speeds up towards an edge", () => {
    expect(autoScrollStep({ x: 800, y: 400 }, box)).toEqual({ dx: 0, dy: 0 });
    const near = autoScrollStep({ x: 1290, y: 400 }, box).dx;
    const nearer = autoScrollStep({ x: 1299, y: 400 }, box).dx;
    expect(near).toBeGreaterThan(0);
    expect(nearer).toBeGreaterThan(near);
    expect(autoScrollStep({ x: 305, y: 400 }, box).dx).toBeLessThan(0);
    // Past the edge: as fast as it goes.
    expect(autoScrollStep({ x: 1400, y: 400 }, box).dx).toBe(24);
  });
});

describe("fit the selection (⇧T)", () => {
  it("keeps the zoom when the span fits, else zooms out until it does; never in", () => {
    expect(fitZoom({ start: 0, end: 0 }, 900, "quarter")).toBe("quarter");
    expect(fitZoom({ start: 0, end: 20 }, 900, "week")).toBe("month");
    expect(fitZoom({ start: 0, end: 60 }, 900, "month")).toBe("quarter");
    expect(fitZoom({ start: 0, end: 2000 }, 900, "month")).toBe("year");
  });
});

describe("moving tasks", () => {
  it("moves a due date by days, and names the day for one task", () => {
    const plan = planShift([task({ dueOn: "2026-10-14" })], 2, "one", ZONE, NOW);
    expect(plan.writes).toHaveLength(1);
    const write = plan.writes[0];
    expect(write?.taskId).toBe("t1");
    expect(write?.dueDate && new Date(write.dueDate).getDate()).toBe(16);
    expect(plan.label(1)).toMatch(/^Moved to /);
  });

  it("moves a selection together and says how far when their days differ", () => {
    const plan = planShift(
      [task({ id: "a", dueOn: "2026-10-14" }), task({ id: "b", dueOn: "2026-10-20" })],
      -7,
      "one",
      ZONE,
      NOW,
    );
    expect(plan.writes.map((w) => w.taskId)).toEqual(["a", "b"]);
    expect(plan.label(2)).toBe("Moved 2 tasks a week earlier");
  });

  it("moves a session-only task's session, its time of day kept; leaves undated ones", () => {
    const at = new Date(2026, 9, 15, 14, 30).toISOString();
    const plan = planShift(
      [task({ id: "s", scheduledAt: at }), task({ id: "none" })],
      1,
      "one",
      ZONE,
      NOW,
    );
    expect(plan.writes).toHaveLength(1);
    const moved = new Date(plan.writes[0]?.scheduledAt ?? "");
    expect(moved.getDate()).toBe(16);
    expect(moved.getHours()).toBe(14);
    expect(moved.getMinutes()).toBe(30);
    expect(shiftInstant(at, 0)).toBe(at);
  });

  it("a repeat moves just this occurrence, or its pattern", () => {
    const repeat = task({
      dueOn: "2026-10-14",
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=WE", nextOccurrence: null },
    } as Partial<Task>);
    expect(asksAboutRepeat(repeat)).toBe(true);
    expect(asksAboutRepeat(task({ dueOn: "2026-10-14" }))).toBe(false);
    const one = planShift([repeat], 1, "one", ZONE, NOW);
    expect(one.writes[0]).toEqual({ taskId: "t1", occurrenceOn: "2026-10-15" });
    const pattern = planShift([repeat], 1, "pattern", ZONE, NOW);
    expect(pattern.writes[0]?.recurrence?.rrule).toContain("BYDAY=TH");
    expect(pattern.writes[0]?.dueDate).toBeTruthy();
  });

  it("puts a task on a day, and does nothing when it's due then already", () => {
    expect(planDay(task(), "2026-10-20", "one", ZONE, NOW).writes).toHaveLength(1);
    expect(planDay(task({ dueOn: "2026-10-20" }), "2026-10-20", "one", ZONE, NOW).writes).toEqual(
      [],
    );
    expect(planDay(task(), "2026-10-20", "one", ZONE, NOW).label(1)).toMatch(/^Due /);
  });
});
