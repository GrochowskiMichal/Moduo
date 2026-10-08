// The queue run store (TV-F2): start / pause / end (F2-1), Now moving with the
// rhythm kept (F2-2), surviving a reload and showing on another device, which
// takes control when you act on it (F2-4) — and the device that lost control
// gives back what it counted after the takeover, so nothing counts twice.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import {
  __resetFocusEngineForTest,
  attachFocusUser,
  getFocusSession,
  registerFocusFlushSink,
} from "./engine";
import type { FocusTaskRef } from "./engine-core";
import {
  __flushRunSyncForTest,
  __resetQueueRunForTest,
  attachRunUser,
  endQueueRun,
  getQueueRunState,
  isRunInControl,
  moveQueueRun,
  recordRunDone,
  refreshQueueRun,
  runDeviceId,
  startQueueRun,
  takeRunControl,
  toggleQueueRunPause,
} from "./run";
import type { FocusRun, FocusRunRuntime, FocusRunSnapshot } from "./run-model";

const USER = "u1";
const WS = "w1";
const T0 = Date.parse("2026-10-09T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const refs: Record<string, FocusTaskRef> = {
  t1: { id: "t1", title: "Fix the checkbox", bucketName: "Inbox", workspaceId: WS },
  t2: { id: "t2", title: "Write the spec", bucketName: "Inbox", workspaceId: WS },
};
const resolve = (id: string) => refs[id] ?? null;

/** focus_runs as the server keeps it, with the ops' control rules. */
function fakeServer(opts: { runsOnServer?: boolean } = {}) {
  const rows: FocusRun[] = [];
  const apply = (r: FocusRun, s: Partial<FocusRunSnapshot>): FocusRun => ({
    ...r,
    ...(s.status ? { status: s.status } : {}),
    ...(s.nowTaskId !== undefined ? { nowTaskId: s.nowTaskId } : {}),
    ...(s.phase ? { phase: s.phase } : {}),
    ...(s.phaseStartedAt ? { phaseStartedAt: s.phaseStartedAt } : {}),
    ...(s.phaseSeconds !== undefined ? { phaseSeconds: s.phaseSeconds } : {}),
    ...(s.pausedAt !== undefined ? { pausedAt: s.pausedAt } : {}),
    ...(s.blocksCompleted !== undefined ? { blocksCompleted: s.blocksCompleted } : {}),
    ...(s.focusedSeconds !== undefined ? { focusedSeconds: s.focusedSeconds } : {}),
    ...(s.doneTaskIds ? { doneTaskIds: s.doneTaskIds } : {}),
  });
  const rt: FocusRunRuntime = {
    async latestRun() {
      return rows.length ? { ...rows[rows.length - 1] } : null;
    },
    async startRun({ workspaceId, deviceId, mode, state }) {
      if (opts.runsOnServer === false) return null;
      for (const r of rows)
        if (r.status !== "ended") Object.assign(r, { status: "ended", endedAt: iso(Date.now()) });
      const now = iso(Date.now());
      const row = apply(
        {
          id: `srv-${rows.length + 1}`,
          workspaceId,
          userId: USER,
          status: "running",
          mode,
          startedAt: now,
          endedAt: null,
          nowTaskId: null,
          phase: "work",
          phaseStartedAt: now,
          phaseSeconds: mode === "pomodoro" ? 1500 : null,
          pausedAt: null,
          blocksCompleted: 0,
          focusedSeconds: 0,
          doneTaskIds: [],
          deviceId,
          controlAt: now,
          seenAt: now,
        },
        state,
      );
      rows.push(row);
      return { ...row };
    },
    async saveRun({ runId, deviceId, take, state }) {
      const i = rows.findIndex((r) => r.id === runId);
      if (i < 0) return null;
      const r = rows[i];
      if (r.status === "ended" || (r.deviceId !== deviceId && !take)) return { ...r };
      const now = iso(Date.now());
      rows[i] = {
        ...apply(r, state),
        deviceId,
        controlAt: r.deviceId !== deviceId ? now : r.controlAt,
        seenAt: now,
      };
      return { ...rows[i] };
    },
    async endRun({ runId, deviceId, state }) {
      const i = rows.findIndex((r) => r.id === runId);
      if (i < 0) return null;
      if (rows[i].status === "ended") return { ...rows[i] };
      rows[i] = {
        ...apply(rows[i], { ...state, status: undefined }),
        status: "ended",
        endedAt: iso(Date.now()),
        pausedAt: null,
        deviceId,
      };
      return { ...rows[i] };
    },
    async listClaims() {
      return [];
    },
    async keepLineUp() {
      return [];
    },
  };
  return { rows, rt };
}

