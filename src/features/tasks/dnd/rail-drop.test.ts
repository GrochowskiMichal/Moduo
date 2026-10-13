// TV-U4 — a task dropped on the rail: a project moves it (to its end, subtasks
// following), the Inbox does nothing, the Queue queues it, My tasks assigns it
// to me. The rail droppables resolve through a prefix-filtered pointerWithin,
// so only the row actually under the pointer takes the drop.

import type { ClientRect, DroppableContainer } from "@dnd-kit/core";
import { describe, expect, it } from "@rstest/core";

import { makeTask } from "../helpers";
import type { Task } from "../model";
import {
  asRailDropTarget,
  bucketEndPosition,
  isSideDroppable,
  projectMoveWrite,
  railCollision,
  railDropAction,
  railDroppableId,
} from "./rail-drop";

function task(id: string, position: string, fields: Partial<Task> = {}): Task {
  return { ...makeTask({ workspaceId: "w", bucketId: "b1", title: id, position }), id, ...fields };
}

const ctx = { queuedTaskIds: new Set(["queued"]), currentUserId: "me", inboxId: "inbox" };

describe("railDropAction", () => {
  it("a bucket row moves the task, unless it's already there", () => {
    const t = task("t", "a");
    expect(railDropAction({ type: "rail", target: "bucket", bucketId: "b2" }, t, ctx)).toEqual({
      kind: "move",
      taskId: "t",
      bucketId: "b2",
    });
    expect(railDropAction({ type: "rail", target: "bucket", bucketId: "b1" }, t, ctx)).toBeNull();
  });

  it("the Inbox row does nothing: a shared task never turns private by a drop", () => {
    const inboxRow = { type: "rail", target: "bucket", bucketId: "inbox" } as const;
    expect(railDropAction(inboxRow, task("t", "a"), ctx)).toBeNull();
    expect(railDropAction(inboxRow, task("t", "a", { bucketId: "inbox" }), ctx)).toBeNull();
  });

  it("the Queue row adds it to my queue, unless queued or done", () => {
    const queue = { type: "rail", target: "queue" } as const;
    expect(railDropAction(queue, task("t", "a"), ctx)).toEqual({ kind: "queue", taskId: "t" });
    expect(railDropAction(queue, task("queued", "a"), ctx)).toBeNull();
    expect(railDropAction(queue, task("t", "a", { status: "done" }), ctx)).toBeNull();
  });

  it("My tasks assigns it to me, unless it's mine", () => {
    const mine = { type: "rail", target: "mine" } as const;
    expect(railDropAction(mine, task("t", "a", { assigneeId: "you" }), ctx)).toEqual({
      kind: "assign-me",
      taskId: "t",
      userId: "me",
    });
    expect(railDropAction(mine, task("t", "a", { assigneeId: "me" }), ctx)).toBeNull();
    expect(railDropAction(mine, task("t", "a"), { ...ctx, currentUserId: null })).toBeNull();
  });
});

describe("rail droppable ids and data", () => {
  it("round-trips the target through the droppable's data", () => {
    const bucket = { type: "rail", target: "bucket", bucketId: "b2" } as const;
    expect(railDroppableId(bucket)).toBe("rail:bucket:b2");
    expect(railDroppableId({ type: "rail", target: "queue" })).toBe("rail:queue");
    expect(asRailDropTarget(bucket)).toEqual(bucket);
    expect(asRailDropTarget({ type: "rail", target: "bucket" })).toBeNull();
    expect(asRailDropTarget({ type: "onto-task", taskId: "x" })).toBeNull();
    expect(asRailDropTarget(null)).toBeNull();
  });

  it("rail and hub droppables are side targets; centre ones aren't", () => {
    expect(isSideDroppable("rail:queue")).toBe(true);
    expect(isSideDroppable("link:task:x")).toBe(true);
    expect(isSideDroppable("col:status:todo")).toBe(false);
    expect(isSideDroppable("task-id")).toBe(false);
  });
});

describe("railCollision — prefix-filtered pointerWithin", () => {
  const rect = (top: number, left: number, width = 200, height = 32): ClientRect => ({
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const container = (id: string) =>
    ({ id, data: { current: {} } }) as unknown as DroppableContainer;
  const rects = new Map<string, ClientRect>([
    ["rail:queue", rect(0, 0)],
    ["rail:bucket:b2", rect(40, 0)],
    ["col:status:todo", rect(0, 0, 400, 400)], // a centre droppable under the same point
  ]);
  const run = (x: number, y: number) =>
    railCollision({
      active: {
        id: "t",
        data: { current: {} },
        rect: { current: { initial: null, translated: null } },
      },
      collisionRect: rect(y, x, 10, 10),
      droppableRects: rects as never,
      droppableContainers: [...rects.keys()].map(container),
      pointerCoordinates: { x, y },
    } as never).map((c) => c.id);

  it("hits only the rail row under the pointer", () => {
    expect(run(10, 50)).toEqual(["rail:bucket:b2"]);
    expect(run(10, 10)).toEqual(["rail:queue"]);
  });

  it("is empty off the rail, whatever centre droppable is there", () => {
    expect(run(300, 300)).toEqual([]);
  });

  it("is empty without a pointer (a keyboard drag never drops on the rail)", () => {
    const hits = railCollision({
      active: {
        id: "t",
        data: { current: {} },
        rect: { current: { initial: null, translated: null } },
      },
      collisionRect: rect(50, 10, 10, 10),
      droppableRects: rects as never,
      droppableContainers: [...rects.keys()].map(container),
      pointerCoordinates: null,
    } as never);
    expect(hits).toEqual([]);
  });
});

describe("projectMoveWrite — a subtask lives in its parent's project", () => {
  it("moves a top-level task; its subtasks follow in the save", () => {
    expect(projectMoveWrite(task("p", "a"), "b2", null)).toEqual({ taskId: "p", bucketId: "b2" });
  });

  it("a subtask moved on its own comes out of its parent", () => {
    const sub = task("s", "a", { parentId: "p" });
    expect(projectMoveWrite(sub, "b2", { bucketId: "b1" })).toEqual({
      taskId: "s",
      bucketId: "b2",
      parentId: null,
    });
    // its parent already there: it stays a subtask
    expect(projectMoveWrite(sub, "b2", { bucketId: "b2" })).toEqual({
      taskId: "s",
      bucketId: "b2",
    });
  });
});

describe("bucketEndPosition — an unplaced move goes to the project's end", () => {
  const P = task("p", "0000000010");
  const X = task("x", "0000000020", { bucketId: "b2" });
  const S1 = task("s1", "0000000030", { parentId: "p" });
  const Y = task("y", "0000000050");
  const all = [P, X, S1, Y];

  it("lands after the project's last task, before what follows it", () => {
    const pos = bucketEndPosition({
      moving: new Set(["p", "s1"]),
      bucketId: "b2",
      allByPosition: all,
    });
    expect(pos > X.position && pos < Y.position).toBe(true);
  });

  it("an empty project takes the very end", () => {
    const pos = bucketEndPosition({ moving: new Set(["y"]), bucketId: "b9", allByPosition: all });
    expect(pos > S1.position).toBe(true);
  });
});
