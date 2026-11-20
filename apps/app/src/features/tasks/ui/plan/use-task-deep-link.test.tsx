// `useTaskDeepLink`: a link arriving in the address bar is applied once, the
// cursor is mirrored back at rest, and the mirror's own write isn't a link.

import { describe, expect, it, rs } from "@rstest/core";
import { act, renderHook } from "@testing-library/react";

import type { DeepLinkWorld } from "./deep-link";
import {
  type DeepLinkApply,
  type TaskDeepLinkInput,
  URL_MIRROR_DEBOUNCE_MS,
  useDeepLinkMachine,
  useTaskDeepLink,
} from "./use-task-deep-link";

const world: DeepLinkWorld = {
  ready: true,
  restLoaded: true,
  handleStep: () => null,
  target: (id) =>
    id.startsWith("t") ? { kind: "task", taskId: id, scope: "projA" } : { kind: "none" },
  inScope: () => true,
  canLookup: false,
};

type Props = Omit<TaskDeepLinkInput, "onApply" | "onPrivate" | "onUrlTaskIdChange">;

function setup(initial: Props) {
  const applied: DeepLinkApply[] = [];
  const writes: Array<string | null> = [];
  const hook = renderHook(
    (p: Props) => {
      const machine = useDeepLinkMachine(p.urlTaskId);
      useTaskDeepLink(machine, {
        ...p,
        onApply: (c) => applied.push(c),
        onPrivate: () => {},
        onUrlTaskIdChange: (id) => writes.push(id),
      });
      return machine.settled;
    },
    { initialProps: initial },
  );
  return { ...hook, applied, writes };
}

const base: Props = {
  urlTaskId: null,
  world,
  lookup: null,
  loaded: true,
  selectedTaskId: null,
  selectedLinkId: null,
};

describe("useTaskDeepLink", () => {
  it("applies an arriving link once, then mirrors the cursor back at rest", () => {
    rs.useFakeTimers();
    try {
      const { result, rerender, applied, writes } = setup({ ...base, urlTaskId: "t1" });
      expect(applied).toEqual([{ kind: "openTask", taskId: "t1", snapTo: null, external: false }]);
      expect(result.current).toBe(true);
      // The cursor lands on it: nothing to write.
      rerender({ ...base, urlTaskId: "t1", selectedTaskId: "t1", selectedLinkId: "t1" });
      // j/k: only the resting cursor is written.
      rerender({ ...base, urlTaskId: "t1", selectedTaskId: "t2", selectedLinkId: "t2" });
      rerender({ ...base, urlTaskId: "t1", selectedTaskId: "t3", selectedLinkId: "t3" });
      act(() => rs.advanceTimersByTime(URL_MIRROR_DEBOUNCE_MS));
      expect(writes).toEqual(["t3"]);
      // The write arrives back: not a link, nothing applied again.
      rerender({ ...base, urlTaskId: "t3", selectedTaskId: "t3", selectedLinkId: "t3" });
      expect(applied).toHaveLength(1);
    } finally {
      rs.useRealTimers();
    }
  });

  it("holds the mirror while a link waits for the bundle", () => {
    rs.useFakeTimers();
    try {
      const waiting = { ...world, ready: false };
      const { result, rerender, writes, applied } = setup({
        ...base,
        world: waiting,
        urlTaskId: "t9",
        selectedTaskId: "t1",
        selectedLinkId: "t1",
      });
      expect(result.current).toBe(false);
      act(() => rs.advanceTimersByTime(URL_MIRROR_DEBOUNCE_MS * 4));
      expect(writes).toEqual([]);
      rerender({ ...base, urlTaskId: "t9", selectedTaskId: "t1", selectedLinkId: "t1" });
      expect(applied).toEqual([{ kind: "openTask", taskId: "t9", snapTo: null, external: false }]);
    } finally {
      rs.useRealTimers();
    }
  });
});
