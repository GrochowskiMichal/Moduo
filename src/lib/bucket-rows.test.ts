// TV-U6 — bucket rows: field-level edits, colour and archive read back, the
// archived split every bundle reader relies on, and Recently deleted's rows.

import { describe, expect, it } from "@rstest/core";

import {
  bucketPatchToColumns,
  bucketRowToModel,
  splitArchived,
  trashFromRows,
} from "./bucket-rows";

const T = "2026-10-09T00:00:00.000Z";
const row = (extra: Record<string, unknown> = {}) => ({
  id: "b1",
  workspace_id: "w",
  owner_id: "u",
  name: "Marketing",
  is_system: false,
  group_label: null,
  position: "0000000100",
  created_at: T,
  updated_at: T,
  deleted_at: null,
  ...extra,
});
const taskRow = (id: string, bucketId: string, extra: Record<string, unknown> = {}) => ({
  id,
  workspace_id: "w",
  owner_id: "u",
  assignee_id: "u",
  bucket_id: bucketId,
  title: id,
  status: "todo",
  created_at: T,
  updated_at: T,
  deleted_at: null,
  ...extra,
});

describe("bucketPatchToColumns", () => {
  it("sends only the changed columns, named the database's way", () => {
    expect(bucketPatchToColumns({ color: "teal" }, T)).toEqual({ color: "teal", updated_at: T });
    expect(bucketPatchToColumns({ group: null, position: "x" }, T)).toEqual({
      group_label: null,
      position: "x",
      updated_at: T,
    });
    expect(bucketPatchToColumns({ archivedAt: T, name: "Ops" }, T)).toEqual({
      archived_at: T,
      name: "Ops",
      updated_at: T,
    });
    // Never deleted_at: a bucket edit can't bring back a deleted bucket.
    expect(bucketPatchToColumns({ deletedAt: null } as never, T)).toEqual({ updated_at: T });
  });
});

describe("bucketRowToModel", () => {
  it("reads colour and archive, and a row from before the migration as neither", () => {
    expect(bucketRowToModel(row({ color: "teal", archived_at: T }))).toMatchObject({
      color: "teal",
      archivedAt: T,
    });
    expect(bucketRowToModel(row())).toMatchObject({ color: null, archivedAt: null });
  });
});

describe("splitArchived", () => {
  it("keeps archived buckets and their tasks apart from the live ones", () => {
    const live = bucketRowToModel(row());
    const archived = bucketRowToModel(row({ id: "b2", archived_at: T }));
    const tasks = [
      { id: "t1", bucketId: "b1" },
      { id: "t2", bucketId: "b2" },
    ] as never[];
    const split = splitArchived([live, archived], tasks);
    expect(split.buckets.map((b) => b.id)).toEqual(["b1"]);
    expect(split.archivedBuckets?.map((b) => b.id)).toEqual(["b2"]);
    expect(split.tasks.map((t: { id: string }) => t.id)).toEqual(["t1"]);
    expect(split.archivedTasks?.map((t: { id: string }) => t.id)).toEqual(["t2"]);
  });

  it("never treats the Inbox as archived", () => {
    const inbox = bucketRowToModel(row({ id: "in", is_system: true, archived_at: T }));
    expect(splitArchived([inbox], []).buckets).toHaveLength(1);
  });
});

describe("trashFromRows", () => {
  it("reads batches and moved tasks, skipping a malformed row", () => {
    const trash = trashFromRows(
      [
        row({ deleted_at: T, deleted_batch_id: "batch", trash_moved_task_ids: ["t9"] }),
        { id: "broken" },
      ],
      [
        taskRow("t1", "b1", { deleted_at: T, deleted_batch_id: "batch" }),
        taskRow("t2", "b1", { deleted_at: T }),
      ],
    );
    expect(trash.buckets).toEqual([
      expect.objectContaining({ batchId: "batch", movedTaskIds: ["t9"] }),
    ]);
    expect(trash.buckets[0]?.bucket.deletedAt).toBe(T);
    expect(trash.tasks.map((t) => [t.task.id, t.batchId])).toEqual([
      ["t1", "batch"],
      ["t2", null],
    ]);
  });
});
