// tasks-v2 Q1-4, U6-2 — deleting a bucket asks first, with the task count, and
// asks where the tasks go: to Inbox (the default) or deleted too. (The Undo
// toast that follows is the hook's: delete-bucket.test.tsx.)

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Bucket } from "../model";
import { bucketTaskChoices, bucketTasksLine, DeleteBucketDialog } from "./delete-bucket-dialog";

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
  it("states the count", () => {
    expect(bucketTasksLine(12, 12)).toBe("It has 12 tasks.");
    expect(bucketTasksLine(1, 1)).toBe("It has 1 task.");
    expect(bucketTasksLine(0, 0)).toBe("It has no tasks.");
  });

  it("names the open share when done tasks are counted too (the rail shows open ones)", () => {
    expect(bucketTasksLine(5, 3)).toBe("It has 5 tasks (3 open).");
    expect(bucketTasksLine(2, 0)).toBe("It has 2 tasks (all done).");
    expect(bucketTasksLine(1, 0)).toBe("It has 1 task (done).");
  });

  it("words the two choices with the count", () => {
    expect(bucketTaskChoices(12)).toEqual({
      move: "Move the 12 tasks to Inbox",
      delete: "Delete the 12 tasks too",
    });
    expect(bucketTaskChoices(1)).toEqual({
      move: "Move the task to Inbox",
      delete: "Delete the task too",
    });
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

  it("names the bucket and its task count, with Move to Inbox chosen", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Delete “Marketing”?" })).toBeTruthy();
    expect(screen.getByText("It has 12 tasks.")).toBeTruthy();
    const move = screen.getByRole("radio", { name: "Move the 12 tasks to Inbox" });
    const del = screen.getByRole("radio", { name: "Delete the 12 tasks too" });
    expect(move.getAttribute("aria-checked")).toBe("true");
    expect(del.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("You can restore it from Recently deleted for 30 days.")).toBeTruthy();
  });

  it("deletes only on the destructive button, moving the tasks by default", () => {
    const { onConfirm, onClose } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Delete bucket" }));
    expect(onConfirm).toHaveBeenCalledWith(marketing, false);
  });

  it("deletes the tasks too when that's chosen", () => {
    const { onConfirm } = renderDialog();
    fireEvent.click(screen.getByRole("radio", { name: "Delete the 12 tasks too" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete bucket" }));
    expect(onConfirm).toHaveBeenCalledWith(marketing, true);
  });

  it("offers no choice for an empty bucket", () => {
    const onConfirm = rs.fn();
    render(
      <DeleteBucketDialog
        bucket={marketing}
        open
        taskCount={0}
        openCount={0}
        onConfirm={onConfirm}
        onClose={rs.fn()}
      />,
    );
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete bucket" }));
    expect(onConfirm).toHaveBeenCalledWith(marketing, false);
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
