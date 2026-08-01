// DB-6 — "Pomodoro" widget (S). A focus/break timer: work↔break auto-switch,
// wall-clock `endsAtMs` accrual (throttle-immune), 250ms tick. Durations come from
// config (default 25/5; edited in the DB-8 popover). Running state is ephemeral —
// a page switch resets it (a dashboard timer needn't survive navigation).

import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

import type { WidgetComponentProps } from "../../registry/types";

type Phase = "work" | "break";

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const v = config[key];
  return typeof v === "number" && v > 0 ? v : fallback;
}

function phaseSeconds(phase: Phase, work: number, brk: number): number {
  return (phase === "work" ? work : brk) * 60;
}

function formatMMSS(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function PomodoroWidget({ widget }: WidgetComponentProps) {
  const workMinutes = num(widget.config, "pomodoroWorkMinutes", 25);
  const breakMinutes = num(widget.config, "pomodoroBreakMinutes", 5);

  const [phase, setPhase] = useState<Phase>("work");
  const [running, setRunning] = useState(false);
  const [endsAtMs, setEndsAtMs] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(() => phaseSeconds("work", workMinutes, breakMinutes));

  useEffect(() => {
    if (!running || endsAtMs == null) return;
    const tick = () => {
      const next = Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000));
      if (next > 0) {
        setRemaining(next);
        return;
      }
      // Expired → auto-switch phase and keep running.
      const nextPhase: Phase = phase === "work" ? "break" : "work";
      const nextSeconds = phaseSeconds(nextPhase, workMinutes, breakMinutes);
      setPhase(nextPhase);
      setRemaining(nextSeconds);
      setEndsAtMs(Date.now() + nextSeconds * 1000);
    };
    tick();
    const interval = window.setInterval(tick, 250);
    return () => window.clearInterval(interval);
  }, [running, endsAtMs, phase, workMinutes, breakMinutes]);

  const start = () => {
    if (running) return;
    setRunning(true);
    setEndsAtMs(Date.now() + remaining * 1000);
  };
  const pause = () => {
    if (!running) return;
    setRemaining(endsAtMs ? Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000)) : remaining);
    setRunning(false);
    setEndsAtMs(null);
  };
  const reset = () => {
    setRunning(false);
    setEndsAtMs(null);
    setRemaining(phaseSeconds(phase, workMinutes, breakMinutes));
  };
  const skip = () => {
    const nextPhase: Phase = phase === "work" ? "break" : "work";
    const nextSeconds = phaseSeconds(nextPhase, workMinutes, breakMinutes);
    setPhase(nextPhase);
    setRemaining(nextSeconds);
    setEndsAtMs(running ? Date.now() + nextSeconds * 1000 : null);
  };

  const total = phaseSeconds(phase, workMinutes, breakMinutes);
  const progress = total > 0 ? Math.min(100, Math.max(0, ((total - remaining) / total) * 100)) : 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-3">
      <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {phase === "work" ? "Focus" : "Break"}
      </span>
      <p className="font-display text-3xl font-semibold tabular-nums text-foreground">
        {formatMMSS(remaining)}
      </p>
      <div className="h-1 w-full max-w-[8rem] overflow-hidden rounded-full bg-foreground/15">
        <div
          className="h-full rounded-full bg-foreground/70 transition-[width] duration-[var(--motion-fade)]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex items-center gap-1">
        {running ? (
          <IconButton icon={Pause} label="Pause" onClick={pause} />
        ) : (
          <button
            type="button"
            onClick={start}
            aria-label="Start"
            className={cn(
              "grid size-[var(--ctrl-h-sm)] place-items-center rounded-full bg-primary text-primary-foreground",
              "hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <Play className="size-icon-sm" aria-hidden />
          </button>
        )}
        <IconButton icon={RotateCcw} label="Reset" onClick={reset} />
        <IconButton
          icon={SkipForward}
          label={phase === "work" ? "Skip to break" : "Skip to focus"}
          onClick={skip}
        />
      </div>
    </div>
  );
}
