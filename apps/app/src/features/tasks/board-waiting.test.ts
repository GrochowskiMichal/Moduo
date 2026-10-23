// TV-U12 (deferred here by TV-U11) · the Board grouped by Waiting on (tasks-v3
// §5): a column per someone or something, a task under its newest wait, "Not
// waiting" last; a drop into a column adds that wait (no field changes).

import { describe, expect, it } from "@rstest/core";

import { type BoardContext, buildBoardColumns } from "./board-columns";
import { planBoardDrop } from "./dnd/board-drop";
import { makeTask } from "./helpers";
import type { Task } from "./model";

function task(id: string): Task {
  return { ...makeTask({ workspaceId: "w", bucketId: "p1", title: id, position: id }), id };
}

const wait = (
  taskId: string,
  over: { kind?: "person" | "text"; ref?: string; label?: string; since: string },
) => ({
  taskId,
  kind: over.kind ?? "person",
  ref: over.ref ?? null,
  label: over.label ?? null,
  since: over.since,
});

function ctx(waiting: BoardContext["waiting"]): BoardContext {
  return {
    scope: "p1",
    groupBy: "waiting",
    inboxId: "inbox",
    canEdit: true,
    today: "2026-10-13",
    statuses: [],
    buckets: [{ id: "p1", isSystem: false, areaId: null }],
    bucketName: (id) => id,
    assignees: [{ userId: "anna", name: "Anna", canTakeTasks: true }],
    waiting,
  };
}

describe("Board grouped by Waiting on", () => {
  it("puts each task under its newest wait, then Not waiting", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const columns = buildBoardColumns(
      tasks,
      ctx([
        wait("a", { ref: "anna", since: "2026-10-10" }),
        wait("b", { kind: "text", label: "Legal", since: "2026-10-09" }),
        wait("b", { ref: "anna", since: "2026-10-11" }),
      ]),
    );
    expect(columns.map((c) => [c.label, c.tasks.map((t) => t.id)])).toEqual([
      ["Anna", ["a", "b"]],
      ["Not waiting", ["c"]],
    ]);
    expect(columns[1]?.target).toBeNull();
  });

  it("a drop into a column adds that wait, with no field write", () => {
    const tasks = [task("a"), task("b")];
    const columns = buildBoardColumns(
      tasks,
      ctx([wait("a", { ref: "anna", since: "2026-10-10" })]),
    );
    const [anna, none] = columns;
    if (!anna || !none) throw new Error("columns");
    const ref = (c: typeof anna) => ({
      id: c.id,
      column: { id: c.id, label: c.label, target: c.target },
      lane: null,
      all: c.tasks,
    });
    const decision = planBoardDrop({
      task: tasks[1] as Task,
      source: ref(none),
      dest: ref(anna),
      overId: null,
      order: "none",
      ctx: { inboxId: "inbox", statusesFor: () => [], parent: null },
    });
    expect(decision).toEqual({
      kind: "waiting",
      entry: { kind: "person", ref: "anna", label: null },
      label: "Waiting on Anna",
    });
  });
});
