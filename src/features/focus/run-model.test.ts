// The queue run's pure rules (TV-F2): the record's shape, the clock read from
// shared timestamps, progress, Now, and the line-up's age and capacity.

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "../tasks/helpers";
import type { Task, TaskQueueEntry } from "../tasks/model";
import { REST_SESSION } from "./engine-core";
import {
  capacityLabel,
  type FocusRun,
  focusRunRowToModel,
  formatClock,
  formatMinutes,
  lineUpCapacity,
  lineUpTouchedAt,
  readRunClock,
  runClockForAdopt,
  runNowTask,
  runProgress,
  runSnapshotFromSession,
  runSnapshotToState,
  staleLineUpDays,
} from "./run-model";

const T0 = Date.parse("2026-10-09T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function run(over: Partial<FocusRun> = {}): FocusRun {
  return {
    id: "r1",
    workspaceId: "w",
    userId: "u1",
    status: "running",
    mode: "pomodoro",
    startedAt: iso(T0),
    endedAt: null,
    nowTaskId: "t1",
    phase: "work",
    phaseStartedAt: iso(T0),
    phaseSeconds: 1500,
    pausedAt: null,
    blocksCompleted: 0,
    focusedSeconds: 0,
    doneTaskIds: [],
    deviceId: "dev-aaaaaaaa",
    controlAt: iso(T0),
    seenAt: iso(T0),
    ...over,
  };
}

function task(id: string, over: Partial<Task> = {}): Task {
  return { ...makeTask({ workspaceId: "w", bucketId: "b", title: id, position: id }), id, ...over };
}

describe("focusRunRowToModel", () => {
  it("maps a focus_runs row", () => {
    const m = focusRunRowToModel({
      id: "r1",
      workspace_id: "w",
      user_id: "u1",
      status: "paused",
      mode: "stopwatch",
      started_at: iso(T0),
      ended_at: null,
      now_task_id: "t1",
      phase: "work",
      phase_started_at: iso(T0),
      phase_seconds: null,
      paused_at: iso(T0 + 1000),
      blocks_completed: 2,
      focused_seconds: 90,
      done_task_ids: ["t0"],
      device_id: "dev-bbbbbbbb",
      control_at: iso(T0),
      seen_at: iso(T0 + 1000),
    });
    expect(m).toMatchObject({
      status: "paused",
      mode: "stopwatch",
      nowTaskId: "t1",
      phaseSeconds: null,
      blocksCompleted: 2,
      focusedSeconds: 90,
      doneTaskIds: ["t0"],
      deviceId: "dev-bbbbbbbb",
    });
  });

  it("rejects anything outside the closed vocabularies", () => {
    const base = {
      id: "r",
      workspace_id: "w",
      user_id: "u",
      status: "running",
      mode: "pomodoro",
      phase: "work",
    };
    expect(focusRunRowToModel(base)).not.toBeNull();
    expect(focusRunRowToModel({ ...base, status: "stopped" })).toBeNull();
    expect(focusRunRowToModel({ ...base, mode: "sprint" })).toBeNull();
    expect(focusRunRowToModel({ ...base, phase: "nap" })).toBeNull();
    expect(focusRunRowToModel(null)).toBeNull();
  });

  it("sends only the keys a snapshot has, as the ops name them", () => {
    expect(runSnapshotToState({ status: "paused", nowTaskId: null, doneTaskIds: ["a"] })).toEqual({
      status: "paused",
      now_task_id: null,
      done_task_ids: ["a"],
    });
  });
});

