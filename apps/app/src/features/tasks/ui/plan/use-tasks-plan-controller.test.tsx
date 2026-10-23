// `useTasksPlanController`: the whole plan view's state, rendered without its
// layout. Where it opens, a deep link landing on its task's project while
// another place is remembered (DF-1), and the cursor mirrored at rest.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";

import { workspaceStore } from "../../../../lib/sync/store";
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from "../../../workspaces/workspace-context";
import { makeTask } from "../../helpers";
import type { Bucket, Task } from "../../model";
import { FakeTasksProvider, fakeTasksRuntime, type FakeTasksSeed } from "../../testing/fake-tasks";
import type { TasksPlanViewProps } from "./plan-base";
import { useTasksPlanController } from "./use-tasks-plan-controller";

const WS = "ws-ctrl";
const USER = "u1";

function bucket(id: string, name: string, position: string): Bucket {
  return {
    id,
    workspaceId: WS,
    ownerId: USER,
    name,
    isSystem: id === "inbox",
    group: null,
    position,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

function task(id: string, bucketId: string): Task {
  return { ...makeTask({ workspaceId: WS, bucketId, title: id, position: id }), id };
}

/** Your Inbox and two projects; Moduo App holds two tasks, Landing one. */
const TASKS = [task("a1", "b-app"), task("a2", "b-app"), task("l1", "b-landing")];
const SEED: FakeTasksSeed = {
  buckets: [
    bucket("inbox", "Inbox", "0"),
    bucket("b-app", "Moduo App", "a"),
    bucket("b-landing", "Landing", "b"),
  ],
  tasks: TASKS,
};

const MEMBERS = [
  { userId: USER, displayName: "Maciej", isActive: true, removedAt: null, perms: ["tasks.edit"] },
];

type Props = Partial<TasksPlanViewProps>;

/** The controller under the page's provider, its store already read (a warm page). */
async function setup(over: Props = {}) {
  const places: string[] = [];
  const ids: Array<string | null> = [];
  const fake = fakeTasksRuntime(SEED);
  const store = workspaceStore(fake.runtime, USER, WS);
  const release = store.acquire();
  await store.whenRest();
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <WorkspaceContext.Provider value={{ members: MEMBERS } as unknown as WorkspaceContextValue}>
        <FakeTasksProvider runtime={fake.runtime} userId={USER} workspaceId={WS}>
          {children}
        </FakeTasksProvider>
      </WorkspaceContext.Provider>
    );
  }
  const hook = renderHook(
    (p: Props) =>
      useTasksPlanController({
        workspaceId: WS,
        runtime: null,
        urlTaskId: null,
        onUrlTaskIdChange: (id) => ids.push(id),
        onUrlPlaceChange: (place) => places.push(place),
        ...p,
      }),
    { initialProps: over, wrapper: Wrapper },
  );
  release();
  return { ...hook, places, ids };
}

afterEach(() => window.localStorage.clear());

describe("useTasksPlanController", () => {
  it("opens where you left Tasks and names it in the address bar", async () => {
    window.localStorage.setItem(`moduo:tasks:lastBucket:${WS}`, "b-landing");
    const { result, places } = await setup();
    expect(result.current.selection).toBe("b-landing");
    expect(result.current.place).toBe("b-landing");
    expect(places).toEqual(["b-landing"]);
  });

  it("a deep link opens its task's project, not the remembered one (DF-1)", async () => {
    window.localStorage.setItem(`moduo:tasks:lastBucket:${WS}`, "b-landing");
    const target = TASKS.find((t) => t.bucketId === "b-app" && !t.parentId);
    if (!target) throw new Error("fixture has no b-app task");
    const { result, places } = await setup({ urlTaskId: target.id });
    expect(result.current.selectedTaskId).toBe(target.id);
    expect(result.current.place).toBe("b-app");
    // The default never reached the address bar ahead of the link.
    expect(places).toEqual(["b-app"]);
  });

  it("mirrors the cursor into the address bar once it rests", async () => {
    // The store is read before the clock is faked: its timers run for real.
    const { result, ids } = await setup({ urlPlace: "b-app" });
    rs.useFakeTimers();
    try {
      const next = result.current.scopeTasks.find((t) => t.id !== result.current.selectedTaskId);
      if (!next) throw new Error("fixture project has one task");
      act(() => result.current.setSelectedTaskId(next.id));
      expect(ids).toEqual([]);
      act(() => rs.advanceTimersByTime(300));
      expect(ids.at(-1)).toBe(next.id);
    } finally {
      rs.useRealTimers();
    }
  });
});
