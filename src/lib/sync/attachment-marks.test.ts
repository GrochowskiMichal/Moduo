// AT-3: the shared store's file marks — the 📎 counts every surface reads and
// the stamp an open strip re-reads on (AT3-3, the live strip refresh).

import { describe, expect, it } from "@rstest/core";
import { LIVE_SIDE_TABLES, parseLiveChange } from "../../features/tasks/live";
import { attachmentMarkRowToModel } from "../task-rows";
import { countAttachments, SYNC_TABLES } from "./store";
import type { AttachmentMark } from "./types";

const mark = (id: string, over: Partial<AttachmentMark> = {}): AttachmentMark => ({
  id,
  taskId: "t1",
  status: "ready",
  updatedAt: "2026-10-14T10:00:00.000000+00:00",
  deletedAt: null,
  ...over,
});

describe("countAttachments", () => {
  it("counts each task's finished, live files", () => {
    const { counts } = countAttachments([
      mark("a"),
      mark("b"),
      mark("c", { taskId: "t2" }),
      mark("d", { deletedAt: "2026-10-14T11:00:00Z" }),
      mark("e", { status: "pending" }),
      mark("f", { status: "failed", taskId: "t3" }),
    ]);
    expect(counts.get("t1")).toBe(2);
    expect(counts.get("t2")).toBe(1);
    // A file still uploading, or one that failed, never counts.
    expect(counts.has("t3")).toBe(false);
  });

  it("moves a task's stamp when one of its files is added, deleted or changed", () => {
    const one = countAttachments([mark("a")]).stamps.get("t1");
    const two = countAttachments([mark("a"), mark("b")]).stamps.get("t1");
    const newer = countAttachments([
      mark("a", { updatedAt: "2026-10-14T12:00:00.000000+00:00" }),
    ]).stamps.get("t1");
    const deleted = countAttachments([
      mark("a", {
        deletedAt: "2026-10-14T12:00:00Z",
        updatedAt: "2026-10-14T12:00:00.000000+00:00",
      }),
    ]).stamps.get("t1");
    expect(new Set([one, two, newer, deleted]).size).toBe(4);
    // A purged file leaves no row: the task's stamp goes, which also moves it.
    expect(countAttachments([]).stamps.get("t1")).toBeUndefined();
  });
});

describe("the store keeps file marks", () => {
  it("reads them as a delta table after the open tasks", () => {
    expect(SYNC_TABLES).toContainEqual({ name: "attachments", delta: true, phase: 2 });
  });

  it("maps a row to its mark only: no name, path or size reaches the copy", () => {
    const m = attachmentMarkRowToModel({
      id: "a1",
      entity_id: "t1",
      status: "ready",
      updated_at: "2026-10-14T10:00:00Z",
      deleted_at: null,
      file_name: "secret.png",
      object_path: "w/a1/original.png",
      size_bytes: 123,
    });
    expect(m).toEqual({
      id: "a1",
      taskId: "t1",
      status: "ready",
      updatedAt: "2026-10-14T10:00:00Z",
      deletedAt: null,
    });
  });
});

describe("Realtime: attachments", () => {
  it("listens on a channel of its own", () => {
    expect(LIVE_SIDE_TABLES).toContain("attachments");
  });

  it("takes finished files on tasks; skips uploads in progress and other kinds of item", () => {
    const row = (over: Record<string, unknown>) => ({
      eventType: "UPDATE",
      new: {
        id: "a1",
        entity_type: "task",
        entity_id: "t1",
        status: "ready",
        updated_at: "2026-10-14T10:00:00Z",
        deleted_at: null,
        ...over,
      },
    });
    expect(parseLiveChange("attachments", row({}))).toEqual({
      table: "attachments",
      kind: "upsert",
      row: {
        id: "a1",
        taskId: "t1",
        status: "ready",
        updatedAt: "2026-10-14T10:00:00Z",
        deletedAt: null,
      },
    });
    expect(parseLiveChange("attachments", row({ status: "pending" }))).toBeNull();
    expect(parseLiveChange("attachments", row({ status: "failed" }))).toBeNull();
    expect(parseLiveChange("attachments", row({ entity_type: "note" }))).toBeNull();
    // A trashed file arrives as a deleted mark (its count drops).
    expect(
      parseLiveChange("attachments", row({ deleted_at: "2026-10-14T11:00:00Z" })),
    ).toMatchObject({
      kind: "upsert",
      row: { deletedAt: "2026-10-14T11:00:00Z" },
    });
    expect(parseLiveChange("attachments", { eventType: "DELETE", old: { id: "a1" } })).toEqual({
      table: "attachments",
      kind: "delete",
      id: "a1",
    });
  });
});
