// TV-P0 (tasks-v3 AC1.6): Focus time saves from any page. The shell's sink
// writes through the track-time op with no Tasks page mounted, keeps the
// stretch's key, and tells a mounted list the new total.
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import { DEFAULT_FOCUS_PREFS } from "../../lib/focus-prefs";
import type { TaskTimeResult, TrackTimeInput } from "../tasks/model";
import {
  __resetFocusEngineForTest,
  attachFocusUser,
  bindFocusTask,
  type FocusSaveContext,
  getFocusSession,
  registerFocusFlushSink,
  startFocus,
  stopFocus,
} from "./engine";
import {
  announceFocusTimeSaved,
  createFocusTimeSink,
  FOCUS_TIME_SAVED_EVENT,
  type FocusTimeSaved,
} from "./time-sink";

const WS = "ws-1";

function fakeTrackTime(status: TaskTimeResult["status"] = "saved", total = 600) {
  const inputs: TrackTimeInput[] = [];
  const trackTime = rs.fn(async (input: TrackTimeInput): Promise<TaskTimeResult> => {
    inputs.push(input);
    return {
      status,
      taskId: input.taskId,
      entryId: "e1",
      totalSeconds: status === "gone" ? null : total,
      mySeconds: null,
      myWaitingSeconds: null,
    };
  });
  return { inputs, trackTime };
}

const ctx = (over: Partial<FocusSaveContext> = {}): FocusSaveContext => ({
  ownedSince: 0,
  earnedAt: Date.UTC(2026, 9, 10, 9, 0),
  workspaceId: WS,
  key: "k-1",
  ...over,
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe("createFocusTimeSink", () => {
  it("writes a focus stretch with its key, and reports the new total", async () => {
    const { inputs, trackTime } = fakeTrackTime("saved", 1500);
    const saved: FocusTimeSaved[] = [];
    const sink = createFocusTimeSink({
      workspaceId: WS,
      canEdit: () => true,
      trackTime,
      onGone: () => {},
      onSaved: (s) => saved.push(s),
    });
    await expect(sink("t1", 61.4, ctx())).resolves.toBe(true);
    expect(inputs).toEqual([
      {
        workspaceId: WS,
        taskId: "t1",
        action: "focus",
        seconds: 61,
        endedAt: new Date(Date.UTC(2026, 9, 10, 9, 0)).toISOString(),
        key: "k-1",
      },
    ]);
    expect(saved).toEqual([{ workspaceId: WS, taskId: "t1", totalSeconds: 1500 }]);
  });

  it("drops time the task can't take, and says so once", async () => {
    const { trackTime } = fakeTrackTime("gone");
    const gone: number[] = [];
    const sink = createFocusTimeSink({
      workspaceId: WS,
      canEdit: () => true,
      trackTime,
      onGone: (s) => gone.push(s),
    });
    await expect(sink("t1", 90, ctx())).resolves.toBe("gone");
    expect(gone).toEqual([90]);
  });

  it("keeps time it can't send now: another workspace, an unsaved task, a failed write", async () => {
    const failing = createFocusTimeSink({
      workspaceId: WS,
      canEdit: () => true,
      trackTime: async () => {
        throw new Error("offline");
      },
      onGone: () => {},
    });
    await expect(failing("t1", 30, ctx())).resolves.toBe(false);
    expect(failing("t1", 30, ctx({ workspaceId: "ws-2" }))).toBe(false);
    expect(failing("tmp-1", 30, ctx())).toBe(false);
    expect(failing("t1", 0.4, ctx())).toBe(true); // nothing to save
  });
});

describe("Focus time saves from any page (AC1.6)", () => {
  beforeEach(() => {
    rs.useFakeTimers();
    localStorage.clear();
    localStorage.setItem("moduo.focus", JSON.stringify(DEFAULT_FOCUS_PREFS));
    __resetFocusEngineForTest();
    attachFocusUser("u1");
  });
  afterEach(() => {
    __resetFocusEngineForTest();
    rs.useRealTimers();
  });

  it("a stretch tracked with no Tasks page open is written when it stops", async () => {
    const { inputs, trackTime } = fakeTrackTime();
    // Only the shell's sink exists — the user is on Notes.
    registerFocusFlushSink(
      WS,
      createFocusTimeSink({ workspaceId: WS, canEdit: () => true, trackTime, onGone: () => {} }),
    );
    bindFocusTask({ id: "t1", title: "Write the brief", bucketName: "Inbox", workspaceId: WS });
    startFocus();
    rs.advanceTimersByTime(90_000);
    stopFocus();
    await settle();
    const saved = inputs.reduce((sum, i) => sum + (i.seconds ?? 0), 0);
    expect(saved).toBe(90);
    expect(inputs.every((i) => i.taskId === "t1" && i.action === "focus" && i.key)).toBe(true);
    expect(getFocusSession().unsaved).toBe(false);
  });

  it("a mounted list hears the saved total", () => {
    const heard: FocusTimeSaved[] = [];
    const listen = (e: Event) => heard.push((e as CustomEvent<FocusTimeSaved>).detail);
    window.addEventListener(FOCUS_TIME_SAVED_EVENT, listen);
    announceFocusTimeSaved({ workspaceId: WS, taskId: "t1", totalSeconds: 120 });
    window.removeEventListener(FOCUS_TIME_SAVED_EVENT, listen);
    expect(heard).toEqual([{ workspaceId: WS, taskId: "t1", totalSeconds: 120 }]);
  });
});
