// `useTasksPlanController`: the whole plan view's state, rendered without its
// layout. Where it opens, a deep link landing on its task's project while
// another place is remembered (DF-1), and the cursor mirrored at rest.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import type { TasksModuleApi } from "../../hooks/use-tasks-module";
import { BUCKETS, INBOX, stubApi, TASKS, TeamWorkspace } from "../tasks-stories-fixtures";
import type { TasksPlanViewProps } from "./plan-base";
import { useTasksPlanController } from "./use-tasks-plan-controller";

const WS = "ws-ctrl";

function api(): TasksModuleApi {
  return stubApi(TASKS, {
    canEdit: true,
    buckets: BUCKETS,
    inbox: INBOX,
    archivedBuckets: [],
    archivedTasks: [],
    areas: [],
    teams: [],
    teamMembers: [],
    sections: [],
    views: [],
    sessions: [],
    trash: [],
    completions: [],
    attachmentCounts: new Map(),
    queuedTasks: [],
    queueCount: 0,
    openTaskCountByBucket: new Map(),
    driftCountByBucket: new Map(),
    reachedServer: true,
    error: null,
    truncated: null,
    currentUserId: "u1",
    openTrashRef: { current: null },
    frontierFor: () => [],
    tags: [],
  });
}

type Props = Partial<TasksPlanViewProps>;

function setup(over: Props = {}) {
  const places: string[] = [];
  const ids: Array<string | null> = [];
  const moduleApi = api();
  const hook = renderHook(
    (p: Props) =>
      useTasksPlanController({
        api: moduleApi,
        workspaceId: WS,
        runtime: null,
        urlTaskId: null,
        onUrlTaskIdChange: (id) => ids.push(id),
        onUrlPlaceChange: (place) => places.push(place),
        ...p,
      }),
    { initialProps: over, wrapper: TeamWorkspace },
  );
  return { ...hook, places, ids };
}

afterEach(() => window.localStorage.clear());

describe("useTasksPlanController", () => {
  it("opens where you left Tasks and names it in the address bar", () => {
    window.localStorage.setItem(`moduo:tasks:lastBucket:${WS}`, "b-landing");
    const { result, places } = setup();
    expect(result.current.selection).toBe("b-landing");
    expect(result.current.place).toBe("b-landing");
    expect(places).toEqual(["b-landing"]);
  });

  it("a deep link opens its task's project, not the remembered one (DF-1)", () => {
    window.localStorage.setItem(`moduo:tasks:lastBucket:${WS}`, "b-landing");
    const target = TASKS.find((t) => t.bucketId === "b-app" && !t.parentId);
    if (!target) throw new Error("fixture has no b-app task");
    const { result, places } = setup({ urlTaskId: target.id });
    expect(result.current.selectedTaskId).toBe(target.id);
    expect(result.current.place).toBe("b-app");
    // The default never reached the address bar ahead of the link.
    expect(places).toEqual(["b-app"]);
  });

  it("mirrors the cursor into the address bar once it rests", () => {
    rs.useFakeTimers();
    try {
      const { result, ids } = setup({ urlPlace: "b-app" });
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
