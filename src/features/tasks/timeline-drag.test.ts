// "drop resolution" — a drag result (body/edge/tray) maps to the right
// mutation args (specs/tasks-timeline.md AC5/AC6). The connector-dot half of
// the spec's test row lands with TL-3.

import { describe, expect, it } from "@rstest/core";

import type { TaskRelation } from "./model";
import { resolveBarDrag, resolveConnectorDrop, resolveTrayDrop } from "./timeline-drag";
import { axisWindow, dayAtX } from "./timeline-geometry";

function localIso(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m, d, h, min).toISOString();
}

const BOTH = {
  scheduledAt: localIso(2026, 6, 6, 10, 30),
  dueDate: localIso(2026, 6, 10, 0, 0),
};

describe("drop resolution (AC5, AC6)", () => {
  it("body move shifts every known date by whole days, preserving clock time", () => {
    const patch = resolveBarDrag(BOTH, "move", { deltaDays: 7, pointerDay: new Date() })!;
    const sched = new Date(patch.scheduledAt!);
    const due = new Date(patch.dueDate!);
    expect([sched.getDate(), sched.getHours(), sched.getMinutes()]).toEqual([13, 10, 30]);
    expect([due.getDate(), due.getHours()]).toEqual([17, 0]);
  });

  it("a zero-day move resolves to a no-op (no write)", () => {
    expect(resolveBarDrag(BOTH, "move", { deltaDays: 0, pointerDay: new Date() })).toBeNull();
  });

  it("a solid-edge drag adjusts that date to the pointer's day", () => {
    const patch = resolveBarDrag(BOTH, "end", {
      deltaDays: 0,
      pointerDay: new Date(2026, 6, 14),
    })!;
    expect(patch.scheduledAt).toBeUndefined();
    const due = new Date(patch.dueDate!);
    expect([due.getMonth(), due.getDate()]).toEqual([6, 14]);
  });

  it("a faded-edge drag SETS the missing date (the bar solidifies)", () => {
    const dueOnly = { scheduledAt: null, dueDate: localIso(2026, 6, 10) };
    const patch = resolveBarDrag(dueOnly, "start", {
      deltaDays: 0,
      pointerDay: new Date(2026, 6, 7),
    })!;
    const sched = new Date(patch.scheduledAt!);
    // A newly-set start anchors at 09:00 local.
    expect([sched.getDate(), sched.getHours(), sched.getMinutes()]).toEqual([7, 9, 0]);
  });

  it("an inverting edge drag clamps to a 1-day span instead of writing an inversion", () => {
    const patch = resolveBarDrag(BOTH, "end", {
      deltaDays: 0,
      pointerDay: new Date(2026, 6, 1), // before the Jul 6 start
    })!;
    const due = new Date(patch.dueDate!);
    expect([due.getMonth(), due.getDate()]).toEqual([6, 6]); // clamped to the start day
  });

  it("an edge drag landing on the current day resolves to a no-op", () => {
    // dueDate is already local midnight Jul 10 — setting the end to Jul 10
    // produces the identical instant, so nothing should be written.
    expect(
      resolveBarDrag(BOTH, "end", { deltaDays: 0, pointerDay: new Date(2026, 6, 10) }),
    ).toBeNull();
  });

  it("a tray drop sets scheduledAt at 09:00 local on that day and nothing else", () => {
    const undated = { scheduledAt: null, dueDate: null };
    const patch = resolveTrayDrop(undated, new Date(2026, 6, 8))!;
    const sched = new Date(patch.scheduledAt!);
    expect([sched.getMonth(), sched.getDate(), sched.getHours()]).toEqual([6, 8, 9]);
    expect(patch.dueDate).toBeUndefined(); // schedule ≠ deadline
  });

  it("connector drops resolve blocker→blocked; self/duplicate/cycle are silent no-ops (AC8)", () => {
    const rel = (blocker: string, blocked: string): TaskRelation => ({
      id: `${blocker}:${blocked}`,
      workspaceId: "w1",
      blockerTaskId: blocker,
      blockedTaskId: blocked,
      createdAt: "",
    });
    const relations = [rel("a", "b"), rel("b", "c")];
    // Valid: a's dot onto d → a blocks d.
    expect(resolveConnectorDrop("a", "d", relations)).toEqual({
      blockerTaskId: "a",
      blockedTaskId: "d",
    });
    // Self, missed drop, and an existing edge are no-ops.
    expect(resolveConnectorDrop("a", "a", relations)).toBeNull();
    expect(resolveConnectorDrop("a", null, relations)).toBeNull();
    expect(resolveConnectorDrop("a", "b", relations)).toBeNull();
    // c's dot onto a would close the a→b→c cycle — no-op.
    expect(resolveConnectorDrop("c", "a", relations)).toBeNull();
  });

  it("dayAtX maps canvas x to the local day, clamped to the window", () => {
    const win = axisWindow([], "month", new Date(2026, 6, 3, 12, 0));
    expect(dayAtX(win, 0).getTime()).toBe(win.start.getTime());
    const idx5 = dayAtX(win, 5 * win.dayWidth + 1);
    expect((idx5.getTime() - win.start.getTime()) / 86_400_000).toBeCloseTo(5, 5);
    // Far past the right edge clamps to the last day, never out of range.
    const beyond = dayAtX(win, win.totalDays * win.dayWidth * 3);
    expect((beyond.getTime() - win.start.getTime()) / 86_400_000).toBeLessThan(win.totalDays);
  });
});
