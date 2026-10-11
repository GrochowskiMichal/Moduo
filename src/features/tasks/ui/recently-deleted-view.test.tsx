// tasks-v2 U6-3 — Recently deleted: one row per bucket batch or lone task, with
// Restore and Delete forever (which asks first), and nothing to act on for
// someone who can't edit.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Bucket, Task, TasksTrash } from "../model";
import { RecentlyDeletedView, trashEntryMeta, trashLeftLabel } from "./recently-deleted-view";

afterEach(cleanup);

// A day ago, give or take the time the test takes.
const D = new Date(Date.now() - 86_400_000 + 60_000).toISOString();
const bucket = {
  id: "mkt",
  workspaceId: "w",
  ownerId: "u",
  name: "Marketing",
  isSystem: false,
  group: null,
  position: "a",
  createdAt: D,
  updatedAt: D,
  deletedAt: D,
} as Bucket;
const task = (id: string, title: string, bucketId: string) =>
  ({ id, title, bucketId, deletedAt: D }) as Task;
const trash: TasksTrash = {
  buckets: [{ bucket, batchId: "b1", movedTaskIds: [] }],
  tasks: [
    { task: task("m1", "Brief", "mkt"), batchId: "b1" },
    { task: task("solo", "Call Ola", "inbox"), batchId: null },
  ],
};

function renderView(canEdit = true) {
  const onRestore = rs.fn();
  const onDeleteForever = rs.fn();
  render(
    <RecentlyDeletedView
      trash={trash}
      bucketName={(id) => (id === "inbox" ? "Inbox" : null)}
      canEdit={canEdit}
      onRestore={onRestore}
      onDeleteForever={onDeleteForever}
    />,
  );
  return { onRestore, onDeleteForever };
}

describe("RecentlyDeletedView (U6-3)", () => {
  it("lists a bucket with its batch as one row, and a task deleted on its own", () => {
    renderView();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Bucket · 1 task deleted with it")).toBeTruthy();
    expect(screen.getByText("Task · Inbox")).toBeTruthy();
    expect(screen.getAllByText("29 days left")).toHaveLength(2);
  });

  it("restores the whole bucket from its row", () => {
    const { onRestore } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "Restore Marketing" }));
    expect(onRestore).toHaveBeenCalledWith({ kind: "bucket", id: "mkt" }, "Marketing");
  });

  it("asks before Delete forever, and says what goes with it", () => {
    const { onDeleteForever } = renderView();
    fireEvent.click(screen.getByRole("button", { name: "Delete Marketing forever" }));
    expect(screen.getByRole("dialog", { name: "Delete “Marketing” forever?" })).toBeTruthy();
    expect(
      screen.getByText(
        "It and the task deleted with it are deleted now, files included. This can’t be undone.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onDeleteForever).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Call Ola forever" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(onDeleteForever).toHaveBeenCalledWith({ kind: "task", id: "solo" });
  });

  it("offers no actions to someone who can't edit", () => {
    renderView(false);
    expect(screen.queryByRole("button", { name: /^Restore/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /forever$/ })).toBeNull();
  });

  it("shows an empty state once everything is restored", () => {
    render(
      <RecentlyDeletedView
        trash={{ buckets: [], tasks: [] }}
        bucketName={() => null}
        canEdit
        onRestore={rs.fn()}
        onDeleteForever={rs.fn()}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});

describe("row copy", () => {
  it("describes buckets by what happened to their tasks", () => {
    const base = { kind: "bucket", id: "b", name: "B", color: "gray", deletedAt: D } as const;
    expect(trashEntryMeta({ ...base, deletedTasks: 3, movedTasks: 0 })).toBe(
      "Bucket · 3 tasks deleted with it",
    );
    expect(trashEntryMeta({ ...base, deletedTasks: 0, movedTasks: 1 })).toBe(
      "Bucket · 1 task moved to Inbox",
    );
    expect(trashEntryMeta({ ...base, deletedTasks: 0, movedTasks: 0 })).toBe("Bucket");
    expect(
      trashEntryMeta({ kind: "task", id: "t", title: "T", deletedAt: D, bucketName: null }),
    ).toBe("Task");
  });

  it("counts down to the purge", () => {
    const now = new Date("2026-10-09T12:00:00.000Z");
    expect(trashLeftLabel("2026-10-09T11:00:00.000Z", now)).toBe("29 days left");
    expect(trashLeftLabel("2026-09-11T00:00:00.000Z", now)).toBe("1 day left");
    expect(trashLeftLabel("2026-09-10T00:00:00.000Z", now)).toBe("Last day");
  });
});
