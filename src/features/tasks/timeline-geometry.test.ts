// Tests for the Timeline view's pure geometry (specs/tasks-timeline.md).
// Each block name mirrors the spec's "Tests that prove them" table.

import { describe, expect, it } from "vitest";

import { makeTask } from "./helpers";
import type { Task, TaskRelation } from "./model";
import {
  arrowEndpoints,
  axisWindow,
  barForTask,
  buildTimelineRollup,
  DAY_WIDTH,
  dayIndex,
  FADE_PX,
  LANE_HEADER_H,
  layoutRows,
  ROW_H,
  sanitizeTimelineZoom,
  setBarEdge,
  shiftTaskDates,
  todayLineX,
} from "./timeline-geometry";

// Fixed local "now" — mid-day so day-fraction math is visible.
const NOW = new Date(2026, 6, 3, 12, 0); // Jul 3 2026, 12:00 local

let seq = 0;
function task(fields: Partial<Task>): Task {
  seq += 1;
  return {
    ...makeTask({
      workspaceId: "w1",
      bucketId: fields.bucketId ?? "b1",
      title: fields.title ?? `Task ${seq}`,
      position: fields.position ?? String(seq).padStart(10, "0"),
    }),
    id: fields.id ?? `t${seq}`,
    ...fields,
  };
}

/** ISO for a local wall-clock moment (mirrors how the app writes dates). */
function localIso(y: number, m: number, d: number, h = 0, min = 0): string {
  return new Date(y, m, d, h, min).toISOString();
}

describe("bar span per date shape (AC2)", () => {
  const win = axisWindow([], "month", NOW);

  it("both dates → solid span over both days inclusive", () => {
    const t = task({
      scheduledAt: localIso(2026, 6, 6, 10, 30),
      dueDate: localIso(2026, 6, 10), // local midnight — the due-date convention
    });
    const bar = barForTask(t, win, NOW)!;
    expect(bar.solidLeft).toBe(true);
    expect(bar.solidRight).toBe(true);
    expect(bar.width).toBe(5 * win.dayWidth); // Jul 6..10 inclusive
    expect(bar.x).toBe(dayIndex(win, new Date(2026, 6, 6)) * win.dayWidth);
  });

  it("scheduled only → solid left edge, faded right", () => {
    const t = task({ scheduledAt: localIso(2026, 6, 6, 9, 0) });
    const bar = barForTask(t, win, NOW)!;
    expect(bar.solidLeft).toBe(true);
    expect(bar.solidRight).toBe(false);
    expect(bar.width).toBe(win.dayWidth + FADE_PX);
  });

  it("due only → faded left, solid right edge ending on the due day", () => {
    const t = task({ dueDate: localIso(2026, 6, 10) });
    const bar = barForTask(t, win, NOW)!;
    expect(bar.solidLeft).toBe(false);
    expect(bar.solidRight).toBe(true);
    const dueX = dayIndex(win, new Date(2026, 6, 10)) * win.dayWidth;
    expect(bar.x).toBe(dueX - FADE_PX);
    expect(bar.x + bar.width).toBe(dueX + win.dayWidth);
  });

  it("undated → no bar (tray only)", () => {
    expect(barForTask(task({}), win, NOW)).toBeNull();
  });

  it("due-date local-midnight instants bucket to the LOCAL calendar day", () => {
    // The app writes due dates from local midnight; east of UTC the ISO string
    // lands on the previous UTC day. The bar must sit on the local day.
    const t = task({ dueDate: new Date(2026, 6, 10, 0, 0).toISOString() });
    const bar = barForTask(t, win, NOW)!;
    expect(bar.x + bar.width).toBe((dayIndex(win, new Date(2026, 6, 10)) + 1) * win.dayWidth);
  });

  it("bad data (due before scheduled) heals to a 1-day solid bar at scheduledAt", () => {
    const t = task({
      scheduledAt: localIso(2026, 6, 10, 9, 0),
      dueDate: localIso(2026, 6, 6),
    });
    const bar = barForTask(t, win, NOW)!;
    expect(bar.x).toBe(dayIndex(win, new Date(2026, 6, 10)) * win.dayWidth);
    expect(bar.width).toBe(win.dayWidth);
    expect(bar.solidLeft).toBe(true);
    expect(bar.solidRight).toBe(true);
  });

  it("past-end open bars flag the ambient dot; done bars never do", () => {
    const overdue = barForTask(task({ dueDate: localIso(2026, 6, 1) }), win, NOW)!;
    expect(overdue.pastEnd).toBe(true);
    const doneTask = task({ dueDate: localIso(2026, 6, 1), status: "done" });
    const done = barForTask(doneTask, win, NOW)!;
    expect(done.pastEnd).toBe(false);
    expect(done.done).toBe(true);
    const future = barForTask(task({ dueDate: localIso(2026, 6, 20) }), win, NOW)!;
    expect(future.pastEnd).toBe(false);
  });
});

