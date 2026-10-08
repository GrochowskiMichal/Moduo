// TV-D4: my queue, claims and the widget's source (D4-1, D4-2).

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import type { Task, TaskQueueEntry } from "./model";
import {
  alsoInLabel,
  claimLabel,
  claimsByTask,
  endOfQueue,
  movedPosition,
  openQueueCount,
  queueEntriesOf,
  queueMove,
  queueOrOpen,
  queueTasks,
  withOwnQueue,
  withoutTask,
} from "./queue";

const ME = "u-me";
const MIKE = "u-mike";
const OLA = "u-ola";

function entry(
  userId: string,
  taskId: string,
  position: string,
  queuedAt = "2026-10-08T10:00:00Z",
) {
  return {
    id: `${userId}:${taskId}`,
    workspaceId: "w1",
    userId,
    taskId,
    position,
    queuedAt,
    updatedAt: queuedAt,
  } satisfies TaskQueueEntry;
}

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    ...over,
  };
}

describe("queueEntriesOf", () => {
  it("is one person's line-up, by position compared bytewise", () => {
    const rows = [
      entry(ME, "b", "000000mh34"),
      entry(MIKE, "x", "0000000001"),
      entry(ME, "a", "0000000zzz"),
      // A subdivided key sorts by its bytes: right after the key it extends.
      entry(ME, "c", "000000mh34i"),
    ];
    expect(queueEntriesOf(rows, ME).map((e) => e.taskId)).toEqual(["a", "b", "c"]);
    expect(queueEntriesOf(rows, null)).toEqual([]);
  });
});

describe("claimsByTask", () => {
  it("lists who else has each task queued, earliest first, never me", () => {
    const rows = [
      entry(ME, "t1", "1"),
      entry(OLA, "t1", "1", "2026-10-08T12:00:00Z"),
      entry(MIKE, "t1", "5", "2026-10-08T09:00:00Z"),
      entry(MIKE, "t2", "1"),
    ];
    const claims = claimsByTask(rows, ME);
    expect(claims.get("t1")).toEqual([MIKE, OLA]);
    expect(claims.get("t2")).toEqual([MIKE]);
    expect(claims.has("t3")).toBe(false);
  });
});

describe("queueTasks + openQueueCount", () => {
  it("maps my rows to tasks in order, keeps just-completed ones in place, drops archived and unknown", () => {
    const tasks = [
      task("t1"),
      task("t2", { status: "done" }),
      task("t3", { status: "archived" }),
      task("t4"),
    ];
    const mine = [
      entry(ME, "t4", "3"),
      entry(ME, "t1", "1"),
      entry(ME, "t3", "4"),
      entry(ME, "gone", "5"),
    ];
    const kept = [entry(ME, "t2", "2")];
    const queued = queueTasks(queueEntriesOf(mine, ME), kept, tasks);
    expect(queued.map((t) => t.id)).toEqual(["t1", "t2", "t4"]);
    // The rail counts open ones only.
    expect(openQueueCount(queued)).toBe(2);
  });
});

describe("withOwnQueue / withoutTask", () => {
  it("replaces only my rows in that workspace with an op's answer", () => {
    const other = { ...entry(ME, "t9", "1"), workspaceId: "w2" };
    const rows = [entry(ME, "t1", "1"), entry(MIKE, "t1", "1"), other];
    const next = withOwnQueue(rows, "w1", ME, [entry(ME, "t2", "1")]);
    expect(next.map((e) => e.id).sort()).toEqual([other.id, `${MIKE}:t1`, `${ME}:t2`].sort());
  });

  it("drops every person's row for a task", () => {
    const rows = [entry(ME, "t1", "1"), entry(MIKE, "t1", "1"), entry(MIKE, "t2", "2")];
    expect(withoutTask(rows, "t1").map((e) => e.taskId)).toEqual(["t2"]);
    expect(withoutTask(rows, "nope")).toBe(rows);
  });
});

