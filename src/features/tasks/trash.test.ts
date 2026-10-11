// tasks-v2 U6-3 — what Recently deleted lists: a bucket deleted with its tasks
// is one entry, everything else deleted on its own is its own, newest first,
// and nothing past its 30 days.

import { describe, expect, it } from "@rstest/core";

import type { Bucket, Task, TasksTrash } from "./model";
import { trashAgeLabel, trashDaysLeft, trashEntries } from "./trash";

const T0 = "2026-10-09T12:00:00.000Z";
const now = new Date(T0);
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000).toISOString();

function bucket(id: string, name: string, deletedAt: string, color: string | null = null): Bucket {
  return {
    id,
    workspaceId: "w",
    ownerId: "u",
    name,
    isSystem: false,
    group: null,
    position: id,
    createdAt: T0,
    updatedAt: T0,
    deletedAt,
    color,
  };
}
function task(id: string, bucketId: string, deletedAt: string, title = id): Task {
  return {
    id,
    workspaceId: "w",
    creatorId: "u",
    creatorUnknown: false,
    assigneeId: "u",
    bucketId,
    parentId: null,
    title,
    description: "",
    dueDate: null,
    scheduledAt: null,
    durationMinutes: null,
    timeSpentSeconds: 0,
    recurrence: null,
    energyLevel: null,
    priority: null,
    status: "todo",
    committedFor: null,
    commitOrder: null,
    rescheduleCount: 0,
    position: id,
    createdAt: T0,
    updatedAt: T0,
    deletedAt,
  };
}

const trash: TasksTrash = {
  buckets: [
    { bucket: bucket("mkt", "Marketing", daysAgo(1), "teal"), batchId: "b1", movedTaskIds: [] },
    { bucket: bucket("ops", "Ops", daysAgo(3)), batchId: "b2", movedTaskIds: ["t9", "t10"] },
    { bucket: bucket("old", "Ancient", daysAgo(31)), batchId: "b3", movedTaskIds: [] },
  ],
  tasks: [
    { task: task("m1", "mkt", daysAgo(1)), batchId: "b1" },
    { task: task("m2", "mkt", daysAgo(1)), batchId: "b1" },
    { task: task("solo", "inbox", daysAgo(0.5), "Call Ola"), batchId: null },
    { task: task("in-gone", "mkt", daysAgo(5), "  "), batchId: null },
    { task: task("stale", "inbox", daysAgo(40)), batchId: null },
  ],
};
const bucketName = (id: string) => (id === "inbox" ? "Inbox" : null);

describe("trashEntries (U6-3)", () => {
  it("folds a bucket's batch into one entry and lists the rest newest first", () => {
    const entries = trashEntries(trash, { bucketName, now });
    expect(entries.map((e) => [e.kind, e.id])).toEqual([
      ["task", "solo"],
      ["bucket", "mkt"],
      ["bucket", "ops"],
      ["task", "in-gone"],
    ]);
    expect(entries[1]).toMatchObject({ name: "Marketing", color: "teal", deletedTasks: 2 });
    expect(entries[2]).toMatchObject({ deletedTasks: 0, movedTasks: 2, color: "gray" });
  });

  it("names where a task was, falling back to a deleted bucket's name, and titles untitled ones", () => {
    const entries = trashEntries(trash, { bucketName, now });
    expect(entries.find((e) => e.id === "solo")).toMatchObject({
      bucketName: "Inbox",
      title: "Call Ola",
    });
    expect(entries.find((e) => e.id === "in-gone")).toMatchObject({
      bucketName: "Marketing",
      title: "Untitled",
    });
  });

  it("leaves out anything past its 30 days, and nothing is listed before the read", () => {
    const ids = trashEntries(trash, { bucketName, now }).map((e) => e.id);
    expect(ids).not.toContain("old");
    expect(ids).not.toContain("stale");
    expect(trashEntries(null, { bucketName })).toEqual([]);
  });
});

describe("days left and age", () => {
  it("counts whole days left, 0 on the last day", () => {
    expect(trashDaysLeft(daysAgo(0), now)).toBe(30);
    expect(trashDaysLeft(daysAgo(1), now)).toBe(29);
    expect(trashDaysLeft(daysAgo(29.5), now)).toBe(0);
    expect(trashDaysLeft(daysAgo(45), now)).toBe(0);
  });

  it("says when it was deleted", () => {
    expect(trashAgeLabel(daysAgo(0), now)).toBe("Deleted today");
    expect(trashAgeLabel(daysAgo(1), now)).toBe("Deleted yesterday");
    expect(trashAgeLabel(daysAgo(3), now)).toBe("Deleted 3 days ago");
  });
});
