import { useNavigate } from "@tanstack/react-router";
import { Pause } from "lucide-react";

import { useFocusSession } from "../../features/focus/engine";
import { isRunInControl, useQueueRunState, useRunReading } from "../../features/focus/run";
import { formatClock } from "../../features/focus/run-model";
import { FocusAwayPrompt } from "../../features/focus/ui/away-prompt";
import { LiveDot } from "../../features/focus/ui/live-dot";
import { requestFocusView } from "../../features/focus/view-request";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const chipClass =
  "flex h-8 max-w-64 items-center gap-1.5 rounded-md bg-card px-2.5 text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The run follows you around the app (TV-F2, F2-3): while a queue run is on,
 * the chip shows its phase, clock and Now task, and a click goes back to the
 * Queue. A run another of your devices is running shows read through. It never
 * pauses or stops the clock itself; the one thing it answers is "while you were
 * away" (TV-F1), so held time can be kept from any screen. With no run it shows
 * a session left over from before runs, or tracked time still waiting to save.
 */
export function FocusSessionChip() {
  const session = useFocusSession();
  const { run } = useQueueRunState();
  const reading = useRunReading(run);
  const navigate = useNavigate();
  const openRun = () => {
    requestFocusView();
    void navigate({ to: "/tasks" });
  };

  if (run && reading) {
    const inControl = isRunInControl(run) && session.tracking;
    const label = (inControl ? session.taskTitle : run.nowTitle) || "Queue run";
    const phase = !reading.pomodoro
      ? ""
      : reading.phase === "work"
        ? "Focus "
        : reading.phase === "long_break"
          ? "Long break "
          : "Break ";
    const state = reading.running ? "" : " (paused)";
    const where = inControl ? "" : " · on your other device";
    const unsaved = session.unsaved ? " · time not saved yet" : "";
    const tip = `Queue run — ${label}${state}${where}${unsaved} · click to open`;
    return (
      <>
        <Tooltip>
          <TooltipTrigger onClick={openRun} aria-label={tip} className={chipClass}>
            {reading.running ? (
              <LiveDot />
            ) : (
              <Pause className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="shrink-0 font-sans text-xs tabular-nums text-foreground">
              {phase}
              {formatClock(reading.bigClock)}
            </span>
            <span className="min-w-0 flex-1 truncate font-sans text-xs text-muted-foreground">
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent>{tip}</TooltipContent>
        </Tooltip>
        {inControl && session.away ? <FocusAwayPrompt away={session.away} compact /> : null}
      </>
    );
  }

  if (!session.tracking) {
    // Stopped, but some tracked time hasn't saved yet: keep that visible (F1-7).
    if (!session.unsaved) return null;
    return (
      <Tooltip>
        <TooltipTrigger
          onClick={openRun}
          aria-label="Focus time not saved yet · retrying, nothing is lost · click to open"
          className={`${chipClass} font-sans text-xs text-muted-foreground`}
        >
          Focus time not saved yet
        </TooltipTrigger>
        <TooltipContent>Retrying — nothing is lost · click to open the Queue</TooltipContent>
      </Tooltip>
    );
  }
  if (!session.taskId) return null;

  const label = session.taskTitle || "Untitled";
  const phase = session.pomodoro ? `${session.phaseLabel} · ` : "";
  const state = session.running ? "" : " (paused)";
  const unsaved = session.unsaved ? " · time not saved yet" : "";
  const tip = `Focus — ${label}${state}${unsaved} · click to open`;

  return (
    <>
      <Tooltip>
        <TooltipTrigger onClick={openRun} aria-label={tip} className={chipClass}>
          {session.running ? (
            <span
              className="track-pulse size-1.5 shrink-0 rounded-full bg-muted-foreground"
              aria-hidden
            />
          ) : (
            <Pause className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="shrink-0 font-sans text-xs tabular-nums text-foreground">
            {phase}
            {formatClock(session.bigClock)}
          </span>
          <span className="min-w-0 flex-1 truncate font-sans text-xs text-muted-foreground">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>{tip}</TooltipContent>
      </Tooltip>
      {session.away ? <FocusAwayPrompt away={session.away} compact /> : null}
    </>
  );
}