describe("day snapping preserves clock time (AC5)", () => {
  it("moving a bar N days keeps the original hh:mm on both dates", () => {
    const t = task({
      scheduledAt: localIso(2026, 6, 6, 10, 30),
      dueDate: localIso(2026, 6, 10, 0, 0),
    });
    const patch = shiftTaskDates(t, 7);
    const sched = new Date(patch.scheduledAt!);
    expect([sched.getMonth(), sched.getDate()]).toEqual([6, 13]);
    expect([sched.getHours(), sched.getMinutes()]).toEqual([10, 30]);
    const due = new Date(patch.dueDate!);
    expect([due.getMonth(), due.getDate()]).toEqual([6, 17]);
    expect([due.getHours(), due.getMinutes()]).toEqual([0, 0]);
  });

  it("moving a half-open bar never invents the missing date", () => {
    const patch = shiftTaskDates(task({ scheduledAt: localIso(2026, 6, 6, 9, 0) }), -3);
    expect(patch.scheduledAt).toBeDefined();
    expect(patch.dueDate).toBeUndefined();
  });

  it("edge moves clamp to a 1-day span and never invert — not even sub-day", () => {
    const t = task({
      scheduledAt: localIso(2026, 6, 6, 10, 30),
      dueDate: localIso(2026, 6, 10, 0, 0),
    });
    // Dragging the start past the end clamps to the due INSTANT (midnight
    // Jul 10) — re-applying 10:30 there would invert start/due within the day.
    const startPatch = setBarEdge(t, "start", new Date(2026, 6, 20));
    const sched = new Date(startPatch.scheduledAt!);
    expect(sched.getTime()).toBe(new Date(t.dueDate!).getTime());
    expect([sched.getMonth(), sched.getDate()]).toEqual([6, 10]);
    // Dragging the end before the start clamps to the start's instant.
    const endPatch = setBarEdge(t, "end", new Date(2026, 6, 1));
    const due = new Date(endPatch.dueDate!);
    expect([due.getMonth(), due.getDate()]).toEqual([6, 6]);
    expect(due.getTime()).toBeGreaterThanOrEqual(new Date(t.scheduledAt!).getTime());
  });

  it("a faded-edge set anchors a new start at 09:00 local", () => {
    const t = task({ dueDate: localIso(2026, 6, 10) });
    const patch = setBarEdge(t, "start", new Date(2026, 6, 7));
    const sched = new Date(patch.scheduledAt!);
    expect([sched.getDate(), sched.getHours(), sched.getMinutes()]).toEqual([7, 9, 0]);
  });
});

