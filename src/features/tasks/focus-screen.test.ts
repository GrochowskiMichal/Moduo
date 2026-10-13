// TV-F7: the Focus screen's rules (spec §7; REPLAN 62, 62a, 63, 66).

import { describe, expect, it } from "@rstest/core";

import {
  doneLineText,
  focusLineup,
  pillReading,
  scheduledToday,
  upNextLines,
  upNextSummary,
} from "./focus-screen";
import { makeTask } from "./helpers";
import type { Task } from "./model";

const ME = "u-me";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
    ...over,
  };
}

describe("focusLineup: the Now card and Up next", () => {
  it("Now is the head of Up next when no session is on", () => {
    const { now, upNext } = focusLineup([task("a"), task("b"), task("c")], null);
    expect(now?.id).toBe("a");
    expect(upNext.map((t) => t.id)).toEqual(["b", "c"]);
  });

  it("Now is the session's task, wherever it sits in the line-up", () => {
    const b = task("b");
    const { now, upNext } = focusLineup([task("a"), b, task("c")], b);
    expect(now?.id).toBe("b");
    expect(upNext.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("a finished session task falls back to the head; done ones leave Up next", () => {
    const done = task("a", { status: "done" });
    const { now, upNext } = focusLineup([done, task("b"), task("c")], done);
    expect(now?.id).toBe("b");
    expect(upNext.map((t) => t.id)).toEqual(["c"]);
  });

  it("a task still saving is never Now, but stays in Up next", () => {
    const { now, upNext } = focusLineup([task("tmp-1"), task("b")], null);
    expect(now?.id).toBe("b");
    expect(upNext.map((t) => t.id)).toEqual(["tmp-1"]);
  });

  it("nothing lined up: no Now", () => {
    expect(focusLineup([], null).now).toBeNull();
  });
});

describe("upNextLines: project dividers (62)", () => {
  it("marks every project change, keeping the line-up's order", () => {
    const lines = upNextLines([
      task("a", { bucketId: "bugs" }),
      task("b", { bucketId: "web" }),
      task("c", { bucketId: "web" }),
      task("d", { bucketId: "bugs" }),
    ]);
    expect(lines.map((l) => (l.kind === "divider" ? `|${l.projectId}` : l.task.id))).toEqual([
      "|bugs",
      "a",
      "|web",
      "b",
      "c",
      "|bugs",
      "d",
    ]);
    expect(
      lines.filter((l) => l.kind === "task").map((l) => l.kind === "task" && l.number),
    ).toEqual([1, 2, 3, 4]);
  });

  it("a line-up in one project has no dividers", () => {
    const lines = upNextLines([task("a"), task("b")]);
    expect(lines.every((l) => l.kind === "task")).toBe(true);
  });
});

describe("upNextSummary: '· 4 · ~1h'", () => {
  it("counts and sums the estimates there are", () => {
    expect(
      upNextSummary([
        task("a", { estimateMinutes: 10 }),
        task("b", { estimateMinutes: 50 }),
        task("c", { estimateMinutes: null }),
      ]),
    ).toBe("· 3 · ~1h");
  });

  it("no estimates: just the count; nothing: nothing", () => {
    expect(upNextSummary([task("a", { estimateMinutes: null })])).toBe("· 1");
    expect(upNextSummary([])).toBe("");
  });
});

describe("pillReading: one number per job (62, 62a, 63)", () => {
  it("no estimate: this sitting's clock alone", () => {
    expect(
      pillReading({ sitting: 65, total: 65, estimateMinutes: null, countdown: false }),
    ).toEqual({ clock: "1:05", note: null, over: false });
  });

  it("'18:02 of ~45m' when nothing was tracked before this sitting", () => {
    const r = pillReading({ sitting: 1082, total: 1082, estimateMinutes: 45, countdown: false });
    expect(r).toEqual({ clock: "18:02", note: "of ~45m", over: false });
  });

  it("'~12m left' when some was tracked before", () => {
    // 15m before + 18m now of 45m → 12m left.
    const r = pillReading({ sitting: 1080, total: 1980, estimateMinutes: 45, countdown: false });
    expect(r).toEqual({ clock: "18:00", note: "~12m left", over: false });
  });

  it("past the estimate: a neutral '+5m'", () => {
    const r = pillReading({ sitting: 3000, total: 3000, estimateMinutes: 45, countdown: false });
    expect(r).toEqual({ clock: "50:00", note: "+5m", over: true });
  });

  it("Count down the estimate: what's left, then +m:ss", () => {
    expect(pillReading({ sitting: 600, total: 600, estimateMinutes: 45, countdown: true })).toEqual(
      { clock: "35:00", note: "left", over: false },
    );
    expect(
      pillReading({ sitting: 2830, total: 2830, estimateMinutes: 45, countdown: true }),
    ).toEqual({ clock: "+2:10", note: null, over: true });
  });

  it("Count down with no estimate counts up (63)", () => {
    expect(
      pillReading({ sitting: 30, total: 30, estimateMinutes: null, countdown: true }).clock,
    ).toBe("0:30");
  });
});

describe("scheduledToday: the empty state's rows (66)", () => {
  const now = new Date(2026, 9, 13, 8, 0);
  const at = (h: number, m = 0) => new Date(2026, 9, 13, h, m).toISOString();

  it("my sessions today, each task once at its first time, in time order", () => {
    const a = task("a");
    const b = task("b");
    const rows = scheduledToday({
      tasks: [a, b],
      sessions: [
        { taskId: "a", userId: ME, startsAt: at(15) },
        { taskId: "b", userId: ME, startsAt: at(9, 30) },
        { taskId: "a", userId: ME, startsAt: at(11) },
      ],
      me: ME,
      now,
      queuedIds: new Set(),
    });
    expect(rows.map((r) => [r.task.id, new Date(r.at).getHours()])).toEqual([
      ["b", 9],
      ["a", 11],
    ]);
  });

  it("leaves out teammates' sessions, other days, queued, finished and Backlog tasks", () => {
    const rows = scheduledToday({
      tasks: [
        task("theirs"),
        task("tomorrow"),
        task("queued"),
        task("done", { status: "done" }),
        task("backlog", { statusCategory: "backlog" }),
      ],
      sessions: [
        { taskId: "theirs", userId: "u-mike", startsAt: at(10) },
        { taskId: "tomorrow", userId: ME, startsAt: new Date(2026, 9, 14, 10).toISOString() },
        { taskId: "queued", userId: ME, startsAt: at(10) },
        { taskId: "done", userId: ME, startsAt: at(10) },
        { taskId: "backlog", userId: ME, startsAt: at(10) },
      ],
      me: ME,
      now,
      queuedIds: new Set(["queued"]),
    });
    expect(rows).toEqual([]);
  });

  it("a task with no session known shows by its scheduled time, if it's mine or nobody's", () => {
    const rows = scheduledToday({
      tasks: [
        task("mine", { scheduledAt: at(14), assigneeId: ME }),
        task("nobody", { scheduledAt: at(13), assigneeId: null }),
        task("mike", { scheduledAt: at(12), assigneeId: "u-mike" }),
      ],
      sessions: [],
      me: ME,
      now,
      queuedIds: new Set(),
    });
    expect(rows.map((r) => r.task.id)).toEqual(["nobody", "mine"]);
  });
});

describe("doneLineText: '2 done · 1h 12m' (62a)", () => {
  it("count and time; under Off just the count", () => {
    expect(doneLineText({ done: 2, seconds: 72 * 60, timed: true })).toBe("2 done · 1h 12m");
    expect(doneLineText({ done: 2, seconds: 72 * 60, timed: false })).toBe("2 done");
    expect(doneLineText({ done: 1, seconds: 20, timed: true })).toBe("1 done");
  });
});
