// A4: the narrow Tasks hooks re-render only on what they read. Commands keep
// their identity across data changes, a slice re-renders only when it moves,
// and one task's reader only when that task changes.

import { describe, expect, it, rs } from "@rstest/core";
import { act, render, waitFor } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";

import type { ModuoRuntime } from "../../lib/runtime.types";
import { makeTask } from "./helpers";
import type { Task, TasksModuleBundle } from "./model";

rs.mock("../../lib/undo-toast", () => ({
  UNDO_TOAST_MS: 5000,
  undoToast: () => {},
}));

// Live updates (TV-D5) need a socket; these tests drive the store without one.
rs.mock("./realtime", () => ({ listenTasksLive: () => () => {} }));

import {
  TasksProvider,
  useTaskById,
  useTaskCommands,
  useTasksSelector,
  useTasksStatus,
} from "./tasks-context";

const BUCKET = {
  id: "b1",
  workspaceId: "w1",
  ownerId: "u1",
  name: "Inbox",
  isSystem: true,
  group: null,
  position: "a",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: id, position: id }),
    id,
    creatorId: "u1",
    assigneeId: "u1",
    ...over,
  };
}

function fakeRuntime(tasks: Task[]) {
  const bundle: TasksModuleBundle = {
    buckets: [BUCKET],
    tasks,
    tags: [],
    tagLinks: [],
    taskRelations: [],
    truncated: [],
  };
  const byId = (id: string) => tasks.find((t) => t.id === id) as Task;
  const api = {
    list: rs.fn(async () => bundle),
    getTimeBlocks: rs.fn(async () => ({})),
    listQueue: rs.fn(async () => []),
    updateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => ({
      ...byId(taskId),
      ...patch,
    })),
    opUpdateTask: rs.fn(async ({ taskId, patch }: { taskId: string; patch: Partial<Task> }) => [
      { ...byId(taskId), ...patch },
    ]),
    opCatchUp: rs.fn(async () => []),
  };
  return { tasks: api } as unknown as ModuoRuntime;
}

/** Counts its renders in an effect (a render React throws away isn't one). */
function useRenderCount(onRender: () => void) {
  useEffect(() => {
    onRender();
  });
}

function Provider({ runtime, children }: { runtime: ModuoRuntime; children: ReactNode }) {
  return (
    <TasksProvider runtime={runtime} userId="u1" workspaceId="w1" modulePermission="edit">
      {children}
    </TasksProvider>
  );
}

function setup() {
  const runtime = fakeRuntime([task("t1"), task("t2")]);
  const renders = { commands: 0, inbox: 0, t1: 0 };
  const seen: {
    commands: ReturnType<typeof useTaskCommands>[];
    t1Titles: (string | null)[];
    inbox: string | null;
    loaded: boolean;
  } = { commands: [], t1Titles: [], inbox: null, loaded: false };

  function CommandsOnly() {
    const commands = useTaskCommands();
    seen.commands.push(commands);
    useRenderCount(() => {
      renders.commands += 1;
    });
    return null;
  }
  function InboxReader() {
    const inbox = useTasksSelector((d) => d.inbox);
    seen.inbox = inbox?.id ?? null;
    useRenderCount(() => {
      renders.inbox += 1;
    });
    return null;
  }
  function TaskReader() {
    const t1 = useTaskById("t1");
    seen.t1Titles.push(t1?.title ?? null);
    useRenderCount(() => {
      renders.t1 += 1;
    });
    return null;
  }
  function Status() {
    seen.loaded = useTasksStatus().loaded;
    return null;
  }
  // The patcher is outside the counted components: it only holds the commands.
  const patcher: { commands: ReturnType<typeof useTaskCommands> | null } = { commands: null };
  function Patcher() {
    patcher.commands = useTaskCommands();
    return null;
  }

  render(
    <Provider runtime={runtime}>
      <CommandsOnly />
      <InboxReader />
      <TaskReader />
      <Status />
      <Patcher />
    </Provider>,
  );
  return { renders, seen, patcher };
}

describe("TasksProvider's narrow hooks (A4)", () => {
  it("a commands-only component never re-renders on a task edit, and keeps one object", async () => {
    const { renders, seen, patcher } = setup();
    await waitFor(() => expect(seen.loaded).toBe(true));
    const before = renders.commands;
    act(() => patcher.commands?.patchTask("t2", { title: "t2 renamed" }));
    await act(async () => {});
    expect(renders.commands).toBe(before);
    expect(new Set(seen.commands).size).toBe(1);
  });

  it("an inbox reader doesn't re-render on a task edit", async () => {
    const { renders, seen, patcher } = setup();
    await waitFor(() => expect(seen.inbox).toBe("b1"));
    const before = renders.inbox;
    act(() => patcher.commands?.patchTask("t1", { title: "t1 renamed" }));
    await act(async () => {});
    expect(renders.inbox).toBe(before);
  });

  it("a task's reader re-renders when that task changes, not when another does", async () => {
    const { renders, seen, patcher } = setup();
    await waitFor(() => expect(seen.t1Titles.at(-1)).toBe("t1"));
    const before = renders.t1;
    act(() => patcher.commands?.patchTask("t2", { title: "t2 renamed" }));
    await act(async () => {});
    expect(renders.t1).toBe(before);

    act(() => patcher.commands?.patchTask("t1", { title: "t1 renamed" }));
    await waitFor(() => expect(seen.t1Titles.at(-1)).toBe("t1 renamed"));
    expect(renders.t1).toBeGreaterThan(before);
  });
});
