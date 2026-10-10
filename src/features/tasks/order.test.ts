// AC11.4 — "manual order inside one project" (tasks-v3 §4, default m; TV-U4):
// sorting a project view shows the sorted note and keeps the manual order; a
// cross-project view never writes positions.

import { describe, expect, it } from "@rstest/core";

import { orderTasks } from "./display";
import { planListDrop, resolveListHover } from "./dnd/drop-mode";
import { makeTask } from "./helpers";
import type { Task } from "./model";
import {
  BACK_TO_MANUAL_ORDER,
  dragOrderFor,
  hasManualOrder,
  showsSortedNote,
  sortedByLabel,
} from "./order";

function task(id: string, position: string, fields: Partial<Task> = {}): Task {
  return { ...makeTask({ workspaceId: "w", bucketId: "p1", title: id, position }), id, ...fields };
}

describe("manual order inside one project", () => {
  it("lives in a project and the Inbox; All, My tasks and the Queue have none", () => {
    expect(hasManualOrder("p1")).toBe(true);
    expect(hasManualOrder("inbox")).toBe(true);
    expect(hasManualOrder("all")).toBe(false);
    expect(hasManualOrder("mine")).toBe(false);
    expect(hasManualOrder("today")).toBe(false);
  });

  it("sorting a project view shows the sorted note with its action", () => {
    expect(dragOrderFor("p1", "manual")).toBe("manual");
    expect(dragOrderFor("p1", "due")).toBe("sorted");
    expect(showsSortedNote("p1", "due")).toBe(true);
    expect(showsSortedNote("p1", "manual")).toBe(false);
    expect(`${sortedByLabel("due")} · ${BACK_TO_MANUAL_ORDER}`).toBe(
      "Sorted by due date · Back to manual order",
    );
    // A view across projects has no manual order to go back to.
    expect(showsSortedNote("all", "due")).toBe(false);
    expect(showsSortedNote("mine", "priority")).toBe(false);
  });

  it("sorting keeps the manual order untouched underneath", () => {
    const a = task("a", "0000000010", { dueDate: "2026-10-20T00:00:00.000Z" });
    const b = task("b", "0000000020", { dueDate: "2026-10-12T00:00:00.000Z" });
    const c = task("c", "0000000030");
    const manual = [a, b, c];
    expect(orderTasks(manual, "due").map((t) => t.id)).toEqual(["b", "a", "c"]);
    // Nothing was written: the positions, and Manual's order, are as they were.
    expect(manual.map((t) => t.position)).toEqual(["0000000010", "0000000020", "0000000030"]);
    expect(orderTasks(manual, "manual").map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("dragging while sorted asks first: the hover is the note, and the drop writes nothing", () => {
    const a = task("a", "0000000010");
    const b = task("b", "0000000020");
    const hover = resolveListHover({
      active: a,
      activeNested: false,
      activeGroupKey: "all",
      hasChildren: () => false,
      pointer: { x: 0, y: 210 },
      over: {
        type: "row",
        task: b,
        depth: 0,
        groupKey: "all",
        rect: { left: 0, top: 200, height: 32 },
        lastChildId: null,
      },
      order: dragOrderFor("p1", "due"),
      accepts: () => true,
      canNestInto: () => true,
    });
    expect(hover?.kind).toBe("sorted");
    expect(
      planListDrop({
        hover: hover!,
        active: a,
        activeGroupKey: "all",
        groupBy: "none",
        allByPosition: [a, b],
        groupTasks: () => [a, b],
      }),
    ).toBeNull();
  });

  it("a cross-project view never writes positions", () => {
    // All grouped by status: a from p1, b from p2. Every drop resolves to a
    // field write, never a place in the order.
    const a = task("a", "0000000010", { status: "todo" });
    const b = task("b", "0000000020", { bucketId: "p2", status: "todo" });
    const c = task("c", "0000000030", { bucketId: "p2", status: "done" });
    const all = [a, b, c];
    for (const scope of ["all", "mine"]) {
      const order = dragOrderFor(scope, "manual");
      expect(order).toBe("none");
      const at = (over: Task, groupKey: string, y: number) =>
        resolveListHover({
          active: a,
          activeNested: false,
          activeGroupKey: "todo",
          hasChildren: () => false,
          pointer: { x: 0, y },
          over: {
            type: "row",
            task: over,
            depth: 0,
            groupKey,
            rect: { left: 0, top: 200, height: 32 },
            lastChildId: null,
          },
          order,
          accepts: () => true,
          canNestInto: () => true,
        });
      // Its own group: no reorder at all.
      expect(at(b, "todo", 204)).toBeNull();
      expect(at(b, "todo", 228)).toBeNull();
      // Another group: the status changes, the position doesn't.
      const hover = at(c, "done", 204);
      const plan = planListDrop({
        hover: hover!,
        active: a,
        activeGroupKey: "todo",
        groupBy: "status",
        allByPosition: all,
        groupTasks: () => [c],
      });
      expect(plan).toEqual({ taskId: "a", fields: { status: "done" } });
      expect(plan?.position).toBeUndefined();
    }
  });
});