describe("lane ordering + collapse (AC4)", () => {
  const win = axisWindow([], "month", NOW);
  const laneDefs = [
    { id: "inbox", name: "Inbox" },
    { id: "b1", name: "Deep work" },
    { id: "b2", name: "Admin" },
  ];

  it("lanes follow rail order, skip dateless buckets, sort bars by start", () => {
    const tasks = [
      task({ bucketId: "b1", scheduledAt: localIso(2026, 6, 10, 9) }),
      task({ bucketId: "b1", scheduledAt: localIso(2026, 6, 4, 9) }),
      task({ bucketId: "inbox", dueDate: localIso(2026, 6, 8) }),
      task({ bucketId: "b2" }), // undated — b2 has no lane
    ];
    const { lanes, tray } = buildTimelineRollup({
      tasks,
      laneDefs,
      collapsedIds: new Set(),
      window: win,
      now: NOW,
    });
    expect(lanes.map((l) => l.bucketId)).toEqual(["inbox", "b1"]);
    const b1 = lanes[1];
    expect(b1.bars.map((b) => b.task.id)).toEqual([tasks[1].id, tasks[0].id]);
    expect(tray.map((t) => t.id)).toEqual([tasks[3].id]);
  });

  it("orders by day, not pixel x — a due-only fade offset never outranks an earlier start", () => {
    // Due-only bars sit FADE_PX left of their day; at narrow zooms that pixel
    // offset crosses day columns. Row order must follow the DATE regardless.
    const tasks = [
      task({ bucketId: "b1", dueDate: localIso(2026, 6, 9) }), // due Jul 9
      task({ bucketId: "b1", scheduledAt: localIso(2026, 6, 8, 9) }), // starts Jul 8
    ];
    for (const zoom of ["week", "month", "quarter"] as const) {
      const { lanes } = buildTimelineRollup({
        tasks,
        laneDefs,
        collapsedIds: new Set(),
        window: axisWindow(tasks, zoom, NOW),
        now: NOW,
      });
      expect(lanes[0].bars.map((b) => b.task.id)).toEqual([tasks[1].id, tasks[0].id]);
    }
  });

  it("collapsed lanes contribute no rows but keep their count", () => {
    const tasks = [
      task({ bucketId: "b1", scheduledAt: localIso(2026, 6, 4, 9) }),
      task({ bucketId: "b1", scheduledAt: localIso(2026, 6, 5, 9) }),
    ];
    const { lanes } = buildTimelineRollup({
      tasks,
      laneDefs,
      collapsedIds: new Set(["b1"]),
      window: win,
      now: NOW,
    });
    expect(lanes).toHaveLength(1);
    expect(lanes[0].collapsed).toBe(true);
    expect(lanes[0].bars).toHaveLength(0);
    expect(lanes[0].count).toBe(2);
    const layout = layoutRows(lanes);
    expect(layout.totalHeight).toBe(LANE_HEADER_H);
    expect(layout.barsByTask.size).toBe(0);
  });
});

describe("axis window per zoom + today position (AC3)", () => {
  it("each zoom maps to its day width and the window covers tasks + today", () => {
    const tasks = [
      task({ scheduledAt: localIso(2026, 5, 20, 9) }), // Jun 20
      task({ dueDate: localIso(2026, 7, 15) }), // Aug 15
    ];
    for (const zoom of ["week", "month", "quarter"] as const) {
      const win = axisWindow(tasks, zoom, NOW);
      expect(win.dayWidth).toBe(DAY_WIDTH[zoom]);
      expect(dayIndex(win, new Date(2026, 5, 20))).toBeGreaterThan(0);
      expect(dayIndex(win, new Date(2026, 7, 15))).toBeLessThan(win.totalDays - 1);
      expect(dayIndex(win, NOW)).toBeGreaterThanOrEqual(0);
    }
  });

  it("the today line sits inside today's column at the elapsed fraction", () => {
    const win = axisWindow([], "month", NOW);
    const x = todayLineX(win, NOW);
    const colStart = dayIndex(win, NOW) * win.dayWidth;
    expect(x).toBeGreaterThan(colStart);
    expect(x).toBeLessThan(colStart + win.dayWidth);
    expect(x).toBeCloseTo(colStart + win.dayWidth / 2, 5); // 12:00 = half the day
  });

  it("clamps the extent so one absurd date can't explode the canvas", () => {
    const typo = task({ dueDate: new Date(2126, 6, 10).toISOString() }); // year typo
    for (const zoom of ["week", "month", "quarter"] as const) {
      const win = axisWindow([typo], zoom, NOW);
      // Bounded: max extent cap on both sides + padding, never ~36,500 days.
      expect(win.totalDays).toBeLessThan(2000);
    }
  });

  it("sanitizes the persisted zoom to Month by default", () => {
    expect(sanitizeTimelineZoom("week")).toBe("week");
    expect(sanitizeTimelineZoom("quarter")).toBe("quarter");
    expect(sanitizeTimelineZoom("board")).toBe("month");
    expect(sanitizeTimelineZoom(null)).toBe("month");
  });
});

