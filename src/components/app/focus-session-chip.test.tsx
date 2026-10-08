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
import { TooltipProvider } from "../ui/tooltip";
import { FocusSessionChip } from "./focus-session-chip";

rs.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));

beforeEach(() => {
  rs.useFakeTimers();
  localStorage.clear();
  __resetFocusEngineForTest({ alert: () => {} });
  attachFocusUser("u1");
});

afterEach(() => {
  cleanup();
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
});