/** A focus_runs row as Realtime delivers it. */
function dbRow(r: FocusRun): Record<string, unknown> {
  return {
    id: r.id,
    workspace_id: r.workspaceId,
    user_id: r.userId,
    status: r.status,
    mode: r.mode,
    started_at: r.startedAt,
    ended_at: r.endedAt,
    now_task_id: r.nowTaskId,
    phase: r.phase,
    phase_started_at: r.phaseStartedAt,
    phase_seconds: r.phaseSeconds,
    paused_at: r.pausedAt,
    blocks_completed: r.blocksCompleted,
    focused_seconds: r.focusedSeconds,
    done_task_ids: r.doneTaskIds,
    device_id: r.deviceId,
    control_at: r.controlAt,
    seen_at: r.seenAt,
  };
}

let pushRow: ((row: unknown) => void) | null = null;
function attach(rt: FocusRunRuntime) {
  attachRunUser(
    USER,
    { focus: rt },
    {
      subscribe: (_user, onRow) => {
        pushRow = onRow;
        return () => {
          pushRow = null;
        };
      },
    },
  );
}

/** Let queued promises settle (fake timers don't run microtasks by themselves). */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  rs.useFakeTimers();
  rs.setSystemTime(T0);
  localStorage.clear();
  __resetFocusEngineForTest({ alert: () => {} });
  __resetQueueRunForTest();
  attachFocusUser(USER);
});

afterEach(() => {
  __resetQueueRunForTest();
  __resetFocusEngineForTest();
  rs.useRealTimers();
});

describe("start, pause, end (F2-1)", () => {
  it("Start run binds my queue's first task and starts the clock in the run's mode", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "stopwatch", task: refs.t1 });
    expect(getFocusSession()).toMatchObject({
      taskId: "t1",
      tracking: true,
      running: true,
      pomodoro: false,
    });
    await __flushRunSyncForTest();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "running",
      mode: "stopwatch",
      nowTaskId: "t1",
      deviceId: runDeviceId(),
    });
    expect(getQueueRunState().run?.id).toBe(rows[0].id);
    expect(isRunInControl(getQueueRunState().run)).toBe(true);
  });

  it("a pomodoro run starts a work block", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "pomodoro", task: refs.t1 });
    expect(getFocusSession()).toMatchObject({ pomodoro: true, phase: "work", pomoLeft: 1500 });
    await __flushRunSyncForTest();
    expect(rows[0]).toMatchObject({ mode: "pomodoro", phaseSeconds: 1500 });
  });

  it("Pause and Resume reach the server; End run stops the clock and ends the run", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "pomodoro", task: refs.t1 });
    await __flushRunSyncForTest();
    rs.advanceTimersByTime(60_000);
    toggleQueueRunPause(resolve);
    expect(getFocusSession().running).toBe(false);
    await __flushRunSyncForTest();
    expect(rows[0].status).toBe("paused");
    expect(rows[0].pausedAt).not.toBeNull();
    toggleQueueRunPause(resolve);
    await __flushRunSyncForTest();
    expect(rows[0]).toMatchObject({ status: "running", pausedAt: null });
    expect(getFocusSession().running).toBe(true);

    endQueueRun();
    expect(getFocusSession()).toMatchObject({ tracking: false, taskId: null });
    expect(getQueueRunState().run).toBeNull();
    expect(getQueueRunState().ended?.id).toBe(rows[0].id);
    await __flushRunSyncForTest();
    expect(rows[0].status).toBe("ended");
    expect(rows[0].focusedSeconds).toBe(60);
  });

  it("each task done in the run counts once", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "stopwatch", task: refs.t1 });
    recordRunDone("t1", resolve);
    recordRunDone("t1", resolve);
    await __flushRunSyncForTest();
    expect(rows[0].doneTaskIds).toEqual(["t1"]);
  });
});

describe("Now moves with the queue (F2-2)", () => {
  it("binding the next task keeps the pomodoro rhythm", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "pomodoro", task: refs.t1 });
    rs.advanceTimersByTime(10 * 60_000);
    moveQueueRun(WS, refs.t2, { explicit: true });
    expect(getFocusSession()).toMatchObject({
      taskId: "t2",
      running: true,
      phase: "work",
      pomoLeft: 15 * 60,
    });
    await __flushRunSyncForTest();
    expect(rows[0].nowTaskId).toBe("t2");
    expect(getQueueRunState().run?.nowTitle).toBe("Write the spec");
  });

  it("an emptied queue ends the run", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "stopwatch", task: refs.t1 });
    await __flushRunSyncForTest();
    moveQueueRun(WS, null, { explicit: false });
    expect(getQueueRunState().run).toBeNull();
    expect(getFocusSession().tracking).toBe(false);
    await __flushRunSyncForTest();
    expect(rows[0].status).toBe("ended");
  });

  it("never moves a run in another workspace", () => {
    const { rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "stopwatch", task: refs.t1 });
    moveQueueRun("other-ws", refs.t2, { explicit: true });
    expect(getFocusSession().taskId).toBe("t1");
  });
});

