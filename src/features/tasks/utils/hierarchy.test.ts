import { describe, expect, it } from "vitest";
import { buildTaskTree, flattenTaskTree } from "./hierarchy";
import type { Task } from "../types";

const now = new Date().toISOString();

function task(partial: Partial<Task> & Pick<Task, "id">): Task {
  const { id, ...rest } = partial;
  return {
    ...rest,
    id,
    workspaceId: "workspace",
    ownerId: "owner",
    projectId: "project",
    parentTaskId: null,
    stateId: "state",
    assigneeId: null,
    title: partial.id,
    description: "",
    tags: partial.tags ?? [],
    priority: 2,
    dueDate: null,
    position: "0000000000000000",
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
}

describe("task hierarchy", () => {
  it("builds and flattens ordered tree", () => {
    const tree = buildTaskTree([
      task({ id: "a", position: "0002" }),
      task({ id: "b", position: "0001" }),
      task({ id: "c", parentTaskId: "b", position: "0001" }),
      task({ id: "d", parentTaskId: "b", position: "0002" }),
    ]);

    const flat = flattenTaskTree(tree);

    expect(flat.map((entry) => entry.id)).toEqual(["b", "c", "d", "a"]);
    expect(flat.map((entry) => entry.depth)).toEqual([0, 1, 1, 0]);
  });
});
