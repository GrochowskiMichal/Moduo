// TV-U4 — the List's drop planner: reorder vs nest from the pointer, the
// order rule (manual inside one project, sorted asks, none across projects),
// cross-group drops that rewrite the group's field, and the validator's #329
// findings (the MAJOR's lost position, the nest across projects).

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "../helpers";
import type { Task } from "../model";
import type { DragOrder } from "../order";
import {
  canMoveInto,
  groupAccepts,
  groupFieldPatch,
  type ListPointerTarget,
  NEST_INDENT_PX,
  planListDrop,
  positionNextTo,
  resolveListHover,
} from "./drop-mode";

function task(id: string, position: string, fields: Partial<Task> = {}): Task {
  return { ...makeTask({ workspaceId: "w", bucketId: "b1", title: id, position }), id, ...fields };
}

// a, b, c top level in bucket b1; s1 a subtask of c.
const A = task("a", "0000000010");
const B = task("b", "0000000020");
const C = task("c", "0000000030");
const S1 = task("s1", "0000000040", { parentId: "c" });
const ALL = [A, B, C, S1];
const noChildren = (id: string) => id === "c";

const ROW = { left: 100, top: 200, height: 32 };
const rowOver = (t: Task, extra: Partial<Extract<ListPointerTarget, { type: "row" }>> = {}) =>
  ({
    type: "row",
    task: t,
    depth: 0,
    groupKey: "all",
    rect: ROW,
    lastChildId: null,
    ...extra,
  }) as const;

const LEFT = ROW.left + NEST_INDENT_PX - 1; // just left of the indent edge
const RIGHT = ROW.left + NEST_INDENT_PX + 1; // just right of it
const UPPER = ROW.top + 4;
const LOWER = ROW.top + ROW.height - 4;

function hover(
  active: Task,
  over: ListPointerTarget | null,
  pointer: { x: number; y: number },
  opts: {
    order?: DragOrder;
    activeNested?: boolean;
    activeGroupKey?: string;
    accepts?: (key: string) => boolean;
    canNestInto?: (parent: Pick<Task, "bucketId">) => boolean;
  } = {},
) {
  return resolveListHover({
    active,
    activeNested: opts.activeNested ?? false,
    activeGroupKey: opts.activeGroupKey ?? "all",
    hasChildren: noChildren,
    pointer,
    over,
    order: opts.order ?? "manual",
    accepts: opts.accepts ?? (() => true),
    canNestInto: opts.canNestInto ?? (() => true),
  });
}

