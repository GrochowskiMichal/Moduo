import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render, screen } from "@testing-library/react";

import {
  __resetFocusEngineForTest,
  attachFocusUser,
  bindFocusTask,
  registerFocusFlushSink,
  startFocus,
  stopFocus,
} from "../../features/focus/engine";
import {
  __resetQueueRunForTest,
  attachRunUser,
  refreshQueueRun,
  startQueueRun,
} from "../../features/focus/run";
import type { FocusRunRuntime } from "../../features/focus/run-model";
import { TooltipProvider } from "../ui/tooltip";
import { FocusSessionChip } from "./focus-session-chip";

function runtime(
  latest: Awaited<ReturnType<FocusRunRuntime["latestRun"]>> = null,
): FocusRunRuntime {
  return {
    latestRun: async () => latest,
    startRun: async () => null,
    saveRun: async () => null,
    endRun: async () => null,
    listClaims: async () => [],
    keepLineUp: async () => null,
  };
}

rs.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));

beforeEach(() => {
  rs.useFakeTimers();
  localStorage.clear();
  __resetFocusEngineForTest({ alert: () => {} });
  __resetQueueRunForTest();
  attachFocusUser("u1");
});

afterEach(() => {
  cleanup();
  __resetQueueRunForTest();
  __resetFocusEngineForTest();
  rs.useRealTimers();
});

describe("FocusSessionChip", () => {
  it("shows the running session, and after Stop keeps unsaved time visible (F1-7)", async () => {
    registerFocusFlushSink("ws-1", () => Promise.resolve(false)); // saves fail
    render(
      <TooltipProvider>
        <FocusSessionChip />
      </TooltipProvider>,
    );
    act(() => {
      bindFocusTask({ id: "t1", title: "Write spec", bucketName: "Inbox", workspaceId: "ws-1" });
      startFocus();
    });
    act(() => {
      rs.advanceTimersByTime(30_000);
    });
    expect(screen.queryByText("Write spec")).not.toBeNull();
    await act(async () => {
      stopFocus();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(screen.queryByText("Write spec")).toBeNull();
    expect(screen.queryByText("Focus time not saved yet")).not.toBeNull();
  });

  it("follows the queue run: phase, clock and the Now task (F2-3)", () => {
    attachRunUser("u1", { focus: runtime() }, { subscribe: null });
    render(
      <TooltipProvider>
        <FocusSessionChip />
      </TooltipProvider>,
    );
    act(() => {
      startQueueRun({
        workspaceId: "ws-1",
        mode: "pomodoro",
        task: { id: "t1", title: "Write spec", bucketName: "Inbox", workspaceId: "ws-1" },
      });
    });
    act(() => {
      rs.advanceTimersByTime(60_000);
    });
    expect(screen.queryByText("Write spec")).not.toBeNull();
    expect(screen.queryByText("Focus 24:00")).not.toBeNull();
  });

  it("shows a run another device is running, read through (F2-4)", async () => {
    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();
    attachRunUser(
      "u1",
      {
        focus: runtime({
          id: "r1",
          workspaceId: "ws-1",
          userId: "u1",
          status: "running",
          mode: "stopwatch",
          startedAt: iso(now - 90_000),
          endedAt: null,
          nowTaskId: "t1",
          phase: "work",
          phaseStartedAt: iso(now - 90_000),
          phaseSeconds: null,
          pausedAt: null,
          blocksCompleted: 0,
          focusedSeconds: 90,
          doneTaskIds: [],
          deviceId: "device-other",
          controlAt: iso(now - 90_000),
          seenAt: iso(now),
        }),
      },
      { subscribe: null },
    );
    render(
      <TooltipProvider>
        <FocusSessionChip />
      </TooltipProvider>,
    );
    await act(async () => {
      await refreshQueueRun();
    });
    const chip = screen.getByRole("button", { name: /Queue run/ });
    expect(chip.getAttribute("aria-label")).toContain("on your other device");
    expect(screen.queryByText("01:30")).not.toBeNull();
  });
});
