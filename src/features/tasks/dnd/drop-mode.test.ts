// tasks-v2 U4-1 (reorder vs nest from the pointer), U4-2 (a sorted Order
// refuses a reorder), U4-3 (a cross-group drop rewrites the group's field).

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "../helpers";
import type { Task } from "../model";
import {
  groupFieldPatch,
  type ListPointerTarget,
  NEST_INDENT_PX,
  planListDrop,
  positionNextTo,
  resolveListHover,
  sortedOrderNote,
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
  opts: { order?: "manual" | "due"; activeNested?: boolean; activeGroupKey?: string } = {},
) {
  return resolveListHover({
    active,
    activeNested: opts.activeNested ?? false,
    activeGroupKey: opts.activeGroupKey ?? "all",
    hasChildren: noChildren,
    pointer,
    over,
    order: opts.order ?? "manual",
  });
}

describe("resolveListHover — U4-1 reorder vs nest", () => {
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
    // c has subtasks, so it can't become one
    expect(hover(C, rowOver(A), { x: RIGHT, y: UPPER })?.kind).toBe("reorder");
    // a subtask listed top level (its parent is elsewhere) can't take children
    const orphan = task("o", "0000000050", { parentId: "elsewhere" });
    expect(hover(A, rowOver(orphan), { x: RIGHT, y: UPPER })?.kind).toBe("reorder");
    // already its parent → nothing to nest
    expect(hover(S1, rowOver(C), { x: RIGHT, y: UPPER }, { activeNested: true })?.kind).toBe(
      "reorder",
    );
  });

  it("a row over itself is no drop", () => {
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
});

describe("resolveListHover — U4-2 a sorted Order refuses a reorder", () => {
  it("replaces the line with the note within the same group", () => {
    expect(hover(A, rowOver(B), { x: LEFT, y: UPPER }, { order: "due" })).toEqual({
      kind: "sorted",
      line: { id: "b", edge: "top" },
    });
    expect(sortedOrderNote("due")).toBe("Sorted by due date — switch to Manual to reorder");
  });

  it("still nests (that isn't a reorder)", () => {
    expect(hover(A, rowOver(B), { x: RIGHT, y: UPPER }, { order: "due" })?.kind).toBe("nest");
  });

  it("still lands a drop into another group, without a place", () => {
    const over = rowOver(B, { groupKey: "high" });
    expect(hover(A, over, { x: LEFT, y: UPPER }, { order: "due", activeGroupKey: "low" })).toEqual({
      kind: "group",
      groupKey: "high",
      parentId: null,
      place: false,
    });
  });

  it("a header of its own group is no drop; another group's header is", () => {
    const header = (groupKey: string) => ({ type: "group", groupKey }) as const;
    expect(
      hover(A, header("low"), { x: 0, y: 0 }, { order: "due", activeGroupKey: "low" }),
    ).toBeNull();
    expect(
      hover(A, header("high"), { x: 0, y: 0 }, { order: "due", activeGroupKey: "low" }),
    ).toMatchObject({ kind: "group", place: false });
  });
});

describe("groupFieldPatch — U4-3 the group's field", () => {
  it("writes status, priority and energy; unset clears", () => {
    expect(groupFieldPatch("status", "in_progress")).toEqual({ status: "in_progress" });
    expect(groupFieldPatch("priority", "high")).toEqual({ priority: "high" });
    expect(groupFieldPatch("priority", "unset")).toEqual({ priority: null });
    expect(groupFieldPatch("energy", "low")).toEqual({ energyLevel: "low" });
    expect(groupFieldPatch("energy", "unset")).toEqual({ energyLevel: null });
  });

  it("has nothing to write for no grouping, buckets (a move) or archived", () => {
    expect(groupFieldPatch("none", "all")).toBeNull();
    expect(groupFieldPatch("bucket", "b2")).toBeNull();
    expect(groupFieldPatch("status", "archived")).toBeNull();
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

  it("U4-1: a reorder writes a position right next to the hovered row", () => {
    const p = plan(hover(A, rowOver(C), { x: LEFT, y: LOWER })!, A);
    expect(p?.parentId).toBeUndefined();
    expect(positionOf(p) > C.position).toBe(true);
    expect(positionOf(p) < S1.position).toBe(true);
  });

  it("U4-1: a nest writes the parent only", () => {
    expect(plan({ kind: "nest", targetId: "b" }, A)).toEqual({ taskId: "a", parentId: "b" });
  });

  it("dropping where it already is writes nothing", () => {
    expect(plan(hover(A, rowOver(B), { x: LEFT, y: UPPER })!, A)).toBeNull();
    expect(plan({ kind: "sorted", line: { id: "b", edge: "top" } }, A)).toBeNull();
  });

  it("U4-3: into another priority group rewrites priority and places it", () => {
    const over = rowOver(B, { groupKey: "high" });
    const p = plan(hover(A, over, { x: LEFT, y: LOWER }, { activeGroupKey: "unset" })!, A, {
      activeGroupKey: "unset",
      groupBy: "priority",
    });
    expect(p?.fields).toEqual({ priority: "high" });
    expect(positionOf(p) > B.position && positionOf(p) < C.position).toBe(true);
  });

  it("U4-3: into another bucket's group moves it (no field patch)", () => {
    const over = rowOver(B, { groupKey: "b2" });
    const p = plan(hover(A, over, { x: LEFT, y: UPPER }, { activeGroupKey: "b1" })!, A, {
      activeGroupKey: "b1",
      groupBy: "bucket",
    });
    expect(p?.bucketId).toBe("b2");
    expect(p?.fields).toBeUndefined();
  });

  it("U4-3: a header drop under a sorted Order rewrites the field only", () => {
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