describe("resolveListHover — reorder vs nest (manual order)", () => {
  it("left of the indent reorders, with the line on the hovered row's edge", () => {
    expect(hover(A, rowOver(B), { x: LEFT, y: UPPER })).toMatchObject({
      kind: "reorder",
      ref: { id: "b", edge: "before" },
      line: { id: "b", edge: "top" },
      depth: 0,
    });
    expect(hover(A, rowOver(B), { x: LEFT, y: LOWER })).toMatchObject({
      kind: "reorder",
      ref: { id: "b", edge: "after" },
      line: { id: "b", edge: "bottom" },
    });
  });

  it("right of the indent makes a subtask", () => {
    expect(hover(A, rowOver(B), { x: RIGHT, y: UPPER })).toEqual({ kind: "nest", targetId: "b" });
  });

  it("the indent edge is the row's own left + the indent, wherever the row sits", () => {
    const shifted = rowOver(B, { rect: { ...ROW, left: 300 } });
    expect(hover(A, shifted, { x: 300 + NEST_INDENT_PX - 1, y: UPPER })?.kind).toBe("reorder");
    expect(hover(A, shifted, { x: 300 + NEST_INDENT_PX, y: UPPER })?.kind).toBe("nest");
  });

  it("falls back to reorder where the one-level rule forbids nesting", () => {
    // c has subtasks, so it can't become one: dragged by its middle, it reorders
    expect(hover(C, rowOver(A), { x: RIGHT, y: UPPER })?.kind).toBe("reorder");
    // a subtask listed top level (its parent is elsewhere) can't take children
    const orphan = task("o", "0000000050", { parentId: "elsewhere" });
    expect(hover(A, rowOver(orphan), { x: RIGHT, y: UPPER })?.kind).toBe("reorder");
  });

  it("falls back to reorder where the parent's project won't take it", () => {
    expect(hover(A, rowOver(B), { x: RIGHT, y: UPPER }, { canNestInto: () => false })?.kind).toBe(
      "reorder",
    );
  });

  it("a row over itself, or nothing under the pointer, is no drop", () => {
    expect(hover(A, rowOver(A), { x: LEFT, y: UPPER })).toBeNull();
    expect(hover(A, null, { x: LEFT, y: UPPER })).toBeNull();
  });

  it("below an expanded parent the line sits under its last subtask, placed after the parent", () => {
    expect(hover(A, rowOver(C, { lastChildId: "s1" }), { x: LEFT, y: LOWER })).toMatchObject({
      kind: "reorder",
      ref: { id: "c", edge: "after" },
      line: { id: "s1", edge: "bottom" },
      depth: 0,
    });
  });

  it("over a nested subtask, it becomes a sibling subtask (never nests deeper)", () => {
    const over = rowOver(S1, { depth: 1, rect: { ...ROW, left: ROW.left + 40 } });
    expect(hover(A, over, { x: 9999, y: UPPER })).toMatchObject({
      kind: "reorder",
      depth: 1,
      parentId: "c",
      ref: { id: "s1", edge: "before" },
    });
    // a parent can't become a subtask
    expect(hover(C, over, { x: LEFT, y: UPPER })).toBeNull();
  });

  it("a subtask listed top level keeps its parent when reordered; a nested one comes out", () => {
    const orphan = task("o", "0000000050", { parentId: "elsewhere" });
    expect(hover(orphan, rowOver(A), { x: LEFT, y: UPPER })).toMatchObject({
      parentId: "elsewhere",
    });
    expect(hover(S1, rowOver(A), { x: LEFT, y: UPPER }, { activeNested: true })).toMatchObject({
      parentId: null,
    });
  });

  it("its own group's header puts it first there", () => {
    expect(hover(A, { type: "group", groupKey: "all" }, { x: 0, y: 0 })).toEqual({
      kind: "group",
      groupKey: "all",
      parentId: null,
      place: true,
    });
  });
});

describe("resolveListHover — sorted: a reorder asks to switch back", () => {
  it("replaces the line with the sorted note within the same group", () => {
    expect(hover(A, rowOver(B), { x: LEFT, y: UPPER }, { order: "sorted" })).toEqual({
      kind: "sorted",
      line: { id: "b", edge: "top" },
    });
    // among its own parent's subtasks too
    const sibling = task("s2", "0000000045", { parentId: "c" });
    const over = rowOver(sibling, { depth: 1 });
    expect(
      hover(S1, over, { x: LEFT, y: UPPER }, { order: "sorted", activeNested: true })?.kind,
    ).toBe("sorted");
  });

  it("still nests (that isn't a reorder)", () => {
    expect(hover(A, rowOver(B), { x: RIGHT, y: UPPER }, { order: "sorted" })?.kind).toBe("nest");
  });

  it("among another parent's subtasks it nests under that parent (no place to keep)", () => {
    const over = rowOver(S1, { depth: 1 });
    expect(hover(A, over, { x: LEFT, y: UPPER }, { order: "sorted" })).toEqual({
      kind: "nest",
      targetId: "c",
    });
  });

  it("still lands a drop into another group, without a place", () => {
    const over = rowOver(B, { groupKey: "high" });
    expect(
      hover(A, over, { x: LEFT, y: UPPER }, { order: "sorted", activeGroupKey: "low" }),
    ).toEqual({ kind: "group", groupKey: "high", parentId: null, place: false });
  });

  it("its own group's header is no drop; another group's header is", () => {
    const header = (groupKey: string) => ({ type: "group", groupKey }) as const;
    expect(
      hover(A, header("low"), { x: 0, y: 0 }, { order: "sorted", activeGroupKey: "low" }),
    ).toBeNull();
    expect(
      hover(A, header("high"), { x: 0, y: 0 }, { order: "sorted", activeGroupKey: "low" }),
    ).toMatchObject({ kind: "group", place: false });
  });
});

