// TV-H1 · Home's Tasks widgets (specs/tasks-v3.md §18, AC4.5; decision 12;
// Chat's CH70): the Tasks widget's Focus/Open rows, call 87's subtask rule
// shared with the module, the time widget's week, the Team widget's load
// rows (ownership, never time or runs per person) and the Upcoming widget's
// days.

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import {
  fitUpcoming,
  focusOrOpen,
  loadLine,
  subtasksToFinish,
  type TeamPerson,
  teamLoad,
  upcomingForHome,
  weekTime,
} from "./home";
import type { Task, TaskQueueEntry, TimeReportRow } from "./model";

const ME = "u-me";
const MIKE = "u-mike";
const OLA = "u-ola";
// Wednesday, Oct 14 2026, 10:00 local.
const NOW = new Date(2026, 9, 14, 10, 0, 0);
const at = (day: number) => new Date(2026, 9, day).toISOString();

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    creatorId: ME,
    statusCategory: "todo",
    ...over,
  };
}

function entry(userId: string, taskId: string, position: string): TaskQueueEntry {
  return {
    id: `${userId}:${taskId}`,
    workspaceId: "w1",
    userId,
    taskId,
    position,
    queuedAt: "2026-10-14T08:00:00Z",
    updatedAt: "2026-10-14T08:00:00Z",
  };
}

