// The Focus run store (TV-F6, salvaged from #323): the shared record FOLLOWS
// the one time engine — whatever starts a session starts the run, the timer
// and pauses are saved, Stop ends it after the Undo window — and another
// device takes it over by acting, while the device that lost it gives back
// what it counted after the takeover, so nothing counts twice (AC8.11).

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import {
  __resetFocusEngineForTest,
  attachFocusUser,
  focusOnTask,
  getFocusSession,
  registerFocusFlushSink,
  setFocusTimer,
  STOP_UNDO_MS,
  stopFocus,
  toggleFocusRunning,
} from "./engine";
import type { FocusTaskRef } from "./engine-core";
import {
  __finishRunEndForTest,
  __flushRunSyncForTest,
  __resetFocusRunForTest,
  __setRunDeviceForTest,
  attachRunUser,
  getFocusRunState,
  isRunInControl,
  recordRunDone,
  refreshFocusRun,
  runDeviceId,
  takeRunControl,
  undoStopKeepingRun,
} from "./run";
import type { FocusRun, FocusRunRuntime, FocusRunSnapshot } from "./run-model";

const USER = "u1";
const WS = "w1";
const T0 = Date.parse("2026-10-13T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const refs: Record<string, FocusTaskRef> = {
  t1: { id: "t1", title: "Fix the checkbox", bucketName: "Inbox", workspaceId: WS },
  t2: { id: "t2", title: "Write the spec", bucketName: "Inbox", workspaceId: WS },
};
const resolve = (id: string) => refs[id] ?? null;

/** focus_runs as the server keeps it, with the ops' control rules. */
function fakeServer() {
  const rows: FocusRun[] = [];
  const apply = (r: FocusRun, s: Partial<FocusRunSnapshot>): FocusRun => ({
    ...r,
    ...(s.status ? { status: s.status } : {}),
    ...(s.mode ? { mode: s.mode } : {}),
    ...(s.nowTaskId !== undefined ? { nowTaskId: s.nowTaskId } : {}),
    ...(s.phase ? { phase: s.phase } : {}),
    ...(s.phaseStartedAt ? { phaseStartedAt: s.phaseStartedAt } : {}),
    ...(s.phaseSeconds !== undefined ? { phaseSeconds: s.phaseSeconds } : {}),
    ...(s.pausedAt !== undefined ? { pausedAt: s.pausedAt } : {}),
    ...(s.blocksCompleted !== undefined ? { blocksCompleted: s.blocksCompleted } : {}),
    ...(s.focusedSeconds !== undefined ? { focusedSeconds: s.focusedSeconds } : {}),
    ...(s.doneTaskIds ? { doneTaskIds: s.doneTaskIds } : {}),
  });
  const ends: Array<{ runId: string; state: Partial<FocusRunSnapshot> }> = [];
  const givenBack: Array<{ workspaceId: string; taskId: string; seconds: number; key: string }> =
    [];
  const rt: FocusRunRuntime = {
    async latestRun() {
      return rows.length ? { ...rows[rows.length - 1] } : null;
    },
    async startRun({ workspaceId, deviceId, mode, state }) {
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
        { ...state, mode },
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
      ends.push({ runId, state });
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
    async listMyRuns() {
      return { runs: rows.map((r) => ({ ...r })), truncated: [] };
    },
    async keepLineUp() {
      return [];
    },
    async giveBackTime(input) {
      givenBack.push(input);
    },
  };
  return { rows, rt, ends, givenBack };
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

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await __flushRunSyncForTest();
}

beforeEach(() => {
  rs.useFakeTimers();
  rs.setSystemTime(T0);
  localStorage.clear();
  __resetFocusEngineForTest({ alert: () => {} });
  __resetFocusRunForTest();
  attachFocusUser(USER);
});

afterEach(() => {
  __resetFocusRunForTest();
  __resetFocusEngineForTest();
  rs.useRealTimers();
});

describe("the run follows the one engine", () => {
  it("starting a session anywhere starts the run in that task's workspace, with its timer", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task"); // Calendar's ▶, Home, Focus: all the same
    await settle();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: WS,
      mode: "per_task",
      nowTaskId: "t1",
      deviceId: runDeviceId(),
      status: "running",
    });
    expect(getFocusRunState().run?.id).toBe("srv-1");
  });

  it("the timer, pauses and Now moving are saved; the session's time goes with them", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    rs.advanceTimersByTime(60_000);
    setFocusTimer("pomodoro");
    rs.advanceTimersByTime(500);
    await settle();
    expect(rows[0]).toMatchObject({ mode: "pomodoro", phaseSeconds: 25 * 60 });
    toggleFocusRunning();
    rs.advanceTimersByTime(500);
    await settle();
    expect(rows[0].status).toBe("paused");
    toggleFocusRunning();
    focusOnTask(refs.t2);
    rs.advanceTimersByTime(500);
    await settle();
    expect(rows[0]).toMatchObject({ status: "running", nowTaskId: "t2" });
    // 60 s before the timer change, then a second of running in between.
    expect(rows[0].focusedSeconds).toBe(61);
  });

  it("Stop ends the run after the Undo window, with its final numbers", async () => {
    const { rows, rt, ends } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    rs.advanceTimersByTime(90_000);
    stopFocus();
    await settle();
    expect(rows[0].status).toBe("running"); // Undo can still bring it back
    expect(getFocusRunState().run).toBeNull();
    rs.advanceTimersByTime(STOP_UNDO_MS + 100);
    await settle();
    expect(rows[0]).toMatchObject({ status: "ended", focusedSeconds: 90 });
    expect(ends).toHaveLength(1);
    expect(getFocusRunState().ended?.focusedSeconds).toBe(90);
  });

  it("Undo inside the window keeps the same run going", async () => {
    const { rows, rt, ends } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    stopFocus();
    rs.advanceTimersByTime(3000);
    undoStopKeepingRun();
    rs.advanceTimersByTime(STOP_UNDO_MS);
    await settle();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("running");
    expect(ends).toHaveLength(0);
    expect(getFocusRunState().run?.id).toBe("srv-1");
  });

  it("a session in another workspace starts a new run, which ends the old one", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    focusOnTask({ id: "x1", title: "Elsewhere", bucketName: null, workspaceId: "w2" });
    await settle();
    expect(rows.map((r) => [r.workspaceId, r.status])).toEqual([
      [WS, "ended"],
      ["w2", "running"],
    ]);
  });

  it("finishing Now counts in the run's done list", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    recordRunDone("t1");
    rs.advanceTimersByTime(500);
    await settle();
    expect(rows[0].doneTaskIds).toEqual(["t1"]);
  });
});

