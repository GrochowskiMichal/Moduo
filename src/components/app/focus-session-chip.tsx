import { useNavigate } from "@tanstack/react-router";
import { Pause } from "lucide-react";

import { useFocusSession } from "../../features/focus/engine";
import { FocusAwayPrompt } from "../../features/focus/ui/away-prompt";
import { requestFocusView } from "../../features/focus/view-request";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/**
 * Quiet chrome indicator for a running Focus session (DF-11). It mirrors the
 * app-level focus engine from anywhere in the app and, on click, takes you back
 * to Focus. It never pauses or stops the clock (the live tracker stays
 * Focus-only per the 2026-06-16 lock); the one thing it answers is "while you
 * were away" (TV-F1, spec §5), so held time can be kept from any screen.
 * Renders nothing when no session is being tracked, unless tracked time is
 * still waiting to be saved.
 */
export function FocusSessionChip() {
  const session = useFocusSession();
  const navigate = useNavigate();
  const openFocus = () => {
    requestFocusView();
    void navigate({ to: "/tasks" });
  };

  if (!session.tracking) {
    // Stopped, but some tracked time hasn't saved yet: keep that visible (F1-7).
    if (!session.unsaved) return null;
    return (
      <Tooltip>
        <TooltipTrigger
          onClick={openFocus}
          aria-label="Focus time not saved yet · retrying, nothing is lost · click to open"
          className="flex h-8 items-center gap-1.5 rounded-md bg-card px-2.5 font-sans text-xs text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Focus time not saved yet
        </TooltipTrigger>
        <TooltipContent>Retrying — nothing is lost · click to open Focus</TooltipContent>
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
        <TooltipTrigger
          onClick={openFocus}
          aria-label={tip}
          className="flex h-8 max-w-[16rem] items-center gap-1.5 rounded-md bg-card px-2.5 text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
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

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