describe("positions", () => {
  it("endOfQueue sorts after the last row", () => {
    const mine = [entry(ME, "a", "000000mh34"), entry(ME, "b", "00000168g8")];
    expect(endOfQueue(mine) > "00000168g8").toBe(true);
    expect(endOfQueue([])).toBe("000000mh34");
  });

  it("movedPosition lands between the new neighbours", () => {
    const mine = [
      entry(ME, "a", "000000mh34"),
      entry(ME, "b", "00000168g8"),
      entry(ME, "c", "000001ilsc"),
    ];
    const top = movedPosition(mine, "c", null);
    expect(top < "000000mh34").toBe(true);
    const middle = movedPosition(mine, "c", "a");
    expect(middle > "000000mh34" && middle < "00000168g8").toBe(true);
    const last = movedPosition(mine, "a", "c");
    expect(last > "000001ilsc").toBe(true);
  });
});

describe("queueMove", () => {
  const queued = ["a", "b", "c", "d"];

  it("finds the one task that moved and what it now follows", () => {
    expect(queueMove(queued, ["c", "a", "b", "d"])).toEqual({ taskId: "c", afterTaskId: null });
    expect(queueMove(queued, ["b", "c", "a", "d"])).toEqual({ taskId: "a", afterTaskId: "c" });
    expect(queueMove(queued, ["a", "b", "d", "c"])).toEqual({ taskId: "d", afterTaskId: "b" });
  });

  it("is null when nothing moved", () => {
    expect(queueMove(queued, ["a", "b", "c", "d"])).toBeNull();
  });

  it("anchors only on tasks still in the queue (a just-completed one showing doesn't count)", () => {
    // "x" is done and shown in place but no longer queued on the server.
    expect(queueMove(queued, ["a", "x", "c", "b", "d"])).toEqual({ taskId: "c", afterTaskId: "a" });
  });

  it("works on a filtered view: the anchor is the visible queued task before it", () => {
    expect(queueMove(["a", "b", "c", "d"], ["d", "b"])).toEqual({ taskId: "d", afterTaskId: null });
  });
});

describe("claim wording (D4-2)", () => {
  it("names one or more people", () => {
    expect(claimLabel(["Mike"])).toBe("In Mike’s queue");
    expect(claimLabel(["Mike", "Ola"])).toBe("In Mike’s and Ola’s queues");
    expect(claimLabel(["Mike", "Ola", "Sam"])).toBe("In Mike’s, Ola’s and Sam’s queues");
    expect(claimLabel([])).toBe("");
    expect(alsoInLabel(["Mike"])).toBe("Also in Mike’s queue");
  });
});

describe("queueOrOpen (the Home Tasks widget, D4-1)", () => {
  const tasks = [
    task("t1", { position: "0000000003" }),
    task("t2", { position: "0000000001" }),
    task("t3", { position: "0000000002", status: "done" }),
    task("t4", { position: "0000000004", bucketId: "b2" }),
  ];

  it("shows my queue's open tasks in line-up order, not someone else's", () => {
    const rows = [
      entry(ME, "t1", "2"),
      entry(ME, "t3", "1"),
      entry(ME, "t2", "3"),
      entry(MIKE, "t4", "1"),
    ];
    const { rows: out, heading } = queueOrOpen(tasks, rows, ME);
    expect(heading).toBe("Queue");
    expect(out.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("falls back to the open tasks in list order, headed Open", () => {
    const { rows: out, heading } = queueOrOpen(tasks, [entry(MIKE, "t1", "1")], ME);
    expect(heading).toBe("Open");
    expect(out.map((t) => t.id)).toEqual(["t2", "t1", "t4"]);
  });

  it("keeps to the widget's buckets", () => {
    const rows = [entry(ME, "t4", "1")];
    expect(queueOrOpen(tasks, rows, ME, ["b1"])).toMatchObject({ heading: "Open" });
    expect(queueOrOpen(tasks, rows, ME, ["b2"]).rows.map((t) => t.id)).toEqual(["t4"]);
  });
});