describe("arrow endpoints (AC7)", () => {
  const win = axisWindow([], "month", NOW);
  const laneDefs = [{ id: "b1", name: "Deep work" }];

  function positioned(tasks: Task[], collapsed: Set<string> = new Set()) {
    const { lanes } = buildTimelineRollup({
      tasks,
      laneDefs: [...laneDefs, { id: "b2", name: "Admin" }],
      collapsedIds: collapsed,
      window: win,
      now: NOW,
    });
    return layoutRows(lanes).barsByTask;
  }

  it("blocker→blocked resolves to end→start anchors on solid edges", () => {
    const blocker = task({
      id: "blocker",
      bucketId: "b1",
      scheduledAt: localIso(2026, 6, 4, 9),
      dueDate: localIso(2026, 6, 6),
    });
    const blocked = task({
      id: "blocked",
      bucketId: "b1",
      scheduledAt: localIso(2026, 6, 8, 9),
    });
    const rel: TaskRelation = {
      id: "r1",
      workspaceId: "w1",
      blockerTaskId: "blocker",
      blockedTaskId: "blocked",
      createdAt: "",
    };
    const bars = positioned([blocker, blocked]);
    const [arrow] = arrowEndpoints([rel], bars);
    const from = bars.get("blocker")!;
    const to = bars.get("blocked")!;
    expect(arrow.x1).toBe(from.x + from.width); // solid right edge
    expect(arrow.x2).toBe(to.x); // solid left edge
    expect(arrow.y1).toBe(from.y + ROW_H / 2);
    expect(arrow.y2).toBe(to.y + ROW_H / 2);
  });

  it("pairs with a hidden endpoint are dropped (collapsed lane / trayed)", () => {
    const blocker = task({
      id: "blocker",
      bucketId: "b1",
      scheduledAt: localIso(2026, 6, 4, 9),
    });
    const blockedInB2 = task({
      id: "blocked",
      bucketId: "b2",
      scheduledAt: localIso(2026, 6, 8, 9),
    });
    const undated = task({ id: "undated", bucketId: "b1" });
    const rels: TaskRelation[] = [
      {
        id: "r1",
        workspaceId: "w1",
        blockerTaskId: "blocker",
        blockedTaskId: "blocked",
        createdAt: "",
      },
      {
        id: "r2",
        workspaceId: "w1",
        blockerTaskId: "blocker",
        blockedTaskId: "undated",
        createdAt: "",
      },
    ];
    // b2 collapsed → its bar is hidden; the undated task never has a bar.
    const bars = positioned([blocker, blockedInB2, undated], new Set(["b2"]));
    expect(arrowEndpoints(rels, bars)).toHaveLength(0);
  });
});

describe("tray membership (AC2, AC6)", () => {
  const win = axisWindow([], "month", NOW);

  it("undated open tasks (and only those) land in the tray", () => {
    const undatedOpen = task({});
    const undatedDone = task({ status: "done" });
    const dated = task({ scheduledAt: localIso(2026, 6, 6, 9) });
    const { tray } = buildTimelineRollup({
      tasks: [undatedOpen, undatedDone, dated],
      laneDefs: [{ id: "b1", name: "Deep work" }],
      collapsedIds: new Set(),
      window: win,
      now: NOW,
    });
    expect(tray.map((t) => t.id)).toEqual([undatedOpen.id]);
  });

  it("nested undated subtasks stay off the tray; orphans and dated subtasks stay visible", () => {
    const parent = task({ id: "parent", scheduledAt: localIso(2026, 6, 6, 9) });
    const nestedSub = task({ id: "nested", parentId: "parent" }); // covered by parent
    const orphanSub = task({ id: "orphan", parentId: "gone" }); // parent out of scope
    const datedSub = task({ id: "dated-sub", parentId: "parent", dueDate: localIso(2026, 6, 9) });
    const { tray, lanes } = buildTimelineRollup({
      tasks: [parent, nestedSub, orphanSub, datedSub],
      laneDefs: [{ id: "b1", name: "Deep work" }],
      collapsedIds: new Set(),
      window: win,
      now: NOW,
    });
    expect(tray.map((t) => t.id)).toEqual(["orphan"]);
    // Dated subtasks render as their own bars (spec: no parent rollup bars).
    expect(lanes[0].bars.map((b) => b.task.id)).toContain("dated-sub");
  });
});
