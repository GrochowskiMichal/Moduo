// TV-D9 · "backlog is out of counts and views" (specs/tasks-v3.md AC map:
// AC4.2, AC11.6). A backlog task, exactly as the server sends it (legacy
// status "todo", category "backlog"), sits out of the sidebar counts, My
// tasks, Upcoming (the Calendar's Due soon and strip), drift and Focus
// suggestions, while it stays a task you can find, group, filter and queue.
// Plus the row mapping the client reads statuses and dates through.

import { describe, expect, it } from "@rstest/core";

import {
  dueOnToLocalInstant,
  isMissingTvD9FieldError,
  localDayOf,
  taskCreateOpInput,
  taskPatchToColumns,
  taskPatchToOpFields,
  taskRowToModel,
  withoutTvD9Fields,
} from "../../lib/task-rows";
import { groupPanelTasks } from "../calendar/panel";
import { stripItems } from "../calendar/strip";
import { completedWithin } from "./completed";
import { myTasksScope, openCount } from "./default-view";
import { groupFieldPatch } from "./dnd/drop-mode";
import { undoWrite } from "./dnd/drop-write";
import { statusesLetThrough, type TaskFilterContext, taskFilterValues } from "./filters";
import { blockedTaskIds, groupTasks, isUnfinished, makeTask } from "./helpers";
import { isDrifted, type ProjectStatus, type Task } from "./model";
import { openQueueCount, queueOrOpen } from "./queue";
import {
  firstStatusOf,
  optimisticStatus,
  replaceStatusSet,
  STATUS_KEY_LABELS,
  statusKeyOf,
  statusNameOf,
  statusSetFor,
} from "./statuses";

const ME = "u1";
const NOW = new Date("2026-11-10T12:00:00Z");

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
    id,
    creatorId: ME,
    assigneeId: ME,
    statusCategory: "todo",
    ...over,
  };
}

/** The server's shape for a backlog task: the legacy column reads "todo". */
const backlog = (id: string, over: Partial<Task> = {}) =>
  task(id, { status: "todo", statusCategory: "backlog", ...over });

const status = (
  id: string,
  category: ProjectStatus["category"],
  name: string,
  over: Partial<ProjectStatus> = {},
): ProjectStatus => ({
  id,
  workspaceId: "w1",
  projectId: "p1",
  category,
  name,
  position: 1,
  hidden: false,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  ...over,
});

