// The engine's run hand-over (salvaged from #323, TV-F6; AC8.11): taking a run
// over from its shared record (adoptSession), and stopping when another device
// took it, without counting time twice (relinquishSession).

import { describe, expect, it } from "@rstest/core";

import { DEFAULT_FOCUS_PREFS } from "../../lib/focus-prefs";
import {
  adoptSession,
  bindTask,
  blankRecord,
  type FocusRecord,
  type FocusRunClock,
  observe,
  overlapAfter,
  parseRecord,
  relinquishSession,
  setTimer,
  snapshotOf,
  startSession,
  timerOf,
} from "./engine-core";

const P = { ...DEFAULT_FOCUS_PREFS, autoStartNext: false };
const T0 = 1_000_000_000_000;
const task = { id: "t1", title: "t1", bucketName: null, workspaceId: "w" };

function running(at = T0): FocusRecord {
  return startSession(bindTask(blankRecord(at), task, at, P), at, P);
}

function clock(patch: Partial<FocusRunClock>): FocusRunClock {
  return {
    task,
    timer: "per_task",
    running: true,
    phase: "work",
    longBreak: false,
    blocks: 0,
    phaseMs: 0,
    phaseDoneMs: 0,
    taskMs: 0,
    sitMs: 0,
    ...patch,
  };
}

describe("adoptSession", () => {
  it("becomes a Pomodoro run as the record has it: rhythm, blocks, time into the phase", () => {
    const r = adoptSession(
      blankRecord(T0),
      clock({
        timer: "pomodoro",
        blocks: 2,
        phaseMs: 25 * 60_000,
        phaseDoneMs: 10 * 60_000,
        sitMs: 60 * 60_000,
      }),
      T0,
      P,
    );
    const s = snapshotOf(r, T0 + 60_000, P);
    expect(s).toMatchObject({
      taskId: "t1",
      running: true,
      timer: "pomodoro",
      pomodoro: true,
      completedWork: 2,
      pomoLeft: 14 * 60,
    });
    expect(s.sitElapsed).toBe(61 * 60);
  });

  it("a Per task run brings the Now task's own clock", () => {
    const r = adoptSession(
      blankRecord(T0),
      clock({ taskMs: 18 * 60_000, sitMs: 40 * 60_000 }),
      T0,
      P,
    );
    expect(snapshotOf(r, T0 + 2000, P)).toMatchObject({
      timer: "per_task",
      taskSeconds: 18 * 60 + 2,
      bigClock: 18 * 60 + 2,
      sitElapsed: 40 * 60 + 2,
    });
  });

  it("an Off run comes over with no clock", () => {
    const r = adoptSession(blankRecord(T0), clock({ timer: "off" }), T0, P);
    expect(snapshotOf(r, T0 + 60_000, P)).toMatchObject({ timer: "off", bigClock: 0, accrued: 0 });
  });

  it("a paused run comes over paused; a phase past its end rolls on the next look", () => {
    const paused = adoptSession(
      blankRecord(T0),
      clock({ timer: "pomodoro", running: false, phaseMs: 1_500_000, phaseDoneMs: 300_000 }),
      T0,
      P,
    );
    expect(snapshotOf(paused, T0 + 600_000, P)).toMatchObject({ running: false, pomoLeft: 1200 });
    const over = adoptSession(
      blankRecord(T0),
      clock({ timer: "pomodoro", phaseMs: 1_500_000, phaseDoneMs: 9_999_999 }),
      T0,
      P,
    );
    expect(observe(over, T0 + 1000, P).rec.phase).toBe("break");
  });

  it("drops away time held from before (it was the other device's)", () => {
    const away = observe(running(), T0 + 10 * 60_000, P).rec; // a 10 min gap → away block
    expect(away.away).toHaveLength(1);
    expect(adoptSession(away, clock({}), T0 + 10 * 60_000, P).away).toEqual([]);
  });
});

describe("relinquishSession", () => {
  it("takes back the unsaved work credited after the takeover and stops", () => {
    // 2 min on t1, unsaved (looked at every minute: a longer gap is "away").
    const r = observe(observe(running(), T0 + 60_000, P).rec, T0 + 120_000, P).rec;
    expect(r.credits.t1.ms).toBe(120_000);
    const after = relinquishSession(r, T0 + 45_000, T0 + 120_000, P);
    expect(after.credits.t1.ms).toBe(45_000);
    expect(after.tracking).toBe(false);
    expect(after.task).toBeNull();
  });

  it("never takes back more than is unsaved", () => {
    const r = observe(running(), T0 + 60_000, P).rec;
    const saved: FocusRecord = { ...r, credits: { t1: { ...r.credits.t1, ms: 10_000 } } };
    expect(relinquishSession(saved, T0, T0 + 60_000, P).credits.t1).toBeUndefined();
  });

  it("nothing after the takeover: nothing taken back", () => {
    const r = observe(running(), T0 + 60_000, P).rec;
    expect(relinquishSession(r, T0 + 90_000, T0 + 60_000, P).credits.t1.ms).toBe(60_000);
  });

  it("held away time isn't counted, and the time before the gap stays", () => {
    const r = observe(observe(running(), T0 + 30_000, P).rec, T0 + 10 * 60_000, P).rec;
    expect(r.away).toHaveLength(1);
    // The other device took over during the gap.
    const after = relinquishSession(r, T0 + 5 * 60_000, T0 + 10 * 60_000, P);
    expect(after.credits.t1.ms).toBe(30_000);
    expect(after.away).toEqual([]);
  });

  it("gives back only what this device counted, never the time it took up from another", () => {
    // Adopted 40 min from the desktop, then a minute here; a copy names a
    // device that had it from before this device took it up.
    const adopted = adoptSession(blankRecord(T0), clock({ taskMs: 40 * 60_000 }), T0, P);
    const r = observe(adopted, T0 + 60_000, P).rec;
    expect(r.taskMs).toBe(41 * 60_000);
    expect(overlapAfter(r, T0 - 30 * 60_000)).toMatchObject({ unsavedMs: 60_000, savedMs: 0 });
    const saved: FocusRecord = { ...r, credits: {} };
    expect(overlapAfter(saved, T0 - 30 * 60_000)).toMatchObject({ unsavedMs: 0, savedMs: 60_000 });
  });
});

describe("setTimer", () => {
  it("into Pomodoro starts the rhythm over; the same timer again changes nothing", () => {
    const r = observe(running(), T0 + 60_000, P).rec;
    const pomo = setTimer(r, "pomodoro", T0 + 60_000, P);
    expect(pomo).toMatchObject({
      timer: "pomodoro",
      pomodoro: true,
      phase: "work",
      phaseDoneMs: 0,
    });
    expect(setTimer(pomo, "pomodoro", T0 + 60_000, P)).toBe(pomo);
  });

  it("Per task ↔ Off keeps the clocks where they are", () => {
    const r = observe(running(), T0 + 60_000, P).rec;
    const off = setTimer(r, "off", T0 + 60_000, P);
    expect(off).toMatchObject({ timer: "off", sitMs: 60_000, taskMs: 60_000 });
    expect(timerOf(off)).toBe("off");
  });

  it("a stored record with a timer this build doesn't know still parses (the session lives)", () => {
    const raw = JSON.stringify({ ...running(), timer: "metronome" });
    const parsed = parseRecord(raw);
    expect(parsed?.tracking).toBe(true);
    expect(parsed && timerOf(parsed)).toBe("per_task");
  });
});
