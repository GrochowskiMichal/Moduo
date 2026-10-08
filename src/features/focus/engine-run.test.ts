// The engine's run hand-over (TV-F2): taking a run over from its shared record
// (adoptSession), and stopping when another device took it, without counting
// time twice (relinquishSession).

import { describe, expect, it } from "@rstest/core";

import { DEFAULT_FOCUS_PREFS } from "../../lib/focus-prefs";
import {
  adoptSession,
  bindTask,
  blankRecord,
  type FocusRecord,
  observe,
  relinquishSession,
  setPomodoro,
  snapshotOf,
  startSession,
} from "./engine-core";

const P = { ...DEFAULT_FOCUS_PREFS, autoStartNext: false };
const T0 = 1_000_000_000_000;
const task = { id: "t1", title: "t1", bucketName: null, workspaceId: "w" };

function running(at = T0): FocusRecord {
  return startSession(bindTask(blankRecord(at), task, at, P), at, P);
}

describe("adoptSession", () => {
  it("becomes the run as the record has it: rhythm, blocks, time into the phase", () => {
    const r = adoptSession(
      blankRecord(T0),
      {
        task,
        pomodoro: true,
        running: true,
        phase: "work",
        longBreak: false,
        blocks: 2,
        phaseMs: 25 * 60_000,
        phaseDoneMs: 10 * 60_000,
        sitMs: 60 * 60_000,
      },
      T0,
      P,
    );
    const s = snapshotOf(r, T0 + 60_000, P);
    expect(s).toMatchObject({
      taskId: "t1",
      running: true,
      pomodoro: true,
      completedWork: 2,
      pomoLeft: 14 * 60,
    });
    expect(s.sitElapsed).toBe(61 * 60);
  });

  it("a paused run comes over paused; a phase past its end rolls on the next look", () => {
    const paused = adoptSession(
      blankRecord(T0),
      {
        task,
        pomodoro: true,
        running: false,
        phase: "work",
        longBreak: false,
        blocks: 0,
        phaseMs: 1_500_000,
        phaseDoneMs: 300_000,
        sitMs: 0,
      },
      T0,
      P,
    );
    expect(snapshotOf(paused, T0 + 600_000, P)).toMatchObject({ running: false, pomoLeft: 1200 });
    const over = adoptSession(
      blankRecord(T0),
      {
        task,
        pomodoro: true,
        running: true,
        phase: "work",
        longBreak: false,
        blocks: 0,
        phaseMs: 1_500_000,
        phaseDoneMs: 9_999_999,
        sitMs: 0,
      },
      T0,
      P,
    );
    expect(observe(over, T0 + 1000, P).rec.phase).toBe("break");
  });

  it("drops away time held from before (it was the other device's)", () => {
    const r = running();
    const away = observe(r, T0 + 10 * 60_000, P).rec; // 10 min gap → away block
    expect(away.away).toHaveLength(1);
    const adopted = adoptSession(
      away,
      {
        task,
        pomodoro: false,
        running: true,
        phase: "work",
        longBreak: false,
        blocks: 0,
        phaseMs: 0,
        phaseDoneMs: 0,
        sitMs: 0,
      },
      T0 + 10 * 60_000,
      P,
    );
    expect(adopted.away).toEqual([]);
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
    const after = relinquishSession(saved, T0, T0 + 60_000, P);
    expect(after.credits.t1).toBeUndefined();
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
});

describe("setPomodoro", () => {
  it("sets the mode, and leaves it when it's already that", () => {
    const r = running();
    expect(setPomodoro(r, true, T0, P).pomodoro).toBe(true);
    const on = setPomodoro(r, true, T0, P);
    expect(setPomodoro(on, true, T0, P)).toBe(on);
  });
});