describe("the Tasks widget: Focus, else Open", () => {
  const tasks = [
    task("t1", { position: "0000000003" }),
    task("t2", { position: "0000000001" }),
    task("t3", { position: "0000000002", status: "done", statusCategory: "done" }),
    task("t4", { position: "0000000004", bucketId: "b2" }),
    task("parked", { position: "0000000005", statusCategory: "backlog" }),
  ];

  it("is my line-up's open tasks in order, headed Focus, not someone else's", () => {
    const queue = [
      entry(ME, "t1", "2"),
      entry(ME, "t3", "1"),
      entry(ME, "t2", "3"),
      entry(MIKE, "t4", "1"),
    ];
    const out = focusOrOpen({ tasks, queue, userId: ME });
    expect(out.heading).toBe("Focus");
    expect(out.rows.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(out.nowId).toBe("t1");
  });

  it("puts the task a session is on first, as Focus's Now does", () => {
    const queue = [entry(ME, "t1", "1"), entry(ME, "t2", "2")];
    const out = focusOrOpen({ tasks, queue, userId: ME, sessionTaskId: "t2" });
    expect(out.rows.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(out.nowId).toBe("t2");
  });

  it("falls back to the open tasks in list order, headed Open, without Backlog", () => {
    const out = focusOrOpen({ tasks, queue: [entry(MIKE, "t1", "1")], userId: ME });
    expect(out.heading).toBe("Open");
    expect(out.rows.map((t) => t.id)).toEqual(["t2", "t1", "t4"]);
  });

  it("leaves another team's unclaimed work out of Open (Upcoming's rule)", () => {
    const theirs = task("theirs", { assigneeId: null, teamId: "dev", position: "0000000000" });
    const ours = task("ours", { assigneeId: null, teamId: "design", position: "0000000006" });
    const out = focusOrOpen({
      tasks: [...tasks, theirs, ours],
      queue: [],
      userId: ME,
      myTeams: new Set(["design"]),
    });
    expect(out.rows.map((t) => t.id)).toEqual(["t2", "t1", "t4", "ours"]);
  });

  it("keeps to the widget's projects", () => {
    const queue = [entry(ME, "t4", "1")];
    expect(focusOrOpen({ tasks, queue, userId: ME, projectIds: ["b1"] }).heading).toBe("Open");
    expect(
      focusOrOpen({ tasks, queue, userId: ME, projectIds: ["b2"] }).rows.map((t) => t.id),
    ).toEqual(["t4"]);
  });
});

describe("call 87: the subtasks a finishing parent takes along", () => {
  const parent = task("p");
  const open = task("s1", { parentId: "p" });
  const parked = task("s2", { parentId: "p", statusCategory: "backlog" });
  const done = task("s3", { parentId: "p", status: "done", statusCategory: "done" });
  const wont = task("s4", { parentId: "p", status: "archived", statusCategory: "wont_do" });
  const saving = task("tmp-s5", { parentId: "p" });
  const gone = task("s6", { parentId: "p", deletedAt: "2026-10-13T00:00:00Z" });
  const all = [parent, open, parked, done, wont, saving, gone];

  it("finishes the open ones, Backlog included, never closed, unsaved or deleted ones", () => {
    expect(subtasksToFinish(parent, all).map((t) => t.id)).toEqual(["s1", "s2"]);
  });

  it("takes nothing for a subtask, a repeating parent or a parent already finished", () => {
    expect(subtasksToFinish(open, all)).toEqual([]);
    expect(
      subtasksToFinish(
        { ...parent, recurrence: { rrule: "FREQ=DAILY", dtstart: null, nextOccurrence: null } },
        all,
      ),
    ).toEqual([]);
    expect(subtasksToFinish({ ...parent, status: "done", statusCategory: "done" }, all)).toEqual(
      [],
    );
  });
});

function row(over: Partial<TimeReportRow>): TimeReportRow {
  return {
    entryId: Math.random().toString(36),
    taskId: "t1",
    taskTitle: "Homepage",
    projectId: "b1",
    projectName: "Acme",
    projectIsInbox: false,
    userId: ME,
    isMine: true,
    day: "2026-10-14",
    seconds: 600,
    kind: "manual",
    reason: null,
    note: null,
    ...over,
  };
}

describe("the time widget: your tracked task time this week", () => {
  it("sums your own entries per task, most first, with today's share", () => {
    const week = weekTime(
      [
        row({ taskId: "t1", seconds: 1800, day: "2026-10-12" }),
        row({ taskId: "t1", seconds: 600 }),
        row({ taskId: "t2", taskTitle: "Logo", seconds: 3600, day: "2026-10-13" }),
      ],
      "2026-10-14",
    );
    expect(week.weekSeconds).toBe(6000);
    expect(week.todaySeconds).toBe(600);
    expect(week.lines.map((l) => [l.taskId, l.seconds])).toEqual([
      ["t2", 3600],
      ["t1", 2400],
    ]);
  });

  it("never shows a teammate's time, even to the owner who gets it in the report", () => {
    const week = weekTime(
      [row({ seconds: 600 }), row({ userId: MIKE, isMine: false, seconds: 7200 })],
      "2026-10-14",
    );
    expect(week.weekSeconds).toBe(600);
  });

  it("nets a give-back out and never goes below zero", () => {
    const week = weekTime(
      [
        row({ taskId: "t1", seconds: 600 }),
        row({ taskId: "t1", seconds: -900, kind: "adjustment", reason: "give_back" }),
        row({ taskId: "t2", seconds: 300, day: "2026-10-12" }),
      ],
      "2026-10-14",
    );
    expect(week.lines.map((l) => l.taskId)).toEqual(["t2"]);
    expect(week.weekSeconds).toBe(300);
    expect(week.todaySeconds).toBe(0);
  });

  it("names the Inbox, and a project you can't see has no name", () => {
    const week = weekTime(
      [
        row({ taskId: "a", projectIsInbox: true, projectName: null }),
        row({ taskId: "b", projectName: null }),
      ],
      "2026-10-14",
    );
    expect(week.lines.map((l) => l.project).sort()).toEqual(["Inbox", null].sort());
  });
});

const people: TeamPerson[] = [
  { userId: OLA, name: "Ola", avatarUrl: null, canTakeTasks: true },
  { userId: ME, name: "Maciej", avatarUrl: null, canTakeTasks: true },
  { userId: MIKE, name: "Mike", avatarUrl: null, canTakeTasks: true },
  { userId: "u-viewer", name: "Vic", avatarUrl: null, canTakeTasks: false },
];

describe("the Team widget's load (AC4.5, decision 12)", () => {
  const tasks = [
    task("q1", { assigneeId: MIKE, estimateMinutes: 60 }),
    task("q2", {
      assigneeId: MIKE,
      estimateMinutes: 30,
      statusCategory: "in_progress",
      status: "in_progress",
    }),
    task("w1", { assigneeId: MIKE }),
    task("due-thu", { assigneeId: MIKE, dueOn: "2026-10-15" }),
    task("late", { assigneeId: MIKE, dueOn: "2026-10-01" }),
    task("next-week", { assigneeId: MIKE, dueOn: "2026-10-20" }),
    task("parked", { assigneeId: MIKE, statusCategory: "backlog", dueOn: "2026-10-15" }),
    task("done", { assigneeId: MIKE, status: "done", statusCategory: "done", dueOn: "2026-10-15" }),
    task("mine", { assigneeId: ME, estimateMinutes: 45 }),
    task("unclaimed", { assigneeId: null, teamId: "design" }),
    task("claimed", { assigneeId: OLA, teamId: "design" }),
  ];
  const queue = [
    entry(MIKE, "q1", "1"),
    entry(MIKE, "q2", "2"),
    entry(MIKE, "done", "3"),
    // A lined-up task this reader can't see isn't in their copy: it counts for nothing.
    entry(MIKE, "hidden", "4"),
    entry(ME, "mine", "1"),
  ];
  const base = {
    tasks,
    queue,
    waitingTaskIds: new Set(["w1", "parked"]),
    people,
    teamMembers: [{ teamId: "design", userId: OLA }],
    teamIds: ["design", "dev"],
    me: ME,
    weekEnd: "2026-10-18",
  };

  it("lists one row per person who can take tasks, me first, then by name", () => {
    const { rows } = teamLoad(base);
    expect(rows.map((r) => r.userId)).toEqual([ME, MIKE, OLA]);
    expect(rows[0]?.isMe).toBe(true);
  });

  it("counts Focus and its estimates, in progress, waiting and due this week, open work only", () => {
    const mike = teamLoad(base).rows.find((r) => r.userId === MIKE);
    expect(mike).toMatchObject({
      focus: 2,
      focusMinutes: 90,
      inProgress: 1,
      waiting: 1,
      dueThisWeek: 2,
    });
  });

  it("says nothing about runs or tracked time per person", () => {
    const mike = teamLoad(base).rows.find((r) => r.userId === MIKE) ?? {};
    expect(Object.keys(mike).sort()).toEqual(
      [
        "avatarUrl",
        "dueThisWeek",
        "focus",
        "focusMinutes",
        "inProgress",
        "isMe",
        "name",
        "userId",
        "waiting",
      ].sort(),
    );
  });

  it("lists someone who can only view when they still have load", () => {
    const withViewerLoad = teamLoad({
      ...base,
      tasks: [...tasks, task("v", { assigneeId: "u-viewer", dueOn: "2026-10-15" })],
    });
    expect(withViewerLoad.rows.map((r) => r.userId)).toContain("u-viewer");
    expect(teamLoad(base).rows.map((r) => r.userId)).not.toContain("u-viewer");
  });

  it("narrows to one team, with its unclaimed work; an unknown team is everyone", () => {
    const design = teamLoad({ ...base, teamId: "design" });
    expect(design.rows.map((r) => r.userId)).toEqual([OLA]);
    expect(design.unclaimed).toEqual([{ teamId: "design", count: 1 }]);
    expect(teamLoad({ ...base, teamId: "gone" }).rows).toHaveLength(3);
    expect(teamLoad(base).unclaimed).toEqual([{ teamId: "design", count: 1 }]);
  });

  it("reads as one quiet line, zeros left out", () => {
    const fmt = (m: number) => `${m}m`;
    const mike = teamLoad(base).rows.find((r) => r.userId === MIKE);
    const ola = teamLoad(base).rows.find((r) => r.userId === OLA);
    expect(mike && loadLine(mike, fmt)).toBe(
      "Focus 2 · ~90m · 1 in progress · 1 waiting · 2 due this week",
    );
    expect(ola && loadLine(ola, fmt)).toBe("Nothing lined up");
  });
});

describe("the Upcoming widget", () => {
  it("is Upcoming's days with work in them, open tasks only", () => {
    const tasks = [
      task("late", { assigneeId: ME, dueDate: at(10) }),
      task("thu", { assigneeId: ME, dueDate: at(15) }),
      task("doneThu", { assigneeId: ME, dueDate: at(15), status: "done", statusCategory: "done" }),
      task("mike", { assigneeId: MIKE, dueDate: at(15) }),
    ];
    const groups = upcomingForHome(tasks, { me: ME, myTeams: new Set() }, NOW, () => 0);
    expect(groups.map((g) => [g.key, g.tasks.map((t) => t.id)])).toEqual([
      ["earlier", ["late"]],
      ["tomorrow", ["thu"]],
    ]);
  });
});

describe("filling the Upcoming widget (fitUpcoming)", () => {
  const groups = [
    { key: "tomorrow", label: "Tomorrow", tasks: [task("a")] },
    { key: "thu", label: "Thu", tasks: [task("b")] },
    { key: "later", label: "Later", tasks: [task("c"), task("d")] },
  ];

  it("shows every day when the cell holds them (no '+n more' over empty space)", () => {
    // 3 headers + 4 tasks = 7 lines; the cell's 10 hold them all.
    const fitted = fitUpcoming(groups, 10);
    expect(fitted.hidden).toBe(0);
    expect(fitted.shown.map((g) => [g.key, g.rows.map((t) => t.id)])).toEqual([
      ["tomorrow", ["a"]],
      ["thu", ["b"]],
      ["later", ["c", "d"]],
    ]);
  });

  it("cuts a day short, and starts a day only with its header and one task", () => {
    const fitted = fitUpcoming(groups, 5);
    // Tomorrow (2 lines) + Thu (2 lines); 1 line left can't start Later.
    expect(fitted.shown.map((g) => g.key)).toEqual(["tomorrow", "thu"]);
    expect(fitted.hidden).toBe(2);
    const partly = fitUpcoming(groups, 6);
    expect(partly.shown.at(-1)).toMatchObject({ key: "later", count: 2 });
    expect(partly.shown.at(-1)?.rows.map((t) => t.id)).toEqual(["c"]);
    expect(partly.hidden).toBe(1);
  });

  it("was the old three-row budget's '+2 more' (one task shown)", () => {
    const fitted = fitUpcoming(groups, 3);
    expect(fitted.shown.flatMap((g) => g.rows).map((t) => t.id)).toEqual(["a"]);
    expect(fitted.hidden).toBe(3);
  });
});
