// The shared Tasks selectors: right answers, and one result per input so
// every page that shows a workspace shares it (no rebuild on a re-render).

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import type { Bucket, Task, TaskQueueEntry, TaskRelation } from "./model";
import {
  blockedTaskIdsOf,
  blockersByTaskOf,
  byIdOf,
  dependentsByTaskOf,
  driftCountByBucketOf,
  inboxOf,
  liveTasksOf,
  openTaskCountByBucketOf,
  queuedTasksOf,
  subtasksByParentOf,
  userBucketsOf,
} from "./selectors";

function task(id: string, fields: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    ...fields,
  };
}

function bucket(id: string, fields: Partial<Bucket> = {}): Bucket {
  return {
    id,
    workspaceId: "w1",
    ownerId: "u-me",
    name: id,
    isSystem: false,
    group: null,
    position: id,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    deletedAt: null,
    ...fields,
  };
}

const relation = (blocker: string, blocked: string): TaskRelation =>
  ({ id: `${blocker}>${blocked}`, blockerTaskId: blocker, blockedTaskId: blocked }) as TaskRelation;

const entry = (taskId: string, position: string): TaskQueueEntry => ({
  id: `u-me:${taskId}`,
  workspaceId: "w1",
  userId: "u-me",
  taskId,
  position,
  queuedAt: "2026-10-08T10:00:00Z",
  updatedAt: "2026-10-08T10:00:00Z",
});

describe("caching", () => {
  it("returns the same result for the same rows, and a new one when they change", () => {
    const rows = [task("b"), task("a")];
    const live = liveTasksOf(rows);
    expect(liveTasksOf(rows)).toBe(live);
    expect(openTaskCountByBucketOf(live)).toBe(openTaskCountByBucketOf(live));
    expect(byIdOf(live)).toBe(byIdOf(live));

    const next = [...rows, task("c")];
    expect(liveTasksOf(next)).not.toBe(live);
  });

  it("a two-input selector recomputes when the second input changes", () => {
    const live = liveTasksOf([task("a"), task("b")]);
    const r1 = [relation("a", "b")];
    expect(blockedTaskIdsOf(live, r1)).toBe(blockedTaskIdsOf(live, r1));
    const r2 = [...r1];
    expect(blockedTaskIdsOf(live, r2)).not.toBe(blockedTaskIdsOf(live, r1));
  });

  it("queued tasks are cached on all three inputs", () => {
    const live = liveTasksOf([task("a"), task("b")]);
    const mine = [entry("b", "a0"), entry("a", "a1")];
    const kept: TaskQueueEntry[] = [];
    const first = queuedTasksOf(mine, kept, live);
    expect(queuedTasksOf(mine, kept, live)).toBe(first);
    expect(first.map((t) => t.id)).toEqual(["b", "a"]);
    expect(queuedTasksOf(mine, [], live)).not.toBe(first);
  });
});

describe("rows", () => {
  it("live tasks drop deleted rows and sort by position", () => {
    const rows = [task("c"), task("a"), task("b", { deletedAt: "2026-10-01T00:00:00Z" })];
    expect(liveTasksOf(rows).map((t) => t.id)).toEqual(["a", "c"]);
    expect(rows.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("prefers your own Inbox over a teammate's, and keeps it out of the user buckets", () => {
    const rows = [
      bucket("theirs", { isSystem: true, ownerId: "u-ola" }),
      bucket("mine", { isSystem: true, ownerId: "u-me" }),
      bucket("p2"),
      bucket("p1"),
    ];
    expect(inboxOf(rows, "u-me")?.id).toBe("mine");
    expect(inboxOf(rows, "u-x")?.id).toBe("theirs");
    expect(userBucketsOf(rows).map((b) => b.id)).toEqual(["p1", "p2"]);
  });
});

describe("relations", () => {
  it("blockers and dependents point both ways and skip deleted tasks", () => {
    const live = liveTasksOf([task("a"), task("b"), task("c")]);
    const rels = [relation("a", "b"), relation("gone", "c")];
    expect(
      blockersByTaskOf(live, rels)
        .get("b")
        ?.map((t) => t.id),
    ).toEqual(["a"]);
    expect(blockersByTaskOf(live, rels).has("c")).toBe(false);
    expect(
      dependentsByTaskOf(live, rels)
        .get("a")
        ?.map((t) => t.id),
    ).toEqual(["b"]);
  });

  it("subtasks leave out archived children", () => {
    const live = liveTasksOf([
      task("p"),
      task("c1", { parentId: "p" }),
      task("c2", { parentId: "p", status: "archived" }),
    ]);
    expect(
      subtasksByParentOf(live)
        .get("p")
        ?.map((t) => t.id),
    ).toEqual(["c1"]);
  });
});

describe("drift", () => {
  it("counts open tasks scheduled in the past, per bucket, and keys on the day", () => {
    const live = liveTasksOf([
      task("late", { scheduledAt: "2000-01-01T09:00:00Z" }),
      task("later", { scheduledAt: "2999-01-01T09:00:00Z" }),
      task("done", { scheduledAt: "2000-01-01T09:00:00Z", status: "done" }),
    ]);
    const today = driftCountByBucketOf(live, "2026-10-20");
    expect(today.get("b1")).toBe(1);
    expect(driftCountByBucketOf(live, "2026-10-20")).toBe(today);
    expect(driftCountByBucketOf(live, "2026-10-21")).not.toBe(today);
  });
});