describe("resolveListHover — across projects: no reorder, the group's field only", () => {
  const none = { order: "none" } as const;

  it("a slot in its own group is no drop, and draws nothing", () => {
    expect(hover(A, rowOver(B), { x: LEFT, y: UPPER }, none)).toBeNull();
    expect(hover(A, { type: "group", groupKey: "all" }, { x: 0, y: 0 }, none)).toBeNull();
  });

  it("another group takes it as a whole, keeping its place in the order", () => {
    const over = rowOver(B, { groupKey: "done" });
    expect(hover(A, over, { x: LEFT, y: LOWER }, { ...none, activeGroupKey: "todo" })).toEqual({
      kind: "group",
      groupKey: "done",
      parentId: null,
      place: false,
    });
    expect(
      hover(
        A,
        { type: "group", groupKey: "done" },
        { x: 0, y: 0 },
        { ...none, activeGroupKey: "todo" },
      ),
    ).toMatchObject({ kind: "group", place: false });
  });

  it("a nested subtask dragged out comes out to the top level of its group", () => {
    expect(hover(S1, rowOver(A), { x: LEFT, y: UPPER }, { ...none, activeNested: true })).toEqual({
      kind: "group",
      groupKey: "all",
      parentId: null,
      place: false,
    });
    expect(
      hover(
        S1,
        { type: "group", groupKey: "all" },
        { x: 0, y: 0 },
        { ...none, activeNested: true },
      ),
    ).toEqual({ kind: "group", groupKey: "all", parentId: null, place: false });
  });

  it("nesting still works (that isn't a reorder)", () => {
    expect(hover(A, rowOver(B), { x: RIGHT, y: UPPER }, none)).toEqual({
      kind: "nest",
      targetId: "b",
    });
  });
});

describe("resolveListHover — a group that won't take it", () => {
  const refuse = { accepts: () => false, activeGroupKey: "low" };

  it("is no drop on its rows or its header, in any order", () => {
    const over = rowOver(B, { groupKey: "high" });
    for (const order of ["manual", "sorted", "none"] as const) {
      expect(hover(A, over, { x: LEFT, y: UPPER }, { ...refuse, order })).toBeNull();
      expect(
        hover(A, { type: "group", groupKey: "high" }, { x: 0, y: 0 }, { ...refuse, order }),
      ).toBeNull();
    }
  });
});

describe("groupFieldPatch — the group's field", () => {
  it("writes status (Won't do too), priority and assignee; unset clears", () => {
    expect(groupFieldPatch("status", "in_progress")).toEqual({ status: "in_progress" });
    expect(groupFieldPatch("status", "archived")).toEqual({ status: "archived" });
    expect(groupFieldPatch("priority", "high")).toEqual({ priority: "high" });
    expect(groupFieldPatch("priority", "unset")).toEqual({ priority: null });
    expect(groupFieldPatch("assignee", "u1")).toEqual({ assigneeId: "u1" });
    expect(groupFieldPatch("assignee", "none")).toEqual({ assigneeId: null });
  });

  it("has nothing to write for no grouping, dates or projects (a move)", () => {
    expect(groupFieldPatch("none", "all")).toBeNull();
    expect(groupFieldPatch("date", "today")).toBeNull();
    expect(groupFieldPatch("bucket", "b2")).toBeNull();
  });
});

