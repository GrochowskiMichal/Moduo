import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import {
  __resetFocusEngineForTest,
  attachFocusUser,
  bindFocusTask,
  getFocusSession,
  registerFocusFlushSink,
  startFocus,
  stopFocus,
} from "../../features/focus/engine";
import { TooltipProvider } from "../ui/tooltip";
import { FocusSessionChip, formatClock } from "./focus-session-chip";

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

function renderTimer() {
  render(
    <TooltipProvider>
      <FocusSessionChip />
    </TooltipProvider>,
  );
}

function startOn(title: string) {
  act(() => {
    bindFocusTask({ id: "t1", title, bucketName: "Inbox", workspaceId: "ws-1" });
    startFocus();
  });
  act(() => {
    rs.advanceTimersByTime(30_000);
  });
}

describe("FocusSessionChip (the top-bar Focus timer)", () => {
  it("renders nothing with no session", () => {
    renderTimer();
    expect(document.querySelector('[data-slot="focus-timer"]')).toBeNull();
  });

  it("shows just the clock, keeps the task in the label, and after Stop keeps unsaved time visible (F1-7)", async () => {
    registerFocusFlushSink("ws-1", () => Promise.resolve(false)); // saves fail
    renderTimer();
    startOn("Write spec");

    const clock = screen.getByRole("button", { name: /^Focus — Write spec/ });
    expect(clock.textContent).toBe("0:30");
    expect(screen.queryByText("Write spec")).toBeNull();

    await act(async () => {
      stopFocus();
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
    expect(screen.queryByText("0:30")).toBeNull();
    expect(screen.queryByText("Focus time not saved yet")).not.toBeNull();
  });

  it("pauses and resumes from the timer (call 96)", () => {
    renderTimer();
    startOn("Write spec");

    fireEvent.click(screen.getByRole("button", { name: "Pause Focus" }));
    expect(getFocusSession().running).toBe(false);
    expect(screen.getByRole("button", { name: /\(paused\)/ })).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Resume Focus" }));
    expect(getFocusSession().running).toBe(true);
  });
});

describe("formatClock", () => {
  it("drops the leading zero under an hour and adds hours from an hour on", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(252)).toBe("4:12");
    expect(formatClock(1082)).toBe("18:02");
    expect(formatClock(3852)).toBe("1:04:12");
  });
});
