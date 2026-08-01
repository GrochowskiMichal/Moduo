import { useNavigate } from "@tanstack/react-router";
import { Pause } from "lucide-react";

import { requestFocusView, useFocusSession } from "../../features/tasks/focus-session-store";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/**
 * Quiet chrome indicator for a running Focus session (DF-11). Ambient presence
 * only — it mirrors the app-level focus-session store from anywhere in the app
 * and, on click, takes you back to Focus. It is a PASSIVE indicator, never a
 * second live tracker: no pause/stop here (the live tracker stays Focus-only per
 * the 2026-06-16 lock). Renders nothing when no session is being tracked.
 */
export function FocusSessionChip() {
  const session = useFocusSession();
  const navigate = useNavigate();

  if (!session.taskId || !session.tracking) return null;

  const label = session.taskTitle || "Untitled";
  const phase = session.pomodoro ? `${session.phaseLabel} · ` : "";
  const tip = `Focus — ${label}${session.running ? "" : " (paused)"} · click to open`;

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={() => {
          requestFocusView();
          void navigate({ to: "/tasks" });
        }}
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
  );
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
