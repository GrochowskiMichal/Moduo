import { useEffect, useMemo, useState } from "react";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;

function clampMinutes(value: number | undefined, fallback: number, min: number, max: number): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(max, Math.max(min, Math.round(next)));
}

function sessionSeconds(mode: "work" | "break", workMinutes: number, breakMinutes: number): number {
  return (mode === "work" ? workMinutes : breakMinutes) * 60;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

type Props = {
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function PomodoroWidget({ config, isLocked, onUpdateConfig }: Props) {
  const workMinutes = clampMinutes(config.pomodoroWorkMinutes, DEFAULT_WORK_MINUTES, 5, 90);
  const breakMinutes = clampMinutes(config.pomodoroBreakMinutes, DEFAULT_BREAK_MINUTES, 1, 30);
  const [mode, setMode] = useState<"work" | "break">("work");
  const [isRunning, setIsRunning] = useState(false);
  const [endsAtMs, setEndsAtMs] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState(() => sessionSeconds("work", workMinutes, breakMinutes));

  useEffect(() => {
    if (isRunning) return;
    setRemainingSec(sessionSeconds(mode, workMinutes, breakMinutes));
  }, [mode, workMinutes, breakMinutes, isRunning]);

  useEffect(() => {
    if (!isRunning || !endsAtMs) return;
    const tick = () => {
      const nextRemaining = Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000));
      if (nextRemaining > 0) {
        setRemainingSec(nextRemaining);
        return;
      }
      const nextMode = mode === "work" ? "break" : "work";
      const nextSeconds = sessionSeconds(nextMode, workMinutes, breakMinutes);
      setMode(nextMode);
      setRemainingSec(nextSeconds);
      setEndsAtMs(Date.now() + nextSeconds * 1000);
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [isRunning, endsAtMs, mode, workMinutes, breakMinutes]);

  const totalSec = useMemo(() => sessionSeconds(mode, workMinutes, breakMinutes), [mode, workMinutes, breakMinutes]);
  const progressPct = Math.min(100, Math.max(0, ((totalSec - remainingSec) / totalSec) * 100));

  const start = () => {
    if (isRunning) return;
    setIsRunning(true);
    setEndsAtMs(Date.now() + remainingSec * 1000);
  };

  const pause = () => {
    if (!isRunning) return;
    const nextRemaining = endsAtMs ? Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000)) : remainingSec;
    setRemainingSec(nextRemaining);
    setIsRunning(false);
    setEndsAtMs(null);
  };

  const reset = () => {
    const next = sessionSeconds(mode, workMinutes, breakMinutes);
    setIsRunning(false);
    setEndsAtMs(null);
    setRemainingSec(next);
  };

  const skip = () => {
    const nextMode = mode === "work" ? "break" : "work";
    const nextSeconds = sessionSeconds(nextMode, workMinutes, breakMinutes);
    setMode(nextMode);
    setRemainingSec(nextSeconds);
    setEndsAtMs(isRunning ? Date.now() + nextSeconds * 1000 : null);
  };

  return (
    <WidgetShell
      config={config}
      title="Pomodoro"
      controls={
        !isLocked ? (
          <div className="flex items-center gap-1.5 text-[11px] text-[#9a9a9a]">
            <input
              type="number"
              min={5}
              max={90}
              step={1}
              value={workMinutes}
              onChange={(event) => onUpdateConfig({ pomodoroWorkMinutes: clampMinutes(Number(event.target.value), workMinutes, 5, 90) })}
              className="w-10 rounded border border-[#2b2b2b] bg-[#141414] px-1 py-0.5 text-center text-[11px] text-[#cfcfcf] outline-none"
            />
            <span>work</span>
            <input
              type="number"
              min={1}
              max={30}
              step={1}
              value={breakMinutes}
              onChange={(event) => onUpdateConfig({ pomodoroBreakMinutes: clampMinutes(Number(event.target.value), breakMinutes, 1, 30) })}
              className="w-10 rounded border border-[#2b2b2b] bg-[#141414] px-1 py-0.5 text-center text-[11px] text-[#cfcfcf] outline-none"
            />
            <span>break</span>
          </div>
        ) : null
      }
    >

      <div className="flex flex-1 flex-col items-center justify-center px-3 py-3">
        <p className={`text-[11px] uppercase tracking-[0.08em] ${mode === "work" ? "text-[#f0c77d]" : "text-[#9fcdff]"}`}>
          {mode === "work" ? "Focus" : "Break"}
        </p>
        <p className="mt-1 text-[34px] font-semibold leading-none text-[#f1f1f1]">{formatDuration(remainingSec)}</p>
        <div className="mt-3 h-1.5 w-full rounded bg-[#1e1e1e]">
          <div className="h-full rounded bg-[#8db7ff] transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={isRunning ? pause : start}
            className="rounded-md border border-[#2b2b2b] bg-[#151515] px-2.5 py-1 text-[11px] text-[#e3e3e3] hover:bg-[#1a1a1a]"
          >
            {isRunning ? "Pause" : "Start"}
          </button>
          <button
            onClick={reset}
            className="rounded-md border border-[#2b2b2b] bg-[#151515] px-2.5 py-1 text-[11px] text-[#bfbfbf] hover:bg-[#1a1a1a]"
          >
            Reset
          </button>
          <button
            onClick={skip}
            className="rounded-md border border-[#2b2b2b] bg-[#151515] px-2.5 py-1 text-[11px] text-[#bfbfbf] hover:bg-[#1a1a1a]"
          >
            Skip
          </button>
        </div>
      </div>
    </WidgetShell>
  );
}
