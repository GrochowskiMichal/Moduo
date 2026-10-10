import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { DEFAULT_FOCUS_PREFS, type FocusPrefs } from "../../../lib/focus-prefs";
import {
  __resetFocusEngineForTest,
  attachFocusUser,
  createFocusEngine,
  FOCUS_STORAGE_PREFIX,
  type FocusEngine,
  getFocusSession,
  startFocus,
} from "../../focus/engine";
import { makeTask } from "../helpers";
import type { Task } from "../model";
import { ExecuteView } from "./execute-view";

// Done / Skip on the task the focus session is on move the session to the next
// task right away (TV-F1, F1-6), even when another tab runs the clock.

const USER = "u1";
const WS = "ws-1";

function task(id: string, order: number): Task {
  return {
    ...makeTask({ workspaceId: WS, bucketId: "b1", title: `Task ${id}`, position: `a${order}` }),
    id,
  };
}

function renderView(
  handlers: {
    onMarkDone?: (id: string) => void;
    onSkip?: (id: string) => void;
  },
  queued: Task[] = [task("t1", 1), task("t2", 2)],
) {
  return render(
    <TooltipProvider>
      <ExecuteView
        workspaceId={WS}
        queuedTasks={queued}
        bucketNameById={() => "Inbox"}
        parentTitleFor={() => null}
        blockedNoteFor={() => null}
        onMarkDone={handlers.onMarkDone ?? (() => {})}
        onSkip={handlers.onSkip ?? (() => {})}
        onAddTime={() => {}}
        onSetTime={() => {}}
        tagsFor={() => []}
        subtasksFor={() => []}
        onToggleSubtask={() => {}}
        onExit={() => {}}
        loading={false}
        canEdit
        onCaptureToQueue={() => {}}
      />
    </TooltipProvider>,
  );
}

let otherTab: FocusEngine | null = null;

beforeEach(() => {
  localStorage.clear();
  __resetFocusEngineForTest({ alert: () => {} });
  attachFocusUser(USER);
});

afterEach(() => {
  cleanup();
  otherTab?.dispose();
  otherTab = null;
  __resetFocusEngineForTest();
});

describe("Focus view — Done / Skip move the session", () => {
  it("Done on the session's task moves the running session to the next one", () => {
    const onMarkDone = rs.fn();
    renderView({ onMarkDone });
    act(() => startFocus());
    expect(getFocusSession()).toMatchObject({ taskId: "t1", running: true });
    fireEvent.click(screen.getByRole("button", { name: /^Done$/ }));
    expect(onMarkDone).toHaveBeenCalledWith("t1");
    expect(getFocusSession()).toMatchObject({ taskId: "t2", running: true });
  });

  it("Skip does the same", () => {
    const onSkip = rs.fn();
    renderView({ onSkip });
    act(() => startFocus());
    fireEvent.click(screen.getByRole("button", { name: /^Skip$/ }));
    expect(onSkip).toHaveBeenCalledWith("t1");
    expect(getFocusSession().taskId).toBe("t2");
  });

  it("Skip on the only queued task keeps the session on it (it goes to the end: still Now)", () => {
    const onSkip = rs.fn();
    renderView({ onSkip }, [task("t1", 1)]);
    act(() => startFocus());
    fireEvent.click(screen.getByRole("button", { name: /^Skip$/ }));
    expect(onSkip).toHaveBeenCalledWith("t1");
    expect(getFocusSession()).toMatchObject({ taskId: "t1", running: true });
  });

  it("Done here takes the clock from another tab and moves the session", () => {
    otherTab = createFocusEngine({
      storage: () => window.localStorage,
      now: () => Date.now(),
      readPrefs: () => ({ ...DEFAULT_FOCUS_PREFS, soundEnabled: false }) as FocusPrefs,
      alert: () => {},
      singleWindow: () => false,
      tabId: "other-tab",
      newKey: () => crypto.randomUUID(),
    });
    otherTab.attach(USER);
    otherTab.bind({ id: "t1", title: "Task t1", bucketName: "Inbox", workspaceId: WS });
    otherTab.start();
    renderView({});
    // This tab hears the other tab's write (the browser's storage event).
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: `${FOCUS_STORAGE_PREFIX}${USER}` }));
    });
    expect(getFocusSession()).toMatchObject({ taskId: "t1", running: true });
    fireEvent.click(screen.getByRole("button", { name: /^Done$/ }));
    expect(getFocusSession()).toMatchObject({ taskId: "t2", running: true });
    otherTab.tick();
    expect(otherTab.getSnapshot().taskId).toBe("t2");
  });
});
