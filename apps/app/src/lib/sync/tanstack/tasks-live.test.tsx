// TS-3b: a task's subtasks as a narrow live query over the store's shown rows.
// They answer on the first render (a warm panel never flashes empty), hand
// back the store's own objects, follow a teammate's edit and an optimistic
// one, and stay put when another task changes.

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, renderHook } from "@testing-library/react";

import type { Task } from "../../../features/tasks/model";
import { fakeTasksRuntime } from "../../../features/tasks/testing/fake-tasks";
import { workspaceStore } from "../store";
import { useLiveSubtasks } from "./tasks-live";

afterEach(cleanup);

const NOW = "2026-10-01T00:00:00.000Z";
const LATER = "2026-10-02T00:00:00.000Z";

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    workspaceId: "w1",
    creatorId: "u1",
    creatorUnknown: false,
    assigneeId: "u1",
    bucketId: "b1",
    parentId: null,
    title: id,
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
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}

async function openStore() {
  const fake = fakeTasksRuntime({
    buckets: [
      {
        id: "b1",
        workspaceId: "w1",
        ownerId: "u1",
        name: "Work",
        isSystem: false,
        group: null,
        position: "a",
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    tasks: [
      task("p"),
      task("other"),
      task("s2", { parentId: "p", position: "2" }),
      task("s1", { parentId: "p", position: "1" }),
      task("gone", { parentId: "p", deletedAt: NOW }),
      task("old", { parentId: "p", status: "archived" }),
    ],
  });
  const store = workspaceStore(fake.runtime, "u1", "w1");
  const release = store.acquire();
  await store.whenRest();
  const stored = (id: string) => store.getSnapshot().bundle.tasks.find((t) => t.id === id);
  return { store, release, stored };
}

describe("per-task live queries (TS-3b)", () => {
  it("answer on the first render with the store's own objects", async () => {
    const { store, release, stored } = await openStore();
    const { result } = renderHook(() => ({ subtasks: useLiveSubtasks(store, "p") }));
    expect(result.current.subtasks.map((t) => t.id)).toEqual(["s1", "s2"]);
    expect(result.current.subtasks[0]).toBe(stored("s1"));
    release();
  });

  it("follow a change to their rows, and keep identity for a change elsewhere", async () => {
    const { store, release, stored } = await openStore();
    const { result } = renderHook(() => ({ subtasks: useLiveSubtasks(store, "p") }));
    const subtasks = result.current.subtasks;
    // A teammate renames another task: nothing here moves.
    act(() =>
      store.answer({ tasks: [{ ...(stored("other") as Task), title: "x", updatedAt: LATER }] }),
    );
    expect(result.current.subtasks).toBe(subtasks);
    // A teammate renames a subtask: the list follows, with the store's object.
    act(() =>
      store.answer({ tasks: [{ ...(stored("s2") as Task), title: "Two", updatedAt: LATER }] }),
    );
    expect(result.current.subtasks.map((t) => t.title)).toEqual(["s1", "Two"]);
    expect(result.current.subtasks[1]).toBe(stored("s2"));
    release();
  });
});
