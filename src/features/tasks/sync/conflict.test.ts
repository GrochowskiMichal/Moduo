import { describe, expect, it } from "vitest";
import { resolveTaskConflict } from "./conflict";
import type { Task } from "../types";

function makeTask(updatedAt: string): Task {
  return {
    id: "t1",
    workspaceId: "w1",
    ownerId: "o1",
    projectId: "p1",
    taskCode: null,
    parentTaskId: null,
    childOfTaskId: null,
    blockedByTaskIds: [],
    duplicateOfTaskId: null,
    stateId: "s1",
    assigneeId: null,
    title: "Task",
    description: "",
    tags: [],
    priority: 2,
    dueDate: null,
    position: "0001",
    createdAt: "2026-02-17T00:00:00.000Z",
    updatedAt,
    deletedAt: null,
  };
}

describe("resolveTaskConflict", () => {
  it("keeps latest updated task (LWW)", () => {
    const local = makeTask("2026-02-17T10:00:00.000Z");
    const remote = makeTask("2026-02-17T10:01:00.000Z");
    expect(resolveTaskConflict(local, remote)).toEqual(remote);
  });
});