describe("two devices never both count (AC8.11)", () => {
  it("another device's run shows read through; acting here takes it over", async () => {
    const { rows, rt } = fakeServer();
    // The desktop app started it.
    await rt.startRun({
      workspaceId: WS,
      deviceId: "desktop-1234",
      mode: "pomodoro",
      state: { nowTaskId: "t1", status: "running", phaseStartedAt: iso(T0 - 10 * 60_000) },
    });
    attach(rt);
    await settle();
    expect(getFocusRunState().run).toMatchObject({ deviceId: "desktop-1234", nowTaskId: "t1" });
    expect(isRunInControl(getFocusRunState().run)).toBe(false);
    expect(getFocusSession().tracking).toBe(false); // this browser only shows it

    takeRunControl(resolve);
    await settle();
    expect(getFocusSession()).toMatchObject({
      tracking: true,
      timer: "pomodoro",
      taskId: "t1",
      pomoLeft: 15 * 60,
    });
    expect(rows[0].deviceId).toBe(runDeviceId());
  });

  it("the device that lost the run stops and gives back what it counted after the takeover", async () => {
    const { rows, rt } = fakeServer();
    const saved: Array<{ taskId: string; seconds: number }> = [];
    registerFocusFlushSink(WS, (taskId, seconds) => {
      saved.push({ taskId, seconds });
      return true;
    });
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    rs.advanceTimersByTime(30_000);
    // The phone takes over 20 s in; this browser hears it only now.
    const takenAt = T0 + 20_000;
    rows[0] = {
      ...rows[0],
      deviceId: "phone-12345",
      controlAt: iso(takenAt),
      seenAt: iso(T0 + 30_500),
    };
    pushRow?.(dbRow(rows[0]));
    await settle();
    expect(getFocusSession().tracking).toBe(false);
    // 20 s counted here; the 10 s after the takeover are the phone's.
    expect(saved.reduce((sum, s) => sum + s.seconds, 0)).toBe(20);
    expect(rows[0].deviceId).toBe("phone-12345"); // this browser didn't end it
  });

  it("an end from another device stops the clock here", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    rows[0] = {
      ...rows[0],
      status: "ended",
      endedAt: iso(Date.now()),
      seenAt: iso(Date.now() + 1),
    };
    await refreshFocusRun();
    await settle();
    expect(getFocusSession().tracking).toBe(false);
    expect(getFocusRunState().run).toBeNull();
  });

  it("a run this device holds but no clock here runs (Stop, then a reload) ends instead of coming back", async () => {
    const { rows, rt } = fakeServer();
    const otherBrowser = "browser-abcdef";
    __setRunDeviceForTest(otherBrowser);
    await rt.startRun({
      workspaceId: WS,
      deviceId: otherBrowser,
      mode: "per_task",
      state: { nowTaskId: "t1" },
    });
    attach(rt);
    await settle();
    expect(getFocusSession().tracking).toBe(false);
    expect(rows[0].status).toBe("ended");
  });

  it("a held end still goes once the window passes", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "off");
    await settle();
    stopFocus();
    __finishRunEndForTest();
    await settle();
    expect(rows[0]).toMatchObject({ status: "ended", mode: "off", focusedSeconds: 0 });
  });

  it("a save that went out before the takeover was heard is given back once", async () => {
    const { rows, rt, givenBack } = fakeServer();
    const saved: number[] = [];
    registerFocusFlushSink(WS, (_taskId, seconds) => {
      saved.push(seconds);
      return true;
    });
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    rs.advanceTimersByTime(30_000);
    toggleFocusRunning(); // pausing saves the 30 s here
    toggleFocusRunning();
    await settle();
    expect(saved.reduce((a, b) => a + b, 0)).toBe(30);
    // The phone had taken it over 10 s before that save; heard only now.
    rows[0] = {
      ...rows[0],
      deviceId: "phone-12345",
      controlAt: iso(T0 + 20_000),
      seenAt: iso(T0 + 31_000),
    };
    pushRow?.(dbRow(rows[0]));
    await settle();
    expect(getFocusSession().tracking).toBe(false);
    expect(givenBack).toEqual([
      expect.objectContaining({ workspaceId: WS, taskId: "t1", seconds: 10 }),
    ]);
    expect(givenBack[0]?.key).toMatch(/^gb-srv-1-/);
  });

  it("a takeover that hasn't reached the server is sent again, not undone", async () => {
    const { rows, rt, givenBack } = fakeServer();
    rs.setSystemTime(T0 - 40 * 60_000);
    await rt.startRun({
      workspaceId: WS,
      deviceId: "desktop-1234",
      mode: "per_task",
      state: { nowTaskId: "t1", status: "running", phaseStartedAt: iso(T0 - 40 * 60_000) },
    });
    rs.setSystemTime(T0);
    attach(rt);
    await settle();
    const save = rt.saveRun;
    rt.saveRun = async () => {
      throw new Error("offline");
    };
    takeRunControl(resolve);
    await settle();
    rs.advanceTimersByTime(61_000);
    await settle();
    // Back online: the server still names the desktop (the take never got there).
    rt.saveRun = save;
    await refreshFocusRun();
    await settle();
    expect(getFocusSession().tracking).toBe(true);
    expect(rows[0].deviceId).toBe(runDeviceId());
    expect(givenBack).toEqual([]);
  });

  it("a refused takeover isn't sent again: the run stays with the device that has it", async () => {
    const { rows, rt } = fakeServer();
    await rt.startRun({
      workspaceId: WS,
      deviceId: "desktop-1234",
      mode: "per_task",
      state: { nowTaskId: "t1", status: "running", phaseStartedAt: iso(T0) },
    });
    attach(rt);
    await settle();
    let saves = 0;
    rt.saveRun = async () => {
      saves += 1;
      throw Object.assign(new Error("No edit access."), { code: "42501" });
    };
    takeRunControl(resolve);
    await settle();
    await refreshFocusRun();
    await settle();
    expect(saves).toBe(1);
    expect(getFocusSession().tracking).toBe(false);
    expect(rows[0].deviceId).toBe("desktop-1234");
  });

  it("a later takeover elsewhere gives back only what this device counted", async () => {
    const { rows, rt, givenBack } = fakeServer();
    const saved: number[] = [];
    registerFocusFlushSink(WS, (_taskId, seconds) => {
      saved.push(seconds);
      return true;
    });
    rs.setSystemTime(T0 - 40 * 60_000);
    await rt.startRun({
      workspaceId: WS,
      deviceId: "desktop-1234",
      mode: "per_task",
      state: { nowTaskId: "t1", status: "running", phaseStartedAt: iso(T0 - 40 * 60_000) },
    });
    rs.setSystemTime(T0);
    attach(rt);
    await settle();
    const save = rt.saveRun;
    rt.saveRun = async () => {
      throw new Error("offline");
    };
    takeRunControl(resolve);
    await settle();
    rs.advanceTimersByTime(30_000);
    toggleFocusRunning(); // pausing saves this device's 30 s
    toggleFocusRunning();
    await settle();
    expect(saved.reduce((a, b) => a + b, 0)).toBe(30);
    // The phone took it 10 s before that save, after this device's take.
    rows[0] = {
      ...rows[0],
      deviceId: "phone-12345",
      controlAt: iso(T0 + 20_000),
      seenAt: iso(T0 + 31_000),
    };
    rt.saveRun = save;
    await refreshFocusRun();
    await settle();
    expect(getFocusSession().tracking).toBe(false);
    // Only the 10 s this device counted after the phone's take; none of the
    // desktop's 40 minutes it took up.
    expect(givenBack).toEqual([expect.objectContaining({ taskId: "t1", seconds: 10 })]);
    rs.advanceTimersByTime(60_000);
    await settle();
    expect(rows[0].deviceId).toBe("phone-12345"); // no take left owed
  });

  it("a give-back that failed is sent again, with the same key", async () => {
    const { rows, rt, givenBack } = fakeServer();
    registerFocusFlushSink(WS, () => true);
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    rs.advanceTimersByTime(30_000);
    toggleFocusRunning();
    toggleFocusRunning();
    await settle();
    const giveBack = rt.giveBackTime;
    rt.giveBackTime = async () => {
      throw new Error("offline");
    };
    rows[0] = {
      ...rows[0],
      deviceId: "phone-12345",
      controlAt: iso(T0 + 20_000),
      seenAt: iso(T0 + 31_000),
    };
    pushRow?.(dbRow(rows[0]));
    await settle();
    expect(givenBack).toEqual([]);
    rt.giveBackTime = giveBack;
    await refreshFocusRun();
    await settle();
    expect(givenBack).toEqual([expect.objectContaining({ taskId: "t1", seconds: 10 })]);
    expect(givenBack[0]?.key).toMatch(/^gb-srv-1-/);
  });
});

describe("Stop, then a new start inside the Undo window", () => {
  it("the stopped run ends with its own numbers before the new one starts", async () => {
    const { rows, rt, ends } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    rs.advanceTimersByTime(25 * 60_000);
    stopFocus();
    rs.advanceTimersByTime(2000);
    focusOnTask(refs.t2, "per_task"); // not Undo: a fresh session
    await settle();
    expect(ends).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ended", focusedSeconds: 25 * 60 });
    expect(rows[1]).toMatchObject({ status: "running", nowTaskId: "t2", focusedSeconds: 0 });
    rs.advanceTimersByTime(STOP_UNDO_MS);
    await settle();
    expect(ends).toHaveLength(1); // nothing ended twice
    expect(rows[1].status).toBe("running");
  });

  it("a refused start isn't sent again on every look", async () => {
    const { rt } = fakeServer();
    let calls = 0;
    rt.startRun = async () => {
      calls += 1;
      throw Object.assign(new Error("You don't have edit access to Tasks in this workspace."), {
        code: "42501",
      });
    };
    attach(rt);
    await settle();
    focusOnTask(refs.t1, "per_task");
    await settle();
    await refreshFocusRun();
    await settle();
    expect(calls).toBe(1);
  });
});
