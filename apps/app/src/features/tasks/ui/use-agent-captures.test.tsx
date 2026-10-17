// TV-U13b — the Inbox's agent chip reads each task's creation once, batched,
// and only while the Inbox is open.

import { describe, expect, it, rs } from "@rstest/core";
import { renderHook, waitFor } from "@testing-library/react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { useAgentCaptures } from "./use-agent-captures";

function runtimeWith(
  answer: (ids: readonly string[]) => Promise<Array<{ taskId: string; label: string }>>,
) {
  const listAgentCaptures = rs.fn(({ taskIds }: { taskIds: readonly string[] }) => answer(taskIds));
  return {
    runtime: { tasks: { listAgentCaptures } } as unknown as ModuoRuntime,
    listAgentCaptures,
  };
}

describe("useAgentCaptures", () => {
  it("reads the key's name per task, once, and only the new ids later", async () => {
    const { runtime, listAgentCaptures } = runtimeWith(async (ids) =>
      ids.includes("a") ? [{ taskId: "a", label: "Maciej · via Claude Desktop" }] : [],
    );
    const hook = renderHook(
      ({ ids }: { ids: string[] }) => useAgentCaptures(runtime, "w1", ids, true),
      { initialProps: { ids: ["a", "b", "tmp-1"] } },
    );
    await waitFor(() => expect(hook.result.current.get("a")).toBe("Claude Desktop"));
    expect(hook.result.current.has("b")).toBe(false);
    expect(listAgentCaptures).toHaveBeenCalledWith({ workspaceId: "w1", taskIds: ["a", "b"] });
    hook.rerender({ ids: ["c", "a", "b"] });
    await waitFor(() => expect(listAgentCaptures).toHaveBeenCalledTimes(2));
    expect(listAgentCaptures.mock.calls[1]?.[0]).toEqual({ workspaceId: "w1", taskIds: ["c"] });
  });

  it("asks nothing while the Inbox isn't open", () => {
    const { runtime, listAgentCaptures } = runtimeWith(async () => []);
    renderHook(() => useAgentCaptures(runtime, "w1", ["a"], false));
    expect(listAgentCaptures).not.toHaveBeenCalled();
  });

  it("a failed read is asked again on the next change", async () => {
    let fail = true;
    const { runtime, listAgentCaptures } = runtimeWith(async () => {
      if (fail) throw new Error("Failed to fetch");
      return [{ taskId: "a", label: "Cursor" }];
    });
    const hook = renderHook(
      ({ ids }: { ids: string[] }) => useAgentCaptures(runtime, "w1", ids, true),
      { initialProps: { ids: ["a"] } },
    );
    await waitFor(() => expect(listAgentCaptures).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    fail = false;
    hook.rerender({ ids: ["a", "b"] });
    await waitFor(() => expect(hook.result.current.get("a")).toBe("Cursor"));
    expect(listAgentCaptures.mock.calls[1]?.[0]).toEqual({
      workspaceId: "w1",
      taskIds: ["a", "b"],
    });
  });
});
