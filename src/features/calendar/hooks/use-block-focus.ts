// The block focus session (CAL-5, AC10). One session at a time: starting focus
// on another block quietly stops the previous one. Real seconds accrue to the
// task's tracked total via the SAME accumulation path the Tasks execute view
// uses (`addTimeSpent`), flushed on pause / stop / task change / unmount /
// every minute / tab-wake — a crash loses at most a minute.
//
// Accrual is WALL-CLOCK (Date.now() deltas), not a 1 Hz tick: background tabs
// throttle intervals, so a tick-counter would under-credit a long focus while
// the self-ticking readout (wall-clock) showed the true elapsed — the persisted
// total and the displayed/toasted number would silently disagree. Computing the
// delta from the stretch's start instant makes persisted == displayed and is
// immune to throttling. The live readout is a self-ticking <FocusReadout> off
// this state, so the grid never re-renders per second.

import { useCallback, useEffect, useRef, useState } from "react";

/** Persist accrued time at least this often while running. */
const FLUSH_INTERVAL_SECONDS = 60;

export type BlockFocusSession = {
  /** The task under focus, or null when idle. */
  taskId: string | null;
  running: boolean;
  /** Epoch (ms) the current running stretch began — the readout's clock base;
   *  null while paused/idle. */
  runningSinceMs: number | null;
  /** Seconds banked in prior (paused) stretches this session — the readout adds
   *  the live stretch on top. */
  baseSeconds: number;
  start: (taskId: string) => void;
  pause: () => void;
  resume: () => void;
  /** Stop; returns what was logged so the caller can toast it. */
  stop: () => { taskId: string; seconds: number } | null;
};

export function useBlockFocus(
  addTime: (taskId: string, deltaSeconds: number) => void,
): BlockFocusSession {
  const [taskId, setTaskId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runningSinceMs, setRunningSinceMs] = useState<number | null>(null);
  const [baseSeconds, setBaseSeconds] = useState(0);

  const addRef = useRef(addTime);
  addRef.current = addTime;
  const taskRef = useRef<string | null>(null);
  const sinceRef = useRef<number | null>(null); // stretch start instant
  const bankedRef = useRef(0); // seconds from completed (paused) stretches
  const flushedRef = useRef(0); // seconds already sent to the task this session

  const setSince = useCallback((v: number | null) => {
    sinceRef.current = v;
    setRunningSinceMs(v);
  }, []);

  /** Whole seconds worked this session so far (wall-clock, throttle-immune). */
  const sessionSeconds = useCallback((): number => {
    const live =
      sinceRef.current != null
        ? Math.floor((Date.now() - sinceRef.current) / 1000)
        : 0;
    return bankedRef.current + Math.max(0, live);
  }, []);

  /** Send the not-yet-persisted delta to the task's tracked total. */
  const flush = useCallback(() => {
    if (!taskRef.current) return;
    const delta = sessionSeconds() - flushedRef.current;
    if (delta >= 1) {
      addRef.current(taskRef.current, delta);
      flushedRef.current += delta;
    }
  }, [sessionSeconds]);

  // Periodic flush + tab-wake catch-up (a backgrounded tab throttles the
  // interval, but each flush banks the FULL wall-clock delta, so nothing is
  // lost — the wake flush just makes the persisted total fresh sooner).
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(flush, FLUSH_INTERVAL_SECONDS * 1000);
    const onWake = () => flush();
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [running, flush]);

  // Flush on unmount (leaving the calendar page mid-session).
  useEffect(() => () => flush(), [flush]);

  const start = useCallback(
    (id: string) => {
      flush(); // bank whatever the previous session accrued, to the OLD task
      taskRef.current = id;
      bankedRef.current = 0;
      flushedRef.current = 0;
      setTaskId(id);
      setBaseSeconds(0);
      setSince(Date.now());
      setRunning(true);
    },
    [flush, setSince],
  );

  const pause = useCallback(() => {
    if (sinceRef.current == null) return;
    // Bank the running stretch (wall-clock), then flush to the task.
    bankedRef.current += Math.max(0, Math.floor((Date.now() - sinceRef.current) / 1000));
    setSince(null);
    setBaseSeconds(bankedRef.current);
    setRunning(false);
    flush();
  }, [flush, setSince]);

  const resume = useCallback(() => {
    if (!taskRef.current) return;
    setSince(Date.now());
    setRunning(true);
  }, [setSince]);

  const stop = useCallback(() => {
    const id = taskRef.current;
    flush();
    const seconds = sessionSeconds();
    taskRef.current = null;
    bankedRef.current = 0;
    flushedRef.current = 0;
    setTaskId(null);
    setRunning(false);
    setSince(null);
    setBaseSeconds(0);
    return id ? { taskId: id, seconds } : null;
  }, [flush, sessionSeconds, setSince]);

  return { taskId, running, runningSinceMs, baseSeconds, start, pause, resume, stop };
}