describe("backlog is out of counts and views (AC4.2, AC11.6)", () => {
  const open = task("open");
  const parked = backlog("parked");

  it("sits out of the sidebar counts", () => {
    expect(openCount([open, parked])).toBe(1);
  });

  it("sits out of My tasks", () => {
    expect(myTasksScope([open, parked], ME).map((t) => t.id)).toEqual(["open"]);
  });

  it("never drifts and never counts in the Queue", () => {
    const past = "2026-11-01T09:00:00Z";
    expect(isDrifted({ ...open, scheduledAt: past }, NOW)).toBe(true);
    expect(isDrifted({ ...parked, scheduledAt: past }, NOW)).toBe(false);
    expect(openQueueCount([open, parked])).toBe(1);
  });

  it("sits out of Focus suggestions (the Open list when the queue is empty)", () => {
    const { rows, heading } = queueOrOpen([open, parked], [], ME);
    expect(heading).toBe("Open");
    expect(rows.map((t) => t.id)).toEqual(["open"]);
  });

  it("sits out of Upcoming: the Calendar's Due soon and its strip", () => {
    const due = "2026-11-11T00:00:00";
    const dueOpen = task("dueOpen", { dueDate: new Date(due).toISOString() });
    const dueParked = backlog("dueParked", { dueDate: new Date(due).toISOString() });
    const groups = groupPanelTasks({ tasks: [dueOpen, dueParked], queuedTasks: [], now: NOW });
    expect(groups.dueSoon.map((t) => t.id)).toEqual(["dueOpen"]);
    // …while the panel's Backlog group (unplanned work) lists it.
    expect(groups.backlog.map((t) => t.id)).toEqual(["dueParked"]);
    const ended = "2026-11-10T08:00:00Z";
    const items = stripItems(
      [
        { ...open, scheduledAt: ended, durationMinutes: 30 },
        { ...parked, scheduledAt: ended, durationMinutes: 30 },
      ],
      NOW.getTime(),
    );
    expect(items.map((i) => i.taskId)).toEqual(["open"]);
  });

  it("still blocks, still counts as unfinished work", () => {
    expect(isUnfinished(parked)).toBe(true);
    expect(isUnfinished(task("x", { status: "done", statusCategory: "done" }))).toBe(false);
    const waiting = task("waiting");
    const blocked = blockedTaskIds(
      [parked, waiting],
      [
        {
          id: "r1",
          workspaceId: "w1",
          blockerTaskId: "parked",
          blockedTaskId: "waiting",
          createdAt: "",
        },
      ],
    );
    expect(blocked.has("waiting")).toBe(true);
  });

  it("is its own group, last, in a list grouped by status, and its own filter value", () => {
    const groups = groupTasks(
      [parked, open, task("doing", { status: "in_progress", statusCategory: "in_progress" })],
      "status",
      {
        bucketName: () => "",
        now: NOW,
      },
    );
    expect(groups.map((g) => g.label)).toEqual(["In progress", "To do", "Backlog"]);
    const ctx = {} as TaskFilterContext;
    expect(taskFilterValues(parked, "status", ctx)).toEqual(["backlog"]);
    expect(taskFilterValues(open, "status", ctx)).toEqual(["todo"]);
    expect(
      statusesLetThrough([
        { dimension: "status", operator: "any_of", values: ["backlog", "todo"] },
      ]),
    ).toEqual(new Set(["backlog", "todo"]));
  });

  it("a drop out of Backlog and its Undo go back to Backlog, not To do", () => {
    expect(groupFieldPatch("status", "backlog")).toEqual({ status: "backlog" });
    const before = parked;
    const after = {
      ...parked,
      status: "in_progress" as const,
      statusCategory: "in_progress" as const,
    };
    const { write } = undoWrite({
      write: { taskId: parked.id, status: "in_progress" },
      before,
      after,
      current: after,
    });
    expect(write).toEqual({ taskId: parked.id, status: "backlog" });
    expect(STATUS_KEY_LABELS[statusKeyOf(before)]).toBe("Backlog");
  });
});

describe("statuses on the client (mirrors of the server's rules)", () => {
  const set = [
    status("s-todo", "todo", "Todo"),
    status("s-review", "in_progress", "In review", { position: 2 }),
    status("s-doing", "in_progress", "In progress", { position: 1, hidden: true }),
    status("s-done", "done", "Done"),
  ];

  it("the first status of a category is the first visible one", () => {
    expect(firstStatusOf(set, "in_progress")?.id).toBe("s-review");
    expect(firstStatusOf(set, "wont_do")).toBeNull();
  });

  it("a category keeps a status already in it; an id is taken as it is", () => {
    const reviewing = task("r", {
      status: "in_progress",
      statusCategory: "in_progress",
      statusId: "s-review",
    });
    expect(optimisticStatus(reviewing, { category: "in_progress" }, set).statusId).toBe("s-review");
    expect(optimisticStatus(task("t", { statusId: "s-todo" }), { category: "done" }, set)).toEqual({
      statusId: "s-done",
      statusCategory: "done",
      status: "done",
    });
    expect(optimisticStatus(task("t"), { category: "backlog" }, set)).toMatchObject({
      statusCategory: "backlog",
      status: "todo",
    });
  });

  it("the Inbox uses the workspace default set; a project you can't see has none", () => {
    const def = status("d-todo", "todo", "To do", { projectId: null });
    const all = [...set, def];
    expect(statusSetFor(all, { id: "inbox", isSystem: true }).map((s) => s.id)).toEqual(["d-todo"]);
    expect(statusSetFor(all, { id: "p1", isSystem: false })).toHaveLength(4);
    expect(statusSetFor(all, undefined)).toEqual([]);
    expect(replaceStatusSet(all, null, []).some((s) => s.projectId === null)).toBe(false);
  });

  it("a task reads its project's status name, else its category's", () => {
    const byId = new Map(set.map((s) => [s.id, s]));
    expect(
      statusNameOf(task("r", { statusId: "s-review", statusCategory: "in_progress" }), byId),
    ).toBe("In review");
    expect(statusNameOf(backlog("b", { statusId: "unknown" }), byId)).toBe("Backlog");
  });
});