describe("reloads and other devices (F2-4)", () => {
  it("the run survives a reload", async () => {
    const { rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "pomodoro", task: refs.t1 });
    await __flushRunSyncForTest();
    const id = getQueueRunState().run?.id;
    rs.advanceTimersByTime(30_000);
    // A reload: fresh stores, same storage.
    __resetQueueRunForTest();
    __resetFocusEngineForTest({ alert: () => {} });
    attachFocusUser(USER);
    attach(rt);
    expect(getQueueRunState().run?.id).toBe(id);
    expect(getFocusSession()).toMatchObject({ taskId: "t1", tracking: true, running: true });
    await refreshQueueRun();
    expect(getQueueRunState().run?.id).toBe(id);
    expect(isRunInControl(getQueueRunState().run)).toBe(true);
  });

  it("another device's run shows read through; acting here takes it over", async () => {
    const { rows, rt } = fakeServer();
    rows.push({
      id: "srv-other",
      workspaceId: WS,
      userId: USER,
      status: "running",
      mode: "pomodoro",
      startedAt: iso(T0 - 5 * 60_000),
      endedAt: null,
      nowTaskId: "t1",
      phase: "work",
      phaseStartedAt: iso(T0 - 5 * 60_000),
      phaseSeconds: 1500,
      pausedAt: null,
      blocksCompleted: 1,
      focusedSeconds: 1800,
      doneTaskIds: ["t0"],
      deviceId: "device-other",
      controlAt: iso(T0 - 5 * 60_000),
      seenAt: iso(T0),
    });
    attach(rt);
    await refreshQueueRun();
    const seen = getQueueRunState().run;
    expect(seen?.id).toBe("srv-other");
    expect(isRunInControl(seen)).toBe(false);
    expect(getFocusSession().tracking).toBe(false);

    rs.advanceTimersByTime(60_000);
    takeRunControl(resolve);
    expect(getFocusSession()).toMatchObject({
      taskId: "t1",
      tracking: true,
      running: true,
      pomodoro: true,
      completedWork: 1,
      pomoLeft: 1500 - 6 * 60,
    });
    expect(isRunInControl(getQueueRunState().run)).toBe(true);
    await __flushRunSyncForTest();
    expect(rows[0]).toMatchObject({
      deviceId: runDeviceId(),
      controlAt: iso(T0 + 60_000),
      doneTaskIds: ["t0"],
    });
  });

  it("losing control gives back what this device counted after the takeover", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "stopwatch", task: refs.t1 });
    await __flushRunSyncForTest();
    rs.advanceTimersByTime(120_000);
    // The other device took over a minute in (Realtime brings the row).
    const taken = {
      ...rows[0],
      deviceId: "device-other",
      controlAt: iso(T0 + 60_000),
      seenAt: iso(T0 + 60_000),
    };
    pushRow?.(dbRow(taken));
    expect(getFocusSession().tracking).toBe(false);
    expect(isRunInControl(getQueueRunState().run)).toBe(false);
    // What's left to save is the minute before the takeover.
    const saved: number[] = [];
    registerFocusFlushSink(WS, (_task, seconds) => {
      saved.push(seconds);
      return true;
    });
    await settle();
    expect(saved.reduce((a, b) => a + b, 0)).toBe(60);
  });

  it("a run ended on another device stops this one", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "stopwatch", task: refs.t1 });
    await __flushRunSyncForTest();
    rs.advanceTimersByTime(30_000);
    pushRow?.(
      dbRow({ ...rows[0], status: "ended", endedAt: iso(T0 + 30_000), deviceId: "device-other" }),
    );
    expect(getQueueRunState().run).toBeNull();
    expect(getQueueRunState().ended?.id).toBe(rows[0].id);
    expect(getFocusSession().tracking).toBe(false);
  });

  it("a stale answer from an older run never replaces the current one", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "stopwatch", task: refs.t1 });
    await __flushRunSyncForTest();
    const first = { ...rows[0] };
    rs.advanceTimersByTime(60_000);
    endQueueRun();
    startQueueRun({ workspaceId: WS, mode: "stopwatch", task: refs.t2 });
    await __flushRunSyncForTest();
    pushRow?.(dbRow({ ...first, status: "running" }));
    expect(getQueueRunState().run?.nowTaskId).toBe("t2");
  });
});

describe("before the migration reaches the database", () => {
  it("the run stays on this device, and survives a reload", async () => {
    const { rows, rt } = fakeServer({ runsOnServer: false });
    attach(rt);
    startQueueRun({ workspaceId: WS, mode: "pomodoro", task: refs.t1 });
    await __flushRunSyncForTest();
    expect(rows).toHaveLength(0);
    expect(getQueueRunState().run?.local).toBe(true);
    __resetQueueRunForTest();
    attach(rt);
    await refreshQueueRun();
    expect(getQueueRunState().run).toMatchObject({ local: true, nowTaskId: "t1" });
    endQueueRun();
    await __flushRunSyncForTest();
    expect(getQueueRunState().run).toBeNull();
  });
});
