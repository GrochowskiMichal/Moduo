// TV-U11 — the Board's columns and lanes (tasks-v3 §5; calls 22, 22a, 53a,
// 53b, 85, 86; default o): a project's own statuses with their category's
// icon, the categories (or shared names) across projects, sections, people,
// teams, priorities, projects and areas; which always show and which hide
// when empty; what folds; what a drop writes; what the "+" adds.

import { describe, expect, it } from "@rstest/core";
import {
  type BoardContext,
  buildBoardColumns,
  buildBoardLanes,
  effectiveBoardGroup,
  effectiveLanes,
  sharedStatusNames,
} from "./board-columns";
import { statusesLetThrough } from "./filters";
import { makeTask } from "./helpers";
import type { ProjectStatus, Task } from "./model";

const inProgress = (value: string) => ({
  dimension: "status",
  operator: "is" as const,
  values: [value],
});

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "p1", title: id, position: id }),
    id,
    assigneeId: null,
    ...fields,
  };
}

function status(
  id: string,
  projectId: string | null,
  category: ProjectStatus["category"],
  name: string,
  position = 0,
  hidden = false,
): ProjectStatus {
  return {
    id,
    workspaceId: "w",
    projectId,
    category,
    name,
    position,
    hidden,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
  };
}

// A dev project: Backlog · Todo · In progress · In review · Done · Canceled.
const DEV: ProjectStatus[] = [
  status("p1-backlog", "p1", "backlog", "Backlog"),
  status("p1-todo", "p1", "todo", "Todo"),
  status("p1-doing", "p1", "in_progress", "In progress", 0),
  status("p1-review", "p1", "in_progress", "In review", 1),
  status("p1-done", "p1", "done", "Done"),
  status("p1-cancel", "p1", "wont_do", "Canceled"),
  status("p1-hidden", "p1", "todo", "Ready", 5, true),
];
const DEFAULTS: ProjectStatus[] = [
  status("d-backlog", null, "backlog", "Backlog"),
  status("d-todo", null, "todo", "To do"),
  status("d-doing", null, "in_progress", "In progress"),
  status("d-done", null, "done", "Done"),
  status("d-wont", null, "wont_do", "Won't do"),
];

function ctx(over: Partial<BoardContext> = {}): BoardContext {
  return {
    scope: "p1",
    groupBy: "status",
    inboxId: "inbox",
    canEdit: true,
    today: "2026-10-13",
    statuses: [...DEV, ...DEFAULTS],
    buckets: [
      { id: "inbox", isSystem: true, areaId: null },
      { id: "p1", isSystem: false, areaId: "a1" },
      { id: "p2", isSystem: false, areaId: null },
    ],
    bucketName: (id) => ({ inbox: "Inbox", p1: "Website", p2: "Studio" })[id] ?? id,
    sections: [
      { id: "s2", projectId: "p1", name: "Week 2", position: 2 },
      { id: "s1", projectId: "p1", name: "Week 1", position: 1 },
      { id: "sx", projectId: "p2", name: "Elsewhere", position: 0 },
    ],
    teams: [
      { id: "t2", name: "Marketing" },
      { id: "t1", name: "Design" },
    ],
    assignees: [
      { userId: "me", name: "You", canTakeTasks: true },
      { userId: "sam", name: "Sam", canTakeTasks: true },
      { userId: "vic", name: "Vic", canTakeTasks: false },
    ],
    areas: [{ id: "a1", name: "Clients", color: "teal", position: 0 }],
    statusFilter: null,
    ...over,
  };
}

const labels = (cols: { label: string }[]) => cols.map((c) => c.label);