describe("groupAccepts — where a cross-group drop may land", () => {
  const ctx = { inboxId: "inbox", assignableIds: new Set(["u1"]) };

  it("statuses and priorities always; a date group never", () => {
    expect(groupAccepts("status", "done", A, ctx)).toBe(true);
    expect(groupAccepts("priority", "unset", A, ctx)).toBe(true);
    expect(groupAccepts("date", "tomorrow", A, ctx)).toBe(false);
  });

  it("a person who can take tasks, or nobody; never a former member", () => {
    expect(groupAccepts("assignee", "u1", A, ctx)).toBe(true);
    expect(groupAccepts("assignee", "none", A, ctx)).toBe(true);
    expect(groupAccepts("assignee", "gone", A, ctx)).toBe(false);
  });

  it("a project; the Inbox only for a task already there", () => {
    expect(groupAccepts("bucket", "b2", A, ctx)).toBe(true);
    expect(groupAccepts("bucket", "inbox", A, ctx)).toBe(false);
    expect(canMoveInto("inbox", { bucketId: "inbox" }, "inbox")).toBe(true);
    expect(canMoveInto("b2", { bucketId: "inbox" }, "inbox")).toBe(true);
  });
});

/** The plan's position, failing the test when there is none. */
function positionOf(plan: { position?: string } | null): string {
  if (!plan?.position) throw new Error("expected a position");
  return plan.position;
}

