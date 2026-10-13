// TV-F7: the Focus screen's rules (spec §7; REPLAN 62, 62a, 63, 66).

import { describe, expect, it } from "@rstest/core";

import type { AgentSession } from "../spine/agent-session";
import {
  ALONG_THE_WAY_MAX_MINUTES,
  alongTheWayOffer,
  arrangeByProject,
  arrangedQueue,
  doneLineText,
  focusLineup,
  inFlightItems,
  meetingSlot,
  nextMeeting,
  pillReading,
  projectSwitches,
  scheduledToday,
  type UpNextLine,
  upNextLines,
  upNextMove,
  upNextSummary,
} from "./focus-screen";
import { makeTask } from "./helpers";
import type { Task, TaskReminder, TaskWaitingEntry } from "./model";
import { applyQueueMoves, queueMove, queueMoves } from "./queue";

const ME = "u-me";

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: `Task ${id}`, position: id }),
    id,
    ...over,
  };
}

const lineWord = (l: UpNextLine) =>
  l.kind === "divider" ? `|${l.projectId}` : l.kind === "meeting" ? `@${l.title}` : l.task.id;

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
    expect(lines.map(lineWord)).toEqual(["|bugs", "a", "|web", "b", "c", "|bugs", "d"]);
    expect(
      lines.filter((l) => l.kind === "task").map((l) => l.kind === "task" && l.number),
    ).toEqual([1, 2, 3, 4]);
  });

  it("a line-up in one project has no dividers", () => {
    const lines = upNextLines([task("a"), task("b")]);
    expect(lines.every((l) => l.kind === "task")).toBe(true);
  });
});

