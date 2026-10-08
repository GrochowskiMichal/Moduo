// tasks-v2 Q1-4 — deleting a bucket asks first, with the task count and where the
// tasks go. (The Undo toast that follows is the hook's; see the manual checklist.)

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Bucket } from "../model";
import { bucketTasksLine, DeleteBucketDialog } from "./delete-bucket-dialog";

afterEach(cleanup);

const marketing: Bucket = {
  id: "b-marketing",
  workspaceId: "w",
  ownerId: "u",
  name: "Marketing",
  isSystem: false,
  group: null,
  position: "a",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  deletedAt: null,
};

describe("bucketTasksLine", () => {
  it("states the count and that the tasks move to Inbox", () => {
    expect(bucketTasksLine(12, 12)).toBe("It has 12 tasks, which will move to Inbox.");
    expect(bucketTasksLine(1, 1)).toBe("It has 1 task, which will move to Inbox.");
    expect(bucketTasksLine(0, 0)).toBe("It has no tasks.");
  });

  it("names the open share when done tasks are counted too (the rail shows open ones)", () => {
    expect(bucketTasksLine(5, 3)).toBe("It has 5 tasks (3 open), which will move to Inbox.");
    expect(bucketTasksLine(2, 0)).toBe("It has 2 tasks (all done), which will move to Inbox.");
    expect(bucketTasksLine(1, 0)).toBe("It has 1 task (done), which will move to Inbox.");
  });
});

describe("DeleteBucketDialog", () => {
  function renderDialog() {
    const onConfirm = rs.fn();
    const onClose = rs.fn();
    render(
      <DeleteBucketDialog
        bucket={marketing}
        open
        taskCount={12}
        openCount={12}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );
    return { onConfirm, onClose };
  }

  it("names the bucket and its task count", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Delete “Marketing”?" })).toBeTruthy();
    expect(screen.getByText("It has 12 tasks, which will move to Inbox.")).toBeTruthy();
  });

  it("deletes only on the destructive button", () => {
    const { onConfirm, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Delete bucket" }));
    expect(onConfirm).toHaveBeenCalledWith(marketing);
  });

  it("stays closed without a bucket", () => {
    render(
      <DeleteBucketDialog
        bucket={null}
        open
        taskCount={0}
        openCount={0}
        onConfirm={rs.fn()}
        onClose={rs.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