describe("the clock on shared timestamps (F2-4: every device shows the same)", () => {
  it("turns the engine's pomodoro countdown into a phase start", () => {
    const session = {
      ...REST_SESSION,
      tracking: true,
      running: true,
      pomodoro: true,
      phaseSeconds: 1500,
      pomoLeft: 1200,
      sitElapsed: 300,
    };
    const snap = runSnapshotFromSession(session, run(), T0 + 300_000);
    expect(snap.status).toBe("running");
    expect(snap.phaseStartedAt).toBe(iso(T0));
    expect(snap.phaseSeconds).toBe(1500);
    expect(snap.pausedAt).toBeNull();
    expect(snap.focusedSeconds).toBe(300);
  });

  it("a paused run keeps its pause moment, and the phase start is behind it", () => {
    const session = {
      ...REST_SESSION,
      tracking: true,
      running: false,
      pomodoro: true,
      phaseSeconds: 1500,
      pomoLeft: 1400,
    };
    const snap = runSnapshotFromSession(
      session,
      run({ pausedAt: iso(T0 + 100_000) }),
      T0 + 500_000,
    );
    expect(snap.status).toBe("paused");
    expect(snap.pausedAt).toBe(iso(T0 + 100_000));
    expect(snap.phaseStartedAt).toBe(iso(T0));
  });

  it("a break phase is sent as break or long_break", () => {
    const session = {
      ...REST_SESSION,
      tracking: true,
      running: true,
      pomodoro: true,
      phase: "break" as const,
      longBreak: true,
      phaseSeconds: 900,
      pomoLeft: 900,
    };
    expect(runSnapshotFromSession(session, run(), T0).phase).toBe("long_break");
  });

  it("a stopwatch run's clock is its focused time", () => {
    const session = { ...REST_SESSION, tracking: true, running: true, sitElapsed: 125 };
    const snap = runSnapshotFromSession(
      session,
      run({ mode: "stopwatch", phaseSeconds: null }),
      T0 + 125_000,
    );
    expect(snap.phase).toBe("work");
    expect(snap.phaseSeconds).toBeNull();
    expect(snap.phaseStartedAt).toBe(iso(T0));
  });

  it("reads a running pomodoro: time left, and focus since the last save", () => {
    const r = run({ focusedSeconds: 60, seenAt: iso(T0 + 60_000) });
    const reading = readRunClock(r, T0 + 90_000);
    expect(reading.phaseElapsed).toBe(90);
    expect(reading.phaseLeft).toBe(1410);
    expect(reading.bigClock).toBe(1410);
    expect(reading.focusedSeconds).toBe(90);
  });

  it("a paused run's clock stands still", () => {
    const r = run({ status: "paused", pausedAt: iso(T0 + 60_000) });
    expect(readRunClock(r, T0 + 600_000).phaseLeft).toBe(1440);
  });

  it("a break adds no focus", () => {
    const r = run({ phase: "break", phaseSeconds: 300, focusedSeconds: 1500, seenAt: iso(T0) });
    expect(readRunClock(r, T0 + 60_000).focusedSeconds).toBe(1500);
  });

  it("a stopwatch reads its elapsed time", () => {
    const r = run({ mode: "stopwatch", phaseSeconds: null });
    const reading = readRunClock(r, T0 + 42_000);
    expect(reading.bigClock).toBe(42);
    expect(reading.focusedSeconds).toBe(42);
  });

  it("a run whose device stopped saving doesn't keep adding focus", () => {
    const stale = run({
      mode: "stopwatch",
      phaseSeconds: null,
      focusedSeconds: 600,
      seenAt: iso(T0),
    });
    const reading = readRunClock(stale, T0 + 3 * 3600_000);
    expect(reading.focusedSeconds).toBe(600 + 180);
    expect(reading.bigClock).toBe(780);
    const pomo = run({ focusedSeconds: 1200, seenAt: iso(T0) });
    expect(readRunClock(pomo, T0 + 3600_000).focusedSeconds).toBe(1380);
  });

  it("hands a run to the engine as the record has it now", () => {
    const ref = { id: "t1", title: "t1", bucketName: "Inbox", workspaceId: "w" };
    const clock = runClockForAdopt(
      run({ blocksCompleted: 2, phase: "long_break", phaseSeconds: 900 }),
      ref,
      T0 + 120_000,
    );
    expect(clock).toMatchObject({
      task: ref,
      pomodoro: true,
      running: true,
      phase: "break",
      longBreak: true,
      blocks: 2,
      phaseMs: 900_000,
      phaseDoneMs: 120_000,
    });
  });
});

describe("Now, progress and the line-up", () => {
  it("Now is the first open, saved task of my queue", () => {
    const queued = [task("t1", { status: "done" }), task("tmp-x"), task("t2"), task("t3")];
    expect(runNowTask(queued)?.id).toBe("t2");
    expect(runNowTask([task("t1", { status: "done" })])).toBeNull();
  });

  it("“2 of 7 done”: done this run out of done + still lined up", () => {
    const queued = [task("a", { status: "done" }), task("b"), task("c")];
    expect(runProgress({ doneTaskIds: ["a", "z"] }, queued)).toEqual({ done: 2, total: 4 });
  });

  it("the capacity mirror counts open tasks and their estimates", () => {
    const c = lineUpCapacity([
      task("a", { durationMinutes: 120 }),
      task("b", { durationMinutes: 200 }),
      task("c"),
      task("d", { status: "done", durationMinutes: 60 }),
    ]);
    expect(c).toEqual({ count: 3, minutes: 320, withoutEstimate: 1 });
    expect(capacityLabel(c)).toBe("3 · ~5h 20m lined up · 1 without estimate");
    expect(capacityLabel({ count: 2, minutes: 0, withoutEstimate: 2 })).toBe("2 · lined up");
    expect(capacityLabel({ count: 0, minutes: 0, withoutEstimate: 0 })).toBe("");
  });

  it("the line-up is stale after 3 days untouched", () => {
    const entry = (queuedAt: string, updatedAt: string): TaskQueueEntry => ({
      id: queuedAt,
      workspaceId: "w",
      userId: "u1",
      taskId: queuedAt,
      position: "0000000001",
      queuedAt,
      updatedAt,
    });
    const day = 86_400_000;
    const touched = lineUpTouchedAt([
      entry(iso(T0 - 5 * day), iso(T0 - 4 * day)),
      entry(iso(T0 - 6 * day), iso(T0 - 6 * day)),
    ]);
    expect(touched).toBe(T0 - 4 * day);
    expect(staleLineUpDays(touched, T0)).toBe(4);
    expect(staleLineUpDays(T0 - 2 * day, T0)).toBeNull();
    expect(staleLineUpDays(null, T0)).toBeNull();
  });

  it("formats clocks and durations", () => {
    expect(formatClock(1122)).toBe("18:42");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(120)).toBe("2h");
    expect(formatMinutes(320)).toBe("5h 20m");
  });
});
