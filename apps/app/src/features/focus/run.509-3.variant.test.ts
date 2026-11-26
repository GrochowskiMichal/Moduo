// HV-15 variant of benchmarks/escapes/509-3-signout-wipes-outbox: signing out drops the Focus
// run's writes that still wait to go (a give-back that failed offline, a Stop inside its Undo
// window), so they never reach the server, even when the same person signs back in here.
// Fixed in MOD-718/719 (owed.ts keeps them on the device); kept as the regression test.
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import {
  __resetFocusEngineForTest,
  attachFocusUser,
  focusOnTask,
  registerFocusFlushSink,
  stopFocus,
  toggleFocusRunning,
} from "./engine";
import {
  __flushRunSyncForTest,
  __resetFocusRunForTest,
  attachRunUser,
  refreshFocusRun,
} from "./run";
import type { FocusRun, FocusRunRuntime, FocusRunSnapshot } from "./run-model";

const USER = "u1";
const WS = "w1";
const T0 = Date.parse("2026-10-13T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const t1 = { id: "t1", title: "Fix the checkbox", bucketName: "Inbox", workspaceId: WS };

/** focus_runs as the server keeps it (the same rules as run.test.ts's fake). */
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

/** SIGNED_OUT as auth-provider runs it, then the same person signing back in. */
async function signOutAndBackIn(rt: FocusRunRuntime) {
  attachFocusUser(null);
  attachRunUser(null, null);
  await settle();
  rs.advanceTimersByTime(20_000);
  attachFocusUser(USER);
  attach(rt);
  await settle();
  await refreshFocusRun();
  await settle();
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

describe("HV-15 variant 509-3: sign-out drops the Focus run's waiting writes", () => {
  it("a give-back that failed offline is still sent once the person signs back in", async () => {
    const { rows, rt, givenBack } = fakeServer();
    registerFocusFlushSink(WS, () => true);
    attach(rt);
    await settle();
    focusOnTask(t1, "per_task");
    await settle();
    rs.advanceTimersByTime(30_000);
    toggleFocusRunning();
    toggleFocusRunning();
    await settle();
    const giveBack = rt.giveBackTime;
    rt.giveBackTime = async () => {
      throw new Error("offline");
    };
    // The phone took the run over 20 s in; the 10 s counted here after it are owed back.
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
    await signOutAndBackIn(rt);
    // The task's time counts those 10 s twice unless the give-back still goes.
    expect(givenBack).toEqual([expect.objectContaining({ taskId: "t1", seconds: 10 })]);
  });

  it("a Stop inside the Undo window still ends the run with its final numbers", async () => {
    const { rows, rt } = fakeServer();
    attach(rt);
    await settle();
    focusOnTask(t1, "per_task");
    await settle();
    rs.advanceTimersByTime(90_000);
    stopFocus();
    await settle();
    // "Done for the day": Stop, then Log out at once.
    await signOutAndBackIn(rt);
    expect(rows[0]).toMatchObject({ status: "ended", focusedSeconds: 90 });
  });
});