describe("upNextMove: a move inside Up next, as the whole line-up", () => {
  // The line-up N, X, C, D with the session on X: Up next shows N, C, D.
  const queue = ["N", "X", "C", "D"];
  const upNext = ["N", "C", "D"];

  it("to the top of Up next: right before the task it now precedes; Now stays", () => {
    expect(upNextMove(queue, upNext, "D", 0)).toEqual(["D", "N", "X", "C"]);
  });

  it("down or up: right after the task it now follows", () => {
    expect(upNextMove(queue, upNext, "N", 1)).toEqual(["X", "C", "N", "D"]);
    // Up next then reads N, D, C; Now keeps its place in the line-up.
    expect(upNextMove(queue, upNext, "D", 1)).toEqual(["N", "D", "X", "C"]);
    expect(upNextMove(queue, upNext, "C", 0)).toEqual(["C", "N", "X", "D"]);
  });

  it("each result is one task moved, which reorderQueue can apply", () => {
    for (const [id, to] of [
      ["D", 0],
      ["N", 2],
      ["C", 0],
    ] as const) {
      const next = upNextMove(queue, upNext, id, to);
      expect(next && queueMove(queue, next)?.taskId).toBe(id);
    }
  });

  it("no move, a task not in Up next, or past the ends: null", () => {
    expect(upNextMove(queue, upNext, "C", 1)).toBeNull();
    expect(upNextMove(queue, upNext, "X", 0)).toBeNull();
    expect(upNextMove(queue, upNext, "N", 3)).toBeNull();
    expect(upNextMove(queue, upNext, "N", -1)).toBeNull();
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

// ── TV-F8: the meeting divider, Arrange, along the way, In flight ───────────

const MIN = 60_000;
const NOW = Date.parse("2026-10-14T12:00:00Z");

function event(id: string, startsAt: number, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Event ${id}`,
    startsAt: new Date(startsAt).toISOString(),
    endsAt: new Date(startsAt + 30 * MIN).toISOString(),
    allDay: false,
    rrule: null,
    status: "confirmed",
    deletedAt: null,
    ownerId: ME,
    ...over,
  };
}

describe("the next meeting divider (64, AC8.6)", () => {
  it("is the next event of mine within two hours", () => {
    const events = [
      event("late", NOW + 3 * 60 * MIN),
      event("call", NOW + 90 * MIN),
      event("theirs", NOW + 20 * MIN, { ownerId: "u-other" }),
      event("gone", NOW + 10 * MIN, { status: "cancelled" }),
      event("day", NOW + 10 * MIN, { allDay: true }),
      event("past", NOW - 5 * MIN),
    ];
    expect(nextMeeting(events, { me: ME, nowMs: NOW })?.title).toBe("Event call");
    // Nothing within two hours: no divider.
    expect(nextMeeting([event("late", NOW + 3 * 60 * MIN)], { me: ME, nowMs: NOW })).toBeNull();
    // A line-up longer than two hours looks as far as it runs.
    expect(
      nextMeeting([event("late", NOW + 3 * 60 * MIN)], {
        me: ME,
        nowMs: NOW,
        horizonMs: 4 * 60 * MIN,
      })?.title,
    ).toBe("Event late");
  });

  it("sits after the tasks that fit before it, by their estimates", () => {
    const upNext = [
      task("a", { estimateMinutes: 20 }),
      task("b", { estimateMinutes: 30 }),
      task("c", { estimateMinutes: 15 }),
    ];
    // 90 minutes away, Now has 30 left: a (20) and b (30) fit, c doesn't.
    const at = meetingSlot(upNext, {
      nowMs: NOW,
      startsAt: NOW + 90 * MIN,
      hasNow: true,
      nowLeftMinutes: 30,
    });
    expect(at).toBe(2);
    const lines = upNextLines(upNext, { index: at, title: "Acme call", startsAt: NOW + 90 * MIN });
    expect(lines.map(lineWord)).toEqual(["a", "b", "@Acme call", "c"]);
  });

  it("without estimates it sits at the top; everything fitting puts it last", () => {
    const unknown = [task("a"), task("b", { estimateMinutes: 10 })];
    const in60 = { nowMs: NOW, startsAt: NOW + 60 * MIN, nowLeftMinutes: null };
    expect(meetingSlot(unknown, { ...in60, hasNow: true })).toBe(0);
    expect(meetingSlot(unknown, { ...in60, hasNow: false })).toBe(0);
    const small = [task("a", { estimateMinutes: 5 })];
    const at = meetingSlot(small, { ...in60, hasNow: true, nowLeftMinutes: 10 });
    expect(at).toBe(1);
    expect(upNextLines(small, { index: at, title: "Call", startsAt: NOW }).map(lineWord)).toEqual([
      "a",
      "@Call",
    ]);
  });

  it("goes ahead of the project divider where it falls", () => {
    const lines = upNextLines([task("a", { bucketId: "web" }), task("b", { bucketId: "home" })], {
      index: 1,
      title: "Call",
      startsAt: NOW,
    });
    expect(lines.map(lineWord)).toEqual(["|web", "a", "@Call", "|home", "b"]);
  });
});

describe("Arrange by project (57, AC8.7)", () => {
  const now = task("now", { bucketId: "web" });
  const mixed = [
    task("a", { bucketId: "bugs" }),
    task("b", { bucketId: "web" }),
    task("c", { bucketId: "bugs" }),
    task("d", { bucketId: "web" }),
    task("e", { bucketId: "home", priority: "high" }),
  ];

  it("groups by project, Now's first, then high priority, order kept inside", () => {
    const { order, saved } = arrangeByProject(now, mixed);
    expect(order.map((t) => t.id)).toEqual(["b", "d", "e", "a", "c"]);
    // now(web) a b c d e: 5 switches; arranged web web web home bugs bugs: 2.
    expect(projectSwitches(["web", ...mixed.map((t) => t.bucketId)])).toBe(5);
    expect(saved).toBe(3);
  });

  it("saves nothing on a line-up already together", () => {
    const together = [task("a", { bucketId: "web" }), task("b", { bucketId: "bugs" })];
    expect(arrangeByProject(now, together).saved).toBe(0);
  });

  it("keeps Now and other lined-up tasks in their slots", () => {
    expect(arrangedQueue(["x", "now", "a", "b", "c"], ["a", "b", "c"], ["c", "a", "b"])).toEqual([
      "x",
      "now",
      "c",
      "a",
      "b",
    ]);
  });

  it("turns into single moves the queue op can apply, and Undo walks back", () => {
    const before = ["now", "a", "b", "c", "d", "e"];
    const after = ["now", "b", "d", "e", "a", "c"];
    const moves = queueMoves(before, after);
    const entries = before.map((taskId, i) => ({
      id: `q-${taskId}`,
      workspaceId: "w1",
      userId: ME,
      taskId,
      position: `a${i}`,
      queuedAt: "",
      updatedAt: "",
    }));
    expect(applyQueueMoves(entries, moves).map((e) => e.taskId)).toEqual(after);
    const back = applyQueueMoves(applyQueueMoves(entries, moves), queueMoves(after, before));
    expect(back.map((e) => e.taskId)).toEqual(before);
    expect(queueMoves(before, before)).toEqual([]);
  });
});

describe("the along-the-way offer (57, 59a, AC8.8)", () => {
  const leaving = task("logo", { bucketId: "acme" });
  const next = task("site", { bucketId: "web" });
  const invoice = task("invoice", { bucketId: "acme", estimateMinutes: 5 });
  const base = {
    leaving,
    next,
    lineup: new Set<string>(),
    me: ME,
    blocked: new Set<string>(),
    waiting: new Set<string>(),
  };

  it("offers one quick task from the project you're leaving, only at a project change", () => {
    expect(alongTheWayOffer({ ...base, tasks: [leaving, next, invoice] })?.id).toBe("invoice");
    // Same project next: no offer. Nothing next (the session ends): no offer.
    expect(
      alongTheWayOffer({ ...base, next: task("x", { bucketId: "acme" }), tasks: [invoice] }),
    ).toBeNull();
    expect(alongTheWayOffer({ ...base, next: null, tasks: [invoice] })).toBeNull();
  });

  it("only quick, open, unqueued tasks that are mine or nobody's", () => {
    const quick = { bucketId: "acme", estimateMinutes: 5 };
    const skip = [
      task("long", { bucketId: "acme", estimateMinutes: ALONG_THE_WAY_MAX_MINUTES + 1 }),
      task("none", { bucketId: "acme", estimateMinutes: null }),
      task("theirs", { ...quick, assigneeId: "u-other" }),
      task("queued", quick),
      task("blocked", quick),
      task("waits", quick),
      task("parked", { ...quick, status: "todo", statusCategory: "backlog" }),
      task("done", { ...quick, status: "done" }),
      task("other", { ...quick, bucketId: "home" }),
    ];
    expect(
      alongTheWayOffer({
        ...base,
        tasks: skip,
        lineup: new Set(["queued"]),
        blocked: new Set(["blocked"]),
        waiting: new Set(["waits"]),
      }),
    ).toBeNull();
  });

  it("high priority first, then the soonest due, then the smallest", () => {
    const tasks = [
      task("small", { bucketId: "acme", estimateMinutes: 2 }),
      task("due", { bucketId: "acme", estimateMinutes: 10, dueDate: "2026-10-15" }),
      task("high", { bucketId: "acme", estimateMinutes: 15, priority: "high" }),
    ];
    expect(alongTheWayOffer({ ...base, tasks })?.id).toBe("high");
    expect(alongTheWayOffer({ ...base, tasks: tasks.slice(0, 2) })?.id).toBe("due");
  });
});

describe("In flight (call 5's hand-offs)", () => {
  function wait(taskId: string, over: Partial<TaskWaitingEntry> = {}): TaskWaitingEntry {
    return {
      id: `w-${taskId}`,
      workspaceId: "w1",
      taskId,
      kind: "person",
      ref: "u-sam",
      label: null,
      since: new Date(NOW - 60 * MIN).toISOString(),
      createdBy: ME,
      updatedAt: "",
      ...over,
    };
  }
  function reminder(taskId: string, at: number, over: Partial<TaskReminder> = {}): TaskReminder {
    return {
      id: `r-${taskId}-${at}`,
      workspaceId: "w1",
      taskId,
      userId: ME,
      kind: "at",
      at: new Date(at).toISOString(),
      firedAt: null,
      suspendedAt: null,
      updatedAt: "",
      ...over,
    };
  }
  const base = {
    reminders: [] as TaskReminder[],
    agentSessions: [] as AgentSession[],
    lineup: new Set<string>(),
    me: ME,
    nowMs: NOW,
  };

  it("lists what I handed off and my lined-up tasks that wait; not others' hand-offs", () => {
    const items = inFlightItems({
      ...base,
      tasks: [task("mine"), task("queued"), task("theirs"), task("closed", { status: "done" })],
      waiting: [
        wait("mine"),
        wait("queued", { createdBy: "u-other" }),
        wait("theirs", { createdBy: "u-other" }),
        wait("closed"),
      ],
      lineup: new Set(["queued"]),
    });
    expect(items.map((i) => i.task.id).sort()).toEqual(["mine", "queued"]);
  });

  it("a check-back ahead says when; a passed one with none ahead is due and comes first", () => {
    const items = inFlightItems({
      ...base,
      tasks: [task("later"), task("due"), task("old")],
      waiting: [wait("later"), wait("due"), wait("old")],
      reminders: [
        reminder("later", NOW + 12 * MIN),
        reminder("due", NOW - 2 * MIN, { firedAt: new Date(NOW - 2 * MIN).toISOString() }),
        // A reminder from before the wait began isn't a check-back.
        reminder("old", NOW - 3 * 60 * MIN),
      ],
    });
    expect(items[0]).toMatchObject({ due: true, attention: true });
    expect(items[0].task.id).toBe("due");
    const later = items.find((i) => i.task.id === "later");
    expect(later?.nextCheckBack).toBe(NOW + 12 * MIN);
    expect(later?.due).toBe(false);
    expect(items.find((i) => i.task.id === "old")).toMatchObject({
      due: false,
      nextCheckBack: null,
    });
  });

  it("a later check-back un-brightens a passed one (Check back tomorrow)", () => {
    const [item] = inFlightItems({
      ...base,
      tasks: [task("t")],
      waiting: [wait("t")],
      reminders: [reminder("t", NOW - 5 * MIN), reminder("t", NOW + 20 * 60 * MIN)],
    });
    expect(item.due).toBe(false);
  });

  it("my agent's work is in flight; a teammate's isn't", () => {
    const session = (id: string, userId: string, state: AgentSession["state"]): AgentSession => ({
      id,
      workspaceId: "w1",
      taskId: id,
      userId,
      agent: "Claude",
      state,
      note: null,
      step: null,
      steps: null,
      links: [],
      earlier: [],
      summaryAt: null,
      summaryPostedAt: null,
      startedAt: new Date(NOW - 16 * MIN).toISOString(),
      updatedAt: new Date(NOW - MIN).toISOString(),
      stoppedAt: null,
    });
    const items = inFlightItems({
      ...base,
      tasks: [task("a"), task("b"), task("c")],
      waiting: [],
      agentSessions: [
        session("a", ME, "working"),
        session("b", ME, "ready"),
        session("c", "u-other", "working"),
      ],
    });
    expect(items.map((i) => i.task.id)).toEqual(["b", "a"]);
    expect(items[0].attention).toBe(true);
  });

  it("lined-up tasks that wait leave Up next; the session's own stays Now", () => {
    const a = task("a");
    const b = task("b");
    const { now, upNext } = focusLineup([a, b, task("c")], null, new Set(["a"]));
    expect(now?.id).toBe("b");
    expect(upNext.map((t) => t.id)).toEqual(["c"]);
    expect(focusLineup([a, b], a, new Set(["a"])).now?.id).toBe("a");
  });
});