describe("planListDrop", () => {
  const groups: Record<string, Task[]> = { all: [A, B, C] };
  const plan = (
    hoverValue: Parameters<typeof planListDrop>[0]["hover"],
    active: Task,
    extra: Partial<Parameters<typeof planListDrop>[0]> = {},
  ) =>
    planListDrop({
      hover: hoverValue,
      active,
      activeGroupKey: "all",
      groupBy: "none",
      allByPosition: ALL,
      groupTasks: (k) => groups[k] ?? [],
      ...extra,
    });

  it("a reorder writes a position right next to the hovered row", () => {
    const p = plan(hover(A, rowOver(C), { x: LEFT, y: LOWER })!, A);
    expect(p?.parentId).toBeUndefined();
    expect(positionOf(p) > C.position).toBe(true);
    expect(positionOf(p) < S1.position).toBe(true);
  });

  it("a nest in the same project writes the parent only", () => {
    expect(plan({ kind: "nest", targetId: "b" }, A)).toEqual({ taskId: "a", parentId: "b" });
  });

  it("a nest under a task in another project moves it there (#329 MINOR)", () => {
    const other = task("x", "0000000025", { bucketId: "b2" });
    expect(
      planListDrop({
        hover: { kind: "nest", targetId: "x" },
        active: A,
        activeGroupKey: "b1",
        groupBy: "bucket",
        allByPosition: [A, B, other, C, S1],
        groupTasks: () => [],
      }),
    ).toEqual({ taskId: "a", parentId: "x", bucketId: "b2" });
  });

  it("dropping where it already is writes nothing", () => {
    expect(plan(hover(A, rowOver(B), { x: LEFT, y: UPPER })!, A)).toBeNull();
    expect(plan({ kind: "sorted", line: { id: "b", edge: "top" } }, A)).toBeNull();
  });

  it("into another priority group rewrites priority and places it", () => {
    const over = rowOver(B, { groupKey: "high" });
    const p = plan(hover(A, over, { x: LEFT, y: LOWER }, { activeGroupKey: "unset" })!, A, {
      activeGroupKey: "unset",
      groupBy: "priority",
    });
    expect(p?.fields).toEqual({ priority: "high" });
    expect(positionOf(p) > B.position && positionOf(p) < C.position).toBe(true);
  });

  it("into another person's group assigns it to them", () => {
    const p = plan({ kind: "group", groupKey: "u1", parentId: null, place: false }, A, {
      activeGroupKey: "none",
      groupBy: "assignee",
    });
    expect(p).toEqual({ taskId: "a", fields: { assigneeId: "u1" } });
  });

  it("into another project's group moves it (no field patch)", () => {
    const over = rowOver(C, { groupKey: "b2" });
    const p = plan(hover(A, over, { x: LEFT, y: LOWER }, { activeGroupKey: "b1" })!, A, {
      activeGroupKey: "b1",
      groupBy: "bucket",
    });
    expect(p?.bucketId).toBe("b2");
    expect(p?.fields).toBeUndefined();
  });

  it("MAJOR (#329): a placed move into another project keeps its place when it's already there", () => {
    // a sits right before b in the one order; dropped before b's row in the
    // b2 group, it's already in place, but the move must still say where, or
    // it would go to the project's end.
    const b2 = task("b", "0000000020", { bucketId: "b2" });
    const p = planListDrop({
      hover: {
        kind: "reorder",
        ref: { id: "b", edge: "before" },
        line: { id: "b", edge: "top" },
        depth: 0,
        parentId: null,
        groupKey: "b2",
      },
      active: A,
      activeGroupKey: "b1",
      groupBy: "bucket",
      allByPosition: [A, b2, C, S1],
      groupTasks: () => [b2],
    });
    expect(p).toEqual({ taskId: "a", bucketId: "b2", position: A.position });
  });

  it("MAJOR (#329): a header drop into another project goes first there, even when adjacent", () => {
    const b2 = task("b", "0000000020", { bucketId: "b2" });
    const p = planListDrop({
      hover: { kind: "group", groupKey: "b2", parentId: null, place: true },
      active: A,
      activeGroupKey: "b1",
      groupBy: "bucket",
      allByPosition: [A, b2, C, S1],
      groupTasks: () => [b2],
    });
    expect(p).toEqual({ taskId: "a", bucketId: "b2", position: A.position });
  });

  it("a subtask moved to another project on its own comes out of its parent", () => {
    const orphan = task("o", "0000000050", { parentId: "c" });
    const p = plan({ kind: "group", groupKey: "b2", parentId: "c", place: false }, orphan, {
      activeGroupKey: "b1",
      groupBy: "bucket",
      allByPosition: [...ALL, orphan],
    });
    expect(p).toEqual({ taskId: "o", bucketId: "b2", parentId: null });
  });

  it("a header drop under a sort rewrites the field only", () => {
    const p = plan({ kind: "group", groupKey: "done", parentId: null, place: false }, A, {
      activeGroupKey: "todo",
      groupBy: "status",
    });
    expect(p).toEqual({ taskId: "a", fields: { status: "done" } });
  });

  it("a header drop in Manual goes first in the group", () => {
    const p = plan({ kind: "group", groupKey: "all", parentId: null, place: true }, C);
    expect(positionOf(p) < A.position).toBe(true);
  });

  it("pulling a subtask out to the top level clears its parent", () => {
    const p = plan(hover(S1, rowOver(A), { x: LEFT, y: UPPER }, { activeNested: true })!, S1);
    expect(p?.parentId).toBeNull();
    expect(positionOf(p) < A.position).toBe(true);
  });

  it("into another parent's subtasks sets that parent", () => {
    const over = rowOver(S1, { depth: 1 });
    const p = plan(hover(A, over, { x: LEFT, y: LOWER })!, A);
    expect(p?.parentId).toBe("c");
  });
});

describe("positionNextTo", () => {
  it("never collides with a task that's hidden from the view", () => {
    // b is a hidden completed task between a and c; a drop "after a" in a view
    // that doesn't list b must still land strictly between a and b.
    const pos = positionNextTo(ALL, { id: "a", edge: "after" }, "c")!;
    expect(pos > A.position && pos < B.position).toBe(true);
  });

  it("is null for an unknown anchor", () => {
    expect(positionNextTo(ALL, { id: "zz", edge: "after" }, "a")).toBeNull();
  });
});