describe("one project's board by status (53a)", () => {
  it("shows the project's own statuses in category order, each with its category's icon", () => {
    const cols = buildBoardColumns(
      [task("a", { statusId: "p1-review", status: "in_progress" })],
      ctx(),
    );
    expect(labels(cols)).toEqual(["Backlog", "Todo", "In progress", "In review", "Done"]);
    expect(cols.map((c) => c.mark)).toEqual([
      { kind: "status", category: "backlog" },
      { kind: "status", category: "todo" },
      { kind: "status", category: "in_progress" },
      { kind: "status", category: "in_progress" },
      { kind: "status", category: "done" },
    ]);
    expect(cols.find((c) => c.label === "In review")?.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(cols.every((c) => c.persistent)).toBe(true);
  });

  it("Backlog is always there, folded (53b); Won't do and hidden statuses only while in use", () => {
    let cols = buildBoardColumns([], ctx());
    expect(cols[0]).toMatchObject({ label: "Backlog", startsFolded: true });
    expect(labels(cols)).not.toContain("Canceled");
    expect(labels(cols)).not.toContain("Ready");
    cols = buildBoardColumns(
      [
        task("w", { status: "archived", statusId: "p1-cancel" }),
        task("r", { statusId: "p1-hidden" }),
      ],
      ctx(),
    );
    expect(cols.find((c) => c.label === "Canceled")).toMatchObject({ startsFolded: true });
    expect(labels(cols)).toContain("Ready");
  });

  it("a task whose status isn't read yet goes to its category's first", () => {
    const cols = buildBoardColumns([task("a", { status: "in_progress", statusId: null })], ctx());
    expect(cols.find((c) => c.label === "In progress")?.tasks.map((t) => t.id)).toEqual(["a"]);
  });

  it("a drop writes the status by id; a Status filter shows what it lets through", () => {
    const cols = buildBoardColumns(
      [],
      ctx({ statusFilter: statusesLetThrough([inProgress("in_progress")]) }),
    );
    expect(labels(cols)).toEqual(["In progress", "In review"]);
    expect(cols[1]?.target).toEqual({
      field: "status",
      key: "in_progress",
      statusId: "p1-review",
      name: null,
    });
  });

  it("a Status filter naming one status shows its column alone (MOD-240)", () => {
    const cols = buildBoardColumns(
      [],
      ctx({ statusFilter: statusesLetThrough([inProgress("p1-review")]) }),
    );
    expect(labels(cols)).toEqual(["In review"]);
  });

  it('the "+" adds into the project with the category, and its own status when not the first', () => {
    const cols = buildBoardColumns([], ctx());
    const add = (label: string) => cols.find((c) => c.label === label)?.add;
    expect(add("Todo")).toEqual({
      kind: "add",
      add: { projectId: "p1", seed: { status: "todo" } },
    });
    expect(add("In review")).toEqual({
      kind: "add",
      add: {
        projectId: "p1",
        seed: { status: "in_progress", statusId: "p1-review", statusName: "In review" },
      },
    });
    // A new task is never made finished.
    expect(add("Done")).toEqual({ kind: "none" });
  });

  it("the Inbox uses the workspace default set", () => {
    const cols = buildBoardColumns([task("i", { bucketId: "inbox" })], ctx({ scope: "inbox" }));
    expect(labels(cols)).toEqual(["Backlog", "To do", "In progress", "Done"]);
    expect(cols[1]?.add).toEqual({ kind: "add", add: { seed: { status: "todo" } } });
  });
});

describe('the "+" files into the status it was clicked on', () => {
  const REVIEW_DEFAULT = status("d-review", null, "in_progress", "In review", 1);

  it("the Inbox's board: a default-set status that isn't its category's first", () => {
    const cols = buildBoardColumns(
      [task("i", { bucketId: "inbox" })],
      ctx({ scope: "inbox", statuses: [...DEV, ...DEFAULTS, REVIEW_DEFAULT] }),
    );
    expect(cols.find((c) => c.label === "In review")?.add).toEqual({
      kind: "add",
      add: { seed: { status: "in_progress", statusId: "d-review", statusName: "In review" } },
    });
  });

  it("My tasks' shared names: your Inbox's status of that name", () => {
    const p2 = [...DEFAULTS, REVIEW_DEFAULT].map((s) => ({
      ...s,
      id: `p2-${s.id}`,
      projectId: "p2",
    }));
    const statuses = [...DEFAULTS, REVIEW_DEFAULT, ...p2];
    const cols = buildBoardColumns(
      [task("a", { bucketId: "p2", statusId: "p2-d-review", status: "in_progress" })],
      ctx({ scope: "mine", statuses }),
    );
    expect(cols.find((c) => c.label === "In review")?.add).toEqual({
      kind: "add",
      add: { seed: { status: "in_progress", statusId: "d-review", statusName: "In review" } },
    });
  });
});

describe("boards across projects (53a, research §5)", () => {
  it("group by category: Backlog and Won't do only when present, folded", () => {
    const tasks = [task("a"), task("b", { bucketId: "p2", status: "in_progress" })];
    let cols = buildBoardColumns(tasks, ctx({ scope: "all", statuses: [] }));
    expect(labels(cols)).toEqual(["To do", "In progress", "Done"]);
    expect(cols.map((c) => c.id)).toEqual([
      "col:status:todo",
      "col:status:in_progress",
      "col:status:done",
    ]);
    cols = buildBoardColumns(
      [...tasks, task("x", { status: "todo", statusCategory: "backlog" })],
      ctx({ scope: "all", statuses: [] }),
    );
    expect(cols[0]).toMatchObject({ label: "Backlog", startsFolded: true });
    // All shows no Inbox: its "+" says why there's nowhere to add (U10-6).
    expect(cols[1]?.add).toEqual({ kind: "disabled", reason: "Pick a project first" });
  });

  it("use the shared names when every project in view has the same ones", () => {
    const p2 = DEV.map((s) => ({ ...s, id: s.id.replace("p1", "p2"), projectId: "p2" }));
    const statuses = [...DEV, ...p2, ...DEFAULTS];
    const tasks = [
      task("a", { statusId: "p1-review", status: "in_progress" }),
      task("b", { bucketId: "p2", statusId: "p2-review", status: "in_progress" }),
      task("c", { bucketId: "p2", statusId: "p2-doing", status: "in_progress" }),
    ];
    expect(sharedStatusNames(tasks, ctx({ statuses }))).not.toBeNull();
    const cols = buildBoardColumns(tasks, ctx({ scope: "all", statuses }));
    const review = cols.find((c) => c.label === "In review");
    expect(review?.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(review?.target).toEqual({
      field: "status",
      key: "in_progress",
      statusId: null,
      name: "in review",
    });
    // One project with other names: back to the categories.
    const other = [...DEV, ...DEFAULTS, status("p2-x", "p2", "todo", "Ideas")];
    expect(sharedStatusNames(tasks, ctx({ statuses: other }))).toBeNull();
  });

  it("the five usual names are just the categories", () => {
    const p2 = DEFAULTS.map((s) => ({ ...s, id: `p2-${s.id}`, projectId: "p2" }));
    const p3 = DEFAULTS.map((s) => ({ ...s, id: `p3-${s.id}`, projectId: "p3" }));
    const tasks = [task("a", { bucketId: "p2" }), task("b", { bucketId: "p3" })];
    expect(
      sharedStatusNames(
        tasks,
        ctx({
          statuses: [...p2, ...p3],
          buckets: [
            { id: "p2", isSystem: false, areaId: null },
            { id: "p3", isSystem: false, areaId: null },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe("other groupings (call 22, default o)", () => {
  it("sections: No section first, then the project's sections in order; they always show", () => {
    const cols = buildBoardColumns(
      [task("a", { sectionId: "s2" }), task("b")],
      ctx({ groupBy: "section" }),
    );
    expect(labels(cols)).toEqual(["No section", "Week 1", "Week 2"]);
    expect(cols.every((c) => c.persistent)).toBe(true);
    expect(cols[2]).toMatchObject({ sectionId: "s2", target: { field: "section", value: "s2" } });
    expect(cols[0]?.target).toEqual({ field: "section", value: null });
    expect(cols[1]?.add).toEqual({ kind: "add", add: { projectId: "p1", sectionId: "s1" } });
  });

  it("Section only inside a project; Project and Area only across (else Status)", () => {
    expect(effectiveBoardGroup(ctx({ scope: "all", groupBy: "section" }))).toBe("status");
    expect(effectiveBoardGroup(ctx({ scope: "inbox", groupBy: "section" }))).toBe("status");
    expect(effectiveBoardGroup(ctx({ scope: "p1", groupBy: "bucket" }))).toBe("status");
    expect(effectiveBoardGroup(ctx({ scope: "mine", groupBy: "area" }))).toBe("area");
  });

  it("people: members, a former member, then Unassigned; empty ones hide; viewers take no drops", () => {
    const cols = buildBoardColumns(
      [task("a", { assigneeId: "sam" }), task("b", { assigneeId: "gone" }), task("c")],
      ctx({ groupBy: "assignee" }),
    );
    expect(labels(cols)).toEqual(["You", "Sam", "Vic", "Former member", "Unassigned"]);
    expect(cols.every((c) => !c.persistent)).toBe(true);
    expect(cols.find((c) => c.label === "Vic")?.target).toBeNull();
    expect(cols.find((c) => c.label === "Former member")?.target).toBeNull();
    expect(cols.find((c) => c.label === "Sam")?.target).toEqual({
      field: "assignee",
      value: "sam",
    });
  });

  it("priorities always show, high to unset", () => {
    const cols = buildBoardColumns([task("a", { priority: "low" })], ctx({ groupBy: "priority" }));
    expect(labels(cols)).toEqual(["High priority", "Medium priority", "Low priority", "Unset"]);
    expect(cols.every((c) => c.persistent)).toBe(true);
    expect(cols[3]?.target).toEqual({ field: "priority", value: null });
  });

  it("teams by name, then No team", () => {
    const cols = buildBoardColumns([task("a", { teamId: "t2" })], ctx({ groupBy: "team" }));
    expect(labels(cols)).toEqual(["Design", "Marketing", "No team"]);
  });

  it("projects: the Inbox first, then the rail; areas take no drops", () => {
    const tasks = [task("a"), task("b", { bucketId: "p2" })];
    const projects = buildBoardColumns(tasks, ctx({ scope: "all", groupBy: "bucket" }));
    expect(labels(projects)).toEqual(["Inbox", "Website", "Studio"]);
    expect(projects[1]?.target).toEqual({ field: "project", value: "p1" });
    const areas = buildBoardColumns(tasks, ctx({ scope: "all", groupBy: "area" }));
    expect(labels(areas)).toEqual(["Clients", "No area"]);
    expect(areas.map((c) => c.tasks.map((t) => t.id))).toEqual([["a"], ["b"]]);
    expect(areas.every((c) => c.target === null && c.add.kind === "none")).toBe(true);
  });
});

describe("lanes (call 85)", () => {
  it("only lanes with tasks, in the List's order; each writes its field", () => {
    const tasks = [task("a", { assigneeId: "sam" }), task("b")];
    const lanes = buildBoardLanes(tasks, "assignee", ctx());
    expect(lanes.map((l) => l.label)).toEqual(["Sam", "Unassigned"]);
    expect(lanes[0]?.target).toEqual({ field: "assignee", value: "sam" });
    expect(lanes[1]?.target).toEqual({ field: "assignee", value: null });
    const byPriority = buildBoardLanes([task("c", { priority: "high" })], "priority", ctx());
    expect(byPriority[0]?.target).toEqual({ field: "priority", value: "high" });
  });

  it("Project lanes never move a task to another project; only across projects", () => {
    const lanes = buildBoardLanes([task("a"), task("b", { bucketId: "p2" })], "bucket", ctx());
    expect(lanes.every((l) => l.target === null)).toBe(true);
    expect(effectiveLanes("bucket", "p1")).toBe("none");
    expect(effectiveLanes("bucket", "all")).toBe("bucket");
  });
});
