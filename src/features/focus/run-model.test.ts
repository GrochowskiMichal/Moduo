// Focus runs, the pure rules (TV-F6, salvaged from #323): reading a run's
// record, what a device sends, a run read through on another device, and
// where the session goes when its Now task changes under it.

import { describe, expect, it } from "@rstest/core";

import { onThisLabel, runClaimsByTask } from "./claims";
import { REST_SESSION } from "./engine-core";
import {
  type FocusRun,
  type FollowTask,
  focusRunRowToModel,
  followStep,
  READ_THROUGH_MAX_S,
  readRunClock,
  runClockForAdopt,
  runSnapshotFromSession,
  runSnapshotToState,
} from "./run-model";

const T0 = Date.parse("2026-10-13T09:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();

function run(patch: Partial<FocusRun> = {}): FocusRun {
  return {
    id: "r1",
    workspaceId: "w",
    userId: "u",
    status: "running",
    mode: "per_task",
    startedAt: at(0),
    endedAt: null,
    nowTaskId: "t1",
    phase: "work",
    phaseStartedAt: at(0),
    phaseSeconds: null,
    pausedAt: null,
    blocksCompleted: 0,
    focusedSeconds: 0,
    doneTaskIds: [],
    deviceId: "dev-aaaa",
    controlAt: at(0),
    seenAt: at(0),
    ...patch,
  };
}

describe("a run's record", () => {
  it("reads a row, and a timer this build doesn't know as Per task", () => {
    const row = {
      id: "r1",
      workspace_id: "w",
      user_id: "u",
      status: "running",
      mode: "metronome",
      phase: "break",
      started_at: at(0),
      phase_started_at: at(0),
      seen_at: at(0),
      device_id: "dev-aaaa",
      done_task_ids: ["t1", 3],
    };
    expect(focusRunRowToModel(row)).toMatchObject({
      mode: "per_task",
      phase: "work",
      doneTaskIds: ["t1"],
    });
    expect(focusRunRowToModel({ id: "x" })).toBeNull();
  });

  it("sends the timer with the state, in the ops' keys", () => {
    expect(runSnapshotToState({ mode: "off", status: "paused", nowTaskId: null })).toEqual({
      mode: "off",
      status: "paused",
      now_task_id: null,
    });
  });
});

describe("what a device sends", () => {
  const base = { nowTaskId: "t1", doneTaskIds: [], pausedAt: null };

  it("Per task: the clock starts when the Now task's clock did", () => {
    const snap = runSnapshotFromSession(
      {
        ...REST_SESSION,
        tracking: true,
        running: true,
        timer: "per_task",
        taskSeconds: 90,
        sitElapsed: 300,
      },
      base,
      T0 + 300_000,
    );
    expect(snap).toMatchObject({
      mode: "per_task",
      phase: "work",
      phaseSeconds: null,
      focusedSeconds: 300,
    });
    expect(snap.phaseStartedAt).toBe(at(300 - 90));
  });

  it("Pomodoro: the phase, its length and when it began", () => {
    const snap = runSnapshotFromSession(
      {
        ...REST_SESSION,
        tracking: true,
        running: true,
        timer: "pomodoro",
        pomodoro: true,
        phase: "break",
        longBreak: true,
        phaseSeconds: 900,
        pomoLeft: 600,
      },
      base,
      T0 + 1000_000,
    );
    expect(snap).toMatchObject({ mode: "pomodoro", phase: "long_break", phaseSeconds: 900 });
    expect(snap.phaseStartedAt).toBe(at(1000 - 300));
  });

  it("Off: no clock to carry", () => {
    const snap = runSnapshotFromSession(
      { ...REST_SESSION, tracking: true, running: false, timer: "off" },
      base,
      T0,
    );
    expect(snap).toMatchObject({ mode: "off", status: "paused", phaseSeconds: null });
  });
});

describe("a run read through on another device", () => {
  it("Per task shows the Now task's clock and the session's", () => {
    const r = run({ phaseStartedAt: at(60), focusedSeconds: 100, seenAt: at(100) });
    expect(readRunClock(r, T0 + 130_000)).toMatchObject({
      timer: "per_task",
      bigClock: 70,
      focusedSeconds: 130,
    });
  });

  it("Pomodoro counts down its phase", () => {
    const r = run({ mode: "pomodoro", phaseSeconds: 1500, phaseStartedAt: at(0), seenAt: at(590) });
    expect(readRunClock(r, T0 + 600_000)).toMatchObject({ bigClock: 900, phaseLeft: 900 });
  });

  it("Off has no clock", () => {
    expect(readRunClock(run({ mode: "off" }), T0 + 600_000)).toMatchObject({
      bigClock: 0,
      focusedSeconds: 0,
    });
  });

  it("a device that went quiet stops counting after the claims window", () => {
    const r = run({ focusedSeconds: 100, seenAt: at(100) });
    const reading = readRunClock(r, T0 + (100 + 3600) * 1000);
    expect(reading.focusedSeconds).toBe(100 + READ_THROUGH_MAX_S);
    expect(reading.bigClock).toBe(100 + READ_THROUGH_MAX_S);
  });

  it("a paused run stands still", () => {
    const r = run({ status: "paused", pausedAt: at(50) });
    expect(readRunClock(r, T0 + 600_000).bigClock).toBe(50);
  });

  it("taking it over hands the engine the same clocks", () => {
    const r = run({ phaseStartedAt: at(60), focusedSeconds: 100, seenAt: at(100) });
    expect(runClockForAdopt(r, null, T0 + 130_000)).toMatchObject({
      timer: "per_task",
      taskMs: 70_000,
      sitMs: 130_000,
      running: true,
    });
  });
});

describe("the run rules: where the session goes (followStep)", () => {
  const tasks: Record<string, FollowTask> = {
    t1: { id: "t1", open: true },
    t2: { id: "t2", open: true },
    t3: { id: "t3", open: true },
  };
  const lookup =
    (overrides: Record<string, FollowTask | undefined> = {}) =>
    (id: string) =>
      id in overrides ? overrides[id] : tasks[id];
  const base = {
    nowTaskId: "t1",
    myQueue: ["t1", "t2", "t3"],
    task: lookup(),
    selfId: "me",
    complete: true,
    wasQueued: true,
  };

  it("stays while Now is open and lined up", () => {
    expect(followStep(base)).toEqual({ kind: "stay" });
  });

  it("I finished Now: on to the next, nothing to say", () => {
    const step = followStep({
      ...base,
      myQueue: ["t2", "t3"],
      task: lookup({ t1: { id: "t1", open: false, completedBy: "me" } }),
    });
    expect(step).toEqual({ kind: "move", taskId: "t2", left: null, leftTaskId: "t1" });
  });

  it("someone else finished Now: on to the next, and says so", () => {
    const step = followStep({
      ...base,
      task: lookup({ t1: { id: "t1", open: false, completedBy: "mike" } }),
    });
    expect(step).toMatchObject({ kind: "move", taskId: "t2", left: "completed" });
  });

  it("Now deleted or unshared: on, saying it went", () => {
    const step = followStep({ ...base, myQueue: ["t2"], task: lookup({ t1: undefined }) });
    expect(step).toMatchObject({ kind: "move", taskId: "t2", left: "gone" });
  });

  it("a missing Now waits while the closed tasks may still be loading", () => {
    expect(followStep({ ...base, task: lookup({ t1: undefined }), complete: false })).toEqual({
      kind: "stay",
    });
  });

  it("removed from Up next: the next task becomes Now", () => {
    expect(followStep({ ...base, myQueue: ["t2", "t3"] })).toMatchObject({
      kind: "move",
      taskId: "t2",
      left: null,
    });
  });

  it("a task that was never lined up isn't moved for that", () => {
    expect(followStep({ ...base, myQueue: ["t2"], wasQueued: false })).toEqual({ kind: "stay" });
  });

  it("skips closed and unsaved tasks; ends when Up next runs out (62)", () => {
    const step = followStep({
      ...base,
      myQueue: ["t1", "tmp-9", "t2"],
      task: lookup({
        t1: { id: "t1", open: false, completedBy: "me" },
        t2: { id: "t2", open: false },
      }),
    });
    expect(step).toEqual({ kind: "end", left: null, leftTaskId: "t1" });
  });
});

describe("claims", () => {
  it("groups teammates per task, never me", () => {
    const byTask = runClaimsByTask(
      [
        { userId: "mike", taskId: "t1" },
        { userId: "me", taskId: "t1" },
        { userId: "ola", taskId: "t1" },
        { userId: "mike", taskId: "t1" },
      ],
      "me",
    );
    expect(byTask.get("t1")).toEqual(["mike", "ola"]);
  });

  it("says who is on it in plain words", () => {
    expect(onThisLabel([])).toBe("");
    expect(onThisLabel(["Mike"])).toBe("Mike is on this");
    expect(onThisLabel(["Mike", "Ola"])).toBe("Mike and Ola are on this");
    expect(onThisLabel(["Mike", "Ola", "Ada"])).toBe("Mike, Ola and Ada are on this");
  });
});
