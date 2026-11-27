// HV-15 variant of benchmarks/escapes/645-2-queue-bypass: Archive (or Done)
// with "Move the open tasks" sends each open task's move straight to the
// server, including a task whose capture still waits in the outbox (being
// flushed). The server doesn't have it yet, refuses the move, and the archive
// is called off half-done. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/tasks/commands/projects.645-2.variant.test.ts

import { describe, expect, it, rs } from "@rstest/core";
import { act, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { findWorkspaceStore } from "../../../lib/sync/store";
import { makeTask } from "../helpers";
import type { Bucket, Task, TasksModuleBundle } from "../model";

const toastMock = rs.hoisted(() =>
  Object.assign(
    rs.fn(() => "t"),
    { dismiss: rs.fn(), error: rs.fn(), message: rs.fn() },
  ),
);
rs.mock("sonner", () => ({ toast: toastMock }));
rs.mock("../realtime", () => ({ listenTasksLive: () => () => {} }));
const undoToastMock = rs.hoisted(() => rs.fn((..._args: unknown[]) => 1));
rs.mock("@/lib/undo-toast", () => ({ UNDO_TOAST_MS: 8000, undoToast: undoToastMock }));

import { renderTasksHook } from "../testing/tasks-hook";

const bucket = (id: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: "w1",
  ownerId: "u1",
  name: id,
  isSystem: false,
  group: null,
  position: id,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  ...over,
});

const task = (id: string, title = id): Task => ({
  ...makeTask({ workspaceId: "w1", bucketId: "p1", title, position: id }),
  id,
  creatorId: "u1",
  assigneeId: "u1",
  updatedAt: "2026-10-20T08:00:00.000Z",
});

/** A server whose first create (the queued capture being flushed) is held until released. */
function fakeServer(tasks: Task[]) {
  const rows = new Map(tasks.map((t) => [t.id, t]));
  const buckets = new Map<string, Bucket>([
    ["inbox", bucket("inbox", { isSystem: true, name: "Inbox" })],
    ["p1", bucket("p1")],
    ["p2", bucket("p2")],
  ]);
  let clock = 0;
  const refusals: string[] = [];
  const stamp = () => {
    clock += 1;
    return new Date(Date.parse("2026-10-20T09:00:00.000Z") + clock * 1000).toISOString();
  };
  const write = async (id: string, patch: Partial<Task>, what = "update") => {
    if (!rows.has(id)) {
      refusals.push(`${what} ${id}`);
      throw Object.assign(new Error("Task not found."), { code: "PGRST116" });
    }
    await new Promise((r) => setTimeout(r, 2));
    const next = { ...(rows.get(id) as Task), ...patch, updatedAt: stamp() };
    rows.set(id, next);
    return next;
  };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const bundle = (): TasksModuleBundle => ({
    buckets: [...buckets.values()],
    tasks: [...rows.values()],
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  });
  const api = {
    list: rs.fn(async () => bundle()),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => []),
    opCatchUp: rs.fn(async () => []),
    listTrash: rs.fn(async () => ({ buckets: [], tasks: [] })),
    createTask: rs.fn(async (t: Task) => {
      await gate;
      const saved = { ...t, updatedAt: stamp() };
      rows.set(t.id, saved);
      return saved;
    }),
    updateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) =>
      write(taskId, patch),
    ),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => [
      await write(taskId, patch, "move"),
    ]),
    opSetStatus: rs.fn(({ taskId, status }: { taskId: string; status: string }) =>
      write(taskId, { status, statusCategory: status } as Partial<Task>, "status"),
    ),
    updateProject: rs.fn(
      async ({ projectId, patch }: { projectId: string; patch: { archived?: boolean } }) => {
        const prev = buckets.get(projectId) as Bucket;
        const saved: Bucket = {
          ...prev,
          ...(patch.archived !== undefined
            ? { archivedAt: patch.archived ? "2026-10-20T10:00:00.000Z" : null }
            : {}),
          updatedAt: stamp(),
        };
        buckets.set(projectId, saved);
        return saved;
      },
    ),
  };
  return { runtime: { tasks: api } as unknown as ModuoRuntime, rows, buckets, release, refusals };
}

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt(
  "HV-15 variant 645-2: a project's Move sends a task's move ahead of its waiting capture",
  () => {
    it("Archive with Move waits for (or says Still saving about) a capture still in the outbox", async () => {
      const server = fakeServer([task("a")]);
      const hook = renderTasksHook(server.runtime, {
        userId: "u1",
        workspaceId: "w1",
        modulePermission: "edit",
      });
      await waitFor(() => expect(hook.result.current.loading).toBe(false));
      const store = findWorkspaceStore(server.runtime, "w1");
      if (!store) throw new Error("no store");
      // A task captured offline into p1 waits in the outbox; the flush is sending it now.
      await act(async () => {
        store.enqueue({ kind: "create", id: "op-cap", task: task("n", "Call Ana") });
        await new Promise((r) => setTimeout(r, 5));
      });
      expect(store.isQueuedCreate("n")).toBe(true);

      await act(async () => {
        hook.result.current.commands.archiveBucket("p1", { kind: "move", projectId: "p2" });
        await new Promise((r) => setTimeout(r, 20));
      });
      await act(async () => {
        server.release();
        await new Promise((r) => setTimeout(r, 60));
      });

      // Nothing for the waiting capture reached the server before it.
      expect(server.refusals).toEqual([]);
      // Either the whole close went through (both open tasks in p2, p1 archived)
      // or it said "Still saving" and moved nothing: never half of it.
      const stillSaving = [...toastMock.error.mock.calls, ...toastMock.mock.calls].some((c) =>
        JSON.stringify(c).toLowerCase().includes("still saving"),
      );
      const inP2 = [...server.rows.values()].filter((t) => t.bucketId === "p2").map((t) => t.id);
      if (stillSaving) expect(inP2).toEqual([]);
      else {
        expect(inP2.sort()).toEqual(["a", "n"]);
        expect(server.buckets.get("p1")?.archivedAt).toBeTruthy();
      }
    });
  },
);
