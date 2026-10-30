// Focus time (CALR-14, specs/calendar-rethink.md AC23): its own calendar item
// (kind "focus") that can hold a task. These pin the pure rules: how long it
// runs, the draft that creates it from a Plan task, F while a task is lifted,
// the chip flags, the title a one-line chip reads, and who sees what.
process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { whoSeesLine } from "./event-view";
import { type CalendarEventModel, eventChipsInRange } from "./events";
import {
  FOCUS_DEFAULT_MINUTES,
  FOCUS_TIME_TITLE,
  focusChipTitle,
  focusDraftForTask,
  focusMinutes,
  isFocusItem,
} from "./focus-item";
import { type Placement, togglePlacementKind } from "./place-task";

const MIN = 60_000;

function event(over: Partial<CalendarEventModel> = {}): CalendarEventModel {
  const start = new Date(2026, 10, 3, 14, 0);
  const end = new Date(2026, 10, 3, 16, 0);
  return {
    id: "f1",
    workspaceId: "w1",
    ownerId: "u1",
    sourceAccountId: null,
    externalEventId: null,
    calendarId: "moduo",
    title: "Investor deck",
    description: "",
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
    ...over,
  };
}

const week = {
  view: "week" as const,
  days: Array.from({ length: 7 }, (_, i) => new Date(2026, 10, 2 + i)),
  startMs: new Date(2026, 10, 2).getTime(),
  endMs: new Date(2026, 10, 9).getTime(),
};

describe("focus time is its own item (AC23)", () => {
  it("is the kind 'focus', nothing else", () => {
    expect(isFocusItem({ kind: "focus" })).toBe(true);
    expect(isFocusItem({ kind: "event" })).toBe(false);
    expect(isFocusItem({ kind: "hold" })).toBe(false);
    expect(isFocusItem({})).toBe(false);
  });

  it("runs for the task's estimate, or two hours without one", () => {
    expect(FOCUS_DEFAULT_MINUTES).toBe(120);
    expect(focusMinutes({ durationMinutes: 45 })).toBe(45);
    expect(focusMinutes({ durationMinutes: null })).toBe(120);
    expect(focusMinutes({ durationMinutes: 0 })).toBe(120);
    expect(focusMinutes({})).toBe(120);
  });

  it("holding a task, it takes the task's title and points at it", () => {
    const startMs = new Date(2026, 10, 3, 14, 0).getTime();
    expect(focusDraftForTask({ id: "t3", title: "Investor deck" }, startMs, 90)).toEqual({
      title: "Investor deck",
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(startMs + 90 * MIN).toISOString(),
      kind: "focus",
      focusTaskId: "t3",
    });
  });

  it("a task without a title still makes named focus time", () => {
    const startMs = new Date(2026, 10, 3, 14, 0).getTime();
    expect(focusDraftForTask({ id: "t4", title: "  " }, startMs, 120).title).toBe(FOCUS_TIME_TITLE);
  });
});

describe("F while a task is lifted: task block ⇄ focus time", () => {
  const lifted: Placement = {
    taskId: "t1",
    startMs: new Date(2026, 10, 3, 10).getTime(),
    durationMinutes: 30,
  };

  it("turns the lifted task into focus time holding it, two hours without an estimate", () => {
    const focus = togglePlacementKind(lifted, { durationMinutes: null });
    expect(focus).toEqual({ ...lifted, kind: "focus", durationMinutes: 120 });
  });

  it("focus time for an estimated task keeps the estimate", () => {
    expect(togglePlacementKind(lifted, { durationMinutes: 50 }).durationMinutes).toBe(50);
  });

  it("F again turns it back into the task block, at its own length, where it sits", () => {
    const focus = togglePlacementKind(lifted, { durationMinutes: null });
    const back = togglePlacementKind(focus, { durationMinutes: null });
    expect(back.kind).toBe("task");
    expect(back.durationMinutes).toBe(30);
    expect(back.startMs).toBe(lifted.startMs);
    expect(back.taskId).toBe("t1");
  });
});

describe("focus chips on the grid", () => {
  it("a focus item's chip says it's focus and that it holds a task", () => {
    const { timed } = eventChipsInRange([event({ kind: "focus", focusTaskId: "t3" })], week);
    const chip = timed.get("2026-11-03")?.[0];
    expect(chip?.focus).toBe(true);
    expect(chip?.holdsTask).toBe(true);
  });

  it("a teammate's focus time (masked: no task) is focus that holds nothing", () => {
    const masked = event({
      id: "k5",
      ownerId: "u2",
      title: "Focus time",
      kind: "focus",
      focusTaskId: null,
    });
    const chip = eventChipsInRange([masked], week).timed.get("2026-11-03")?.[0];
    expect(chip?.focus).toBe(true);
    expect(chip?.holdsTask).toBe(false);
  });

  it("an ordinary event is neither", () => {
    const chip = eventChipsInRange([event()], week).timed.get("2026-11-03")?.[0];
    expect(chip?.focus).toBe(false);
    expect(chip?.holdsTask).toBe(false);
  });

  it("a one-line focus chip reads 'Focus · title', never 'Focus · Focus time'", () => {
    expect(focusChipTitle("Investor deck", true)).toBe("Focus · Investor deck");
    expect(focusChipTitle(FOCUS_TIME_TITLE, true)).toBe(FOCUS_TIME_TITLE);
    expect(focusChipTitle("Investor deck", false)).toBe("Investor deck");
  });
});

describe("who sees your focus time", () => {
  const share = { workspaceLevel: "view" as const, people: [] };
  const members = [
    { userId: "u1", name: "Robin" },
    { userId: "u2", name: "Kai Ito" },
  ];

  it("teammates see “Focus time”, not the task", () => {
    expect(whoSeesLine(share, members, "u1", { isFocus: true })).toBe(
      "Workspace members see “Focus time”, not the task",
    );
  });

  it("private still wins", () => {
    expect(whoSeesLine(share, members, "u1", { isFocus: true, isPrivate: true })).toBe(
      "Private · workspace members see “Busy”",
    );
  });

  it("an ordinary event keeps the sharing line", () => {
    expect(whoSeesLine(share, members, "u1")).toBe("Everyone here sees it all");
  });
});