describe("rows: statuses, completion and the due date (TV-D9)", () => {
  const row = {
    id: "t1",
    workspace_id: "w1",
    bucket_id: "p1",
    status: "todo",
    status_id: "s1",
    status_category: "backlog",
    completed_at: null,
    completed_by: null,
    due_on: "2026-11-08",
    due_time: "15:00:00",
    due_date: "2026-11-08T12:00:00Z",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };

  it("reads the category, and the due date as this device's midnight of that day", () => {
    const t = taskRowToModel(row);
    expect(t.statusCategory).toBe("backlog");
    expect(t.status).toBe("todo");
    expect(t.dueOn).toBe("2026-11-08");
    expect(t.dueTime).toBe("15:00:00");
    expect(localDayOf(t.dueDate)).toBe("2026-11-08");
    expect(t.dueDate).toBe(dueOnToLocalInstant("2026-11-08"));
  });

  it("reads a row from before TV-D9 from its legacy columns", () => {
    const { status_id, status_category, due_on, due_time, ...old } = row;
    const t = taskRowToModel({ ...old, status: "archived", due_date: "2026-11-08T03:00:00Z" });
    expect(t.statusCategory).toBeNull();
    expect(t.dueDate).toBe("2026-11-08T03:00:00Z");
    expect(t.dueOn).toBe(localDayOf("2026-11-08T03:00:00Z"));
  });

  it("writes the due date as a date and a status by id or category", () => {
    const day = dueOnToLocalInstant("2026-11-20");
    expect(taskPatchToOpFields({ dueDate: day })).toEqual({ due_on: "2026-11-20" });
    expect(taskPatchToOpFields({ dueDate: null })).toEqual({ due_on: null });
    expect(taskPatchToOpFields({ status: "todo", statusCategory: "backlog" })).toEqual({
      status: "backlog",
    });
    expect(
      taskPatchToOpFields({ status: "in_progress", statusCategory: "in_progress", statusId: "s2" }),
    ).toEqual({ status_id: "s2" });
    expect(taskCreateOpInput(backlog("n", { dueDate: day })).status).toBe("backlog");
    expect(taskCreateOpInput(backlog("n", { dueDate: day })).due_on).toBe("2026-11-20");
  });

  it("falls back to the old fields on a database before TV-D9", () => {
    expect(isMissingTvD9FieldError({ message: 'Tasks have no field "due_on".' })).toBe(true);
    expect(isMissingTvD9FieldError({ message: "Task not found in this workspace." })).toBe(false);
    expect(withoutTvD9Fields({ due_on: "2026-11-20", status: "backlog", status_id: "x" })).toEqual({
      due_date: dueOnToLocalInstant("2026-11-20"),
      status: "todo",
    });
    expect(taskPatchToColumns({ statusCategory: "wont_do", statusId: "x" }, "now")).toEqual({
      status: "archived",
      updated_at: "now",
    });
  });

  it("'7 days' counts from when it was finished, once that's stored", () => {
    const done = task("d", {
      status: "done",
      statusCategory: "done",
      updatedAt: "2026-11-10T00:00:00Z",
      completedAt: "2026-10-01T00:00:00Z",
    });
    expect(completedWithin(done, NOW, 7)).toBe(false);
    expect(completedWithin({ ...done, completedAt: null }, NOW, 7)).toBe(true);
  });
});
