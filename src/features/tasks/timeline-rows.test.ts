// TV-TL1 · "rows follow scope; points and spans" (specs/tasks-v3.md AC9.1–9.4,
// AC4.3, AC2.3; REPLAN 67, 68, 68a): All lists projects by area and expands
// one into its sections and tasks; inside a project, sections are bands
// (a range) or diamonds (an end date) on their own rows; a task is a point on
// its due day, hollow on its next session, muted when late, hidden when done;
// a project's bar is solid when both dates are set, an outline otherwise.

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import type { Area, Bucket, Section, Task, TaskSession } from "./model";
import {
  buildTimelineRows,
  projectBarOf,
  sectionRowKey,
  type TimelineRow,
  type TimelineRowsInput,
} from "./timeline-rows";
import { dayNumOf } from "./timeline-scale";

const TODAY = dayNumOf(2026, 9, 13);
const NOW = new Date(2026, 9, 13, 10).getTime();
const d = (date: number, month = 9) => dayNumOf(2026, month, date);
const key = (date: number, month = 10) =>
  `2026-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;

function project(id: string, over: Partial<Bucket> = {}): Bucket {
  return {
    id,
    workspaceId: "w1",
    ownerId: "me",
    name: id,
    isSystem: false,
    group: null,
    position: id,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
    ...over,
  };
}

function section(id: string, projectId: string, position: number, over: Partial<Section> = {}) {
  return {
    id,
    workspaceId: "w1",
    projectId,
    name: id,
    position,
    startsOn: null,
    endsOn: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  } satisfies Section;
}

function task(id: string, bucketId: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId, title: id, position: id }),
    id,
    statusCategory: "todo",
    ...over,
  };
}

const AREA: Area = {
  id: "clients",
  workspaceId: "w1",
  name: "Clients",
  color: null,
  position: 0,
  shared: true,
  createdBy: null,
  createdAt: "",
  updatedAt: "",
};

const ACME = project("acme", { areaId: "clients", startsOn: key(1), targetOn: key(7, 11) });
const NORTH = project("north", { areaId: "clients" });
const LOOSE = project("loose");
const INBOX = project("inbox", { isSystem: true });

const SECTIONS = [
  section("design", "acme", 1, { startsOn: key(13), endsOn: key(24) }),
  section("build", "acme", 2, { endsOn: key(7, 11) }),
];

const TASKS: Task[] = [
  // The project's manual order (positions), not the dates, orders rows.
  task("logo", "acme", { sectionId: "design", dueOn: key(14), position: "a1" }),
  task("late", "acme", { sectionId: "design", dueOn: key(9), position: "a2" }),
  task("moodboard", "acme", { sectionId: "design", position: "a3" }),
  task("pdf", "acme", { sectionId: "build", dueOn: key(7, 11) }),
  task("shipped", "acme", {
    sectionId: "build",
    dueOn: key(5, 11),
    statusCategory: "done",
    status: "done",
  }),
  task("north-1", "north", { dueOn: key(20) }),
  task("north-2", "north", { dueOn: key(30) }),
  task("undated", "north"),
];

const SESSIONS: TaskSession[] = [
  {
    id: "s1",
    workspaceId: "w1",
    taskId: "moodboard",
    userId: "me",
    startsAt: new Date(2026, 9, 15, 14).toISOString(),
    endsAt: new Date(2026, 9, 15, 15).toISOString(),
    updatedAt: "",
  },
];

function input(over: Partial<TimelineRowsInput> = {}): TimelineRowsInput {
  return {
    scope: { kind: "workspace" },
    tasks: TASKS,
    projects: [ACME, NORTH, LOOSE],
    areas: [AREA],
    sections: SECTIONS,
    sessions: SESSIONS,
    group: "area",
    subtasks: "hidden",
    showUndated: false,
    showSessions: false,
    isHidden: (t) => t.status === "done",
    expanded: new Set(),
    folded: new Set(),
    today: TODAY,
    now: NOW,
    filtering: false,
    inboxId: "inbox",
    personName: (id) => id,
    ...over,
  };
}

const shape = (rows: TimelineRow[]) =>
  rows.map((r) => {
    if (r.kind === "task") return `task:${r.task.id}`;
    if (r.kind === "project") return `project:${r.project.id}${r.expanded ? "+" : ""}`;
    if (r.kind === "section") return `section:${r.section?.id ?? "none"}`;
    return `${r.kind}:${r.label}`;
  });

const taskRow = (rows: TimelineRow[], id: string) => {
  const row = rows.find((r) => r.kind === "task" && r.task.id === id);
  if (row?.kind !== "task") throw new Error(`no row for ${id}`);
  return row;
};

describe("rows follow the scope (AC9.1)", () => {
  it("All: loose projects first, then each area's projects; no Inbox, no tasks", () => {
    const { rows } = buildTimelineRows(input({ projects: [ACME, NORTH, LOOSE, INBOX] }));
    expect(shape(rows)).toEqual(["project:loose", "area:Clients", "project:acme", "project:north"]);
  });

  it("All: a project expands (▸) into its sections and their tasks", () => {
    const { rows } = buildTimelineRows(input({ expanded: new Set(["acme"]) }));
    expect(shape(rows)).toEqual([
      "project:loose",
      "area:Clients",
      "project:acme+",
      "section:design",
      "task:logo",
      "task:late",
      "task:moodboard",
      "section:build",
      "task:pdf",
      "project:north",
    ]);
    // Children sit a level in.
    expect(rows.find((r) => r.kind === "section")).toMatchObject({ depth: 1 });
    expect(taskRow(rows, "logo").depth).toBe(2);
  });

  it("All with a filter lists only projects with a match", () => {
    const { rows } = buildTimelineRows(
      input({ filtering: true, tasks: TASKS.filter((t) => t.bucketId === "north") }),
    );
    expect(shape(rows)).toEqual(["area:Clients", "project:north"]);
  });

  it("a filter lists only the sections with a match; the project's bar and progress stay whole", () => {
    const { rows } = buildTimelineRows(
      input({
        scope: { kind: "project", projectId: "acme" },
        filtering: true,
        tasks: TASKS.filter((t) => t.id === "pdf"),
        allTasks: TASKS,
      }),
    );
    expect(shape(rows)).toEqual(["project:acme", "section:build", "task:pdf"]);
    expect(rows[0]).toMatchObject({ progress: { done: 1, total: 5 } });
  });

  it("inside a project: the project row, then sections with their tasks", () => {
    const { rows } = buildTimelineRows(input({ scope: { kind: "project", projectId: "acme" } }));
    expect(shape(rows)).toEqual([
      "project:acme",
      "section:design",
      "task:logo",
      "task:late",
      "task:moodboard",
      "section:build",
      "task:pdf",
    ]);
  });

  it("a folded section keeps its row and hides its tasks", () => {
    const { rows } = buildTimelineRows(
      input({
        scope: { kind: "project", projectId: "acme" },
        folded: new Set([sectionRowKey("acme", "design")]),
      }),
    );
    expect(shape(rows)).toEqual(["project:acme", "section:design", "section:build", "task:pdf"]);
  });

  it("everywhere else: tasks by project (the Inbox first), or by assignee", () => {
    const tasks = [task("mine", "inbox", { dueOn: key(16) }), ...TASKS];
    const byProject = buildTimelineRows(
      input({ scope: { kind: "tasks" }, group: "project", tasks }),
    );
    expect(shape(byProject.rows).filter((s) => s.startsWith("group"))).toEqual([
      "group:Inbox",
      "group:acme",
      "group:north",
    ]);
    const byPerson = buildTimelineRows(
      input({
        scope: { kind: "tasks" },
        group: "assignee",
        tasks: [
          task("a", "acme", { assigneeId: "zoe", dueOn: key(20) }),
          task("b", "acme", { assigneeId: null, dueOn: key(18) }),
          task("c", "north", { assigneeId: "ann", dueOn: key(22) }),
        ],
      }),
    );
    expect(shape(byPerson.rows)).toEqual([
      "group:ann",
      "task:c",
      "group:zoe",
      "task:a",
      "group:Unassigned",
      "task:b",
    ]);
  });
});

describe("tasks are points (AC9.2, AC2.3)", () => {
  const { rows } = buildTimelineRows(
    input({ scope: { kind: "project", projectId: "acme" }, isHidden: () => false }),
  );

  it("a due date is a point on its day; a late one is muted, never moved", () => {
    expect(taskRow(rows, "logo").point).toMatchObject({ day: d(14), kind: "due", late: false });
    expect(taskRow(rows, "late").point).toMatchObject({ day: d(9), kind: "due", late: true });
  });

  it("sessions only: a hollow point on the next session", () => {
    expect(taskRow(rows, "moodboard").point).toMatchObject({ day: d(15), kind: "session" });
  });

  it("done is hidden unless Display shows done; then muted (closed), never late", () => {
    expect(taskRow(rows, "shipped").point).toMatchObject({ closed: true, late: false });
    const hidden = buildTimelineRows(input({ scope: { kind: "project", projectId: "acme" } }));
    expect(shape(hidden.rows)).not.toContain("task:shipped");
  });

  it("undated tasks get rows only with Show undated, and are counted for No date", () => {
    const off = buildTimelineRows(input({ scope: { kind: "project", projectId: "north" } }));
    expect(shape(off.rows)).not.toContain("task:undated");
    expect(off.undated).toBe(1);
    const on = buildTimelineRows(
      input({ scope: { kind: "project", projectId: "north" }, showUndated: true }),
    );
    expect(taskRow(on.rows, "undated").point).toBeNull();
  });

  it("subtasks are hidden by default, nested under their parent when shown", () => {
    const tasks = [
      task("parent", "north", { dueOn: key(20) }),
      task("kid", "north", { parentId: "parent", dueOn: key(21) }),
    ];
    const hidden = buildTimelineRows(
      input({ scope: { kind: "project", projectId: "north" }, tasks }),
    );
    expect(shape(hidden.rows)).toEqual(["project:north", "task:parent"]);
    const nested = buildTimelineRows(
      input({ scope: { kind: "project", projectId: "north" }, tasks, subtasks: "nested" }),
    );
    expect(shape(nested.rows)).toEqual(["project:north", "task:parent", "task:kid"]);
    expect(taskRow(nested.rows, "kid").depth).toBe(1);
  });

  it("Show sessions lists a task's other sessions as ticks", () => {
    const sessions: TaskSession[] = [
      ...SESSIONS,
      {
        ...SESSIONS[0]!,
        id: "s2",
        startsAt: new Date(2026, 9, 19, 9).toISOString(),
        endsAt: new Date(2026, 9, 19, 10).toISOString(),
      },
    ];
    const { rows: withTicks } = buildTimelineRows(
      input({ scope: { kind: "project", projectId: "acme" }, sessions, showSessions: true }),
    );
    expect(taskRow(withTicks, "moodboard").sessionDays).toEqual([d(19)]);
  });

  it("collects the open due days (Due per week) and the extent", () => {
    const result = buildTimelineRows(input({ scope: { kind: "project", projectId: "acme" } }));
    expect(result.dueDays.sort()).toEqual([d(9), d(14), d(7, 10)].sort());
    expect(result.extent?.min).toBe(d(1));
    expect(result.hasMarks).toBe(true);
  });
});

describe("sections and projects are spans (AC9.3, AC9.4, 68a)", () => {
  const { rows } = buildTimelineRows(input({ scope: { kind: "project", projectId: "acme" } }));

  it("a range is a band on the section's row and behind its tasks", () => {
    const design = rows.find((r) => r.kind === "section" && r.section?.id === "design");
    expect(design).toMatchObject({ band: { start: d(13), end: d(24) }, milestone: null });
    expect(taskRow(rows, "logo").band).toEqual({ start: d(13), end: d(24) });
  });

  it("an end date only is a diamond on the section's own row", () => {
    const build = rows.find((r) => r.kind === "section" && r.section?.id === "build");
    expect(build).toMatchObject({ band: null, milestone: d(7, 10), done: 1, total: 2 });
  });

  it("a project with both dates has a solid bar with its sections on it", () => {
    const acme = rows[0];
    expect(acme).toMatchObject({
      kind: "project",
      bar: { start: d(1), end: d(7, 10), solid: true },
      progress: { done: 1, total: 5 },
    });
    if (acme?.kind !== "project" || !acme.bar) throw new Error("no bar");
    expect(acme.bar.segments.map((s) => s.sectionId)).toEqual(["design"]);
    expect(acme.bar.milestones.map((m) => m.sectionId)).toEqual(["build"]);
  });

  it("a project without dates has an outline over its dated work, or no bar", () => {
    expect(projectBarOf({}, [], [d(20), d(30)])).toMatchObject({
      start: d(20),
      end: d(30),
      solid: false,
    });
    expect(projectBarOf({ targetOn: key(5, 11) }, [], [d(20)])).toMatchObject({
      start: d(20),
      end: d(5, 10),
      solid: false,
    });
    expect(projectBarOf({}, [], [])).toBeNull();
  });
});
