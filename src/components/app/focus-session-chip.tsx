import { useNavigate } from "@tanstack/react-router";
import { CloudOff, Coffee, Pause, Play } from "lucide-react";
import { useRef } from "react";

import { formatAwaySpan } from "../../features/focus/away-copy";
import { formatFocusClock } from "../../features/focus/clock";
import { toggleFocusRunning, useFocusSession } from "../../features/focus/engine";
import { FocusAwayPrompt, useFullAwayPromptShown } from "../../features/focus/ui/away-prompt";
import { requestFocusView } from "../../features/focus/view-request";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

const buttonFocus =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * The running Focus session's timer, in the top bar left of Help (tasks-v3
 * call 96; it was the bottom-bar chip of DF-11). A session runs whichever
 * module you're in, so it sits with the global controls (principle 48b).
 *
 * Quiet on purpose: the clock in secondary text with a small dot ("18:02";
 * "Break 4:12" on a pomodoro break), no box until hovered, and the task only in
 * the tooltip. Hovering swaps the dot for pause (or resume), and a click on the
 * clock opens Focus. Pausing from here reverses the 2026-06-16 lock that kept
 * the controls Focus-only (call 96).
 *
 * "While you were away" (TV-F1) still waits for an answer from any screen: the
 * timer reads "Away 42m" and a click asks the question in a popover (not on the
 * Focus view, whose Now card asks it already). Stopped
 * with tracked time still unsaved, it says so until the retry lands (F1-7).
 * Renders nothing otherwise.
 *
 * At the 1024px minimum window the right of the top bar has room for about
 * "1:04:12", so the wordy states shorten until that group (an `@container` in
 * app-chrome) is at least `@2xs` wide: a cup for "Break", "Away" without its
 * length, and an icon for "not saved yet". Tooltips and labels say them in full.
 */
export function FocusSessionChip() {
  const session = useFocusSession();
  // On the Focus view the Now card already asks "while you were away".
  const awayAskedThere = useFullAwayPromptShown();
  const navigate = useNavigate();
  const clockRef = useRef<HTMLButtonElement>(null);
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
          data-slot="focus-timer"
          onClick={openFocus}
          aria-label="Focus time not saved yet · retrying, nothing is lost · click to open"
          className={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md font-sans text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground @2xs:px-2 ${buttonFocus}`}
        >
          <CloudOff className="size-4 @2xs:hidden" aria-hidden />
          <span className="hidden @2xs:inline">Focus time not saved yet</span>
        </TooltipTrigger>
        <TooltipContent>Retrying — nothing is lost · click to open Focus</TooltipContent>
      </Tooltip>
    );
  }
  if (!session.taskId) return null;

  const label = session.taskTitle || "Untitled";
  const onBreak = session.pomodoro && session.phase === "break";
  const phaseTip = session.pomodoro ? ` · ${session.phaseLabel}` : "";
  const state = session.running ? "" : " (paused)";
  const unsaved = session.unsaved ? " · time not saved yet" : "";
  const tip = `Focus — ${label}${phaseTip}${state}${unsaved} · click to open`;
  const away = awayAskedThere ? null : session.away;
  const awaySpan = away ? formatAwaySpan(away.awaySeconds) : "";
  const awayTip = `You were away ${awaySpan} · Focus — ${label} · click to answer`;
  const toggleLabel = session.running ? "Pause Focus" : "Resume Focus";
  const ToggleIcon = session.running ? Pause : Play;

  const clockClass = `flex h-8 shrink-0 items-center rounded-md pr-1.5 pl-0.5 font-sans text-xs tabular-nums transition-colors duration-(--motion-fade) ease-(--ease-out) group-hover:text-foreground ${buttonFocus}`;

  return (
    <div
      data-slot="focus-timer"
      className="group flex h-8 shrink-0 items-center rounded-md text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover has-focus-visible:bg-state-hover"
    >
      <Tooltip>
        <TooltipTrigger
          onClick={() => toggleFocusRunning()}
          aria-label={toggleLabel}
          className={`flex size-6 shrink-0 items-center justify-center rounded-sm hover:text-foreground ${buttonFocus}`}
        >
          {/* At rest: a dot while it runs (a cup on a narrow break), pause while paused. */}
          <span className="flex group-hover:hidden group-has-focus-visible:hidden" aria-hidden>
            {!session.running ? (
              <Pause className="size-3" />
            ) : onBreak ? (
              <>
                <Coffee className="size-3 @2xs:hidden" />
                <span className="hidden size-1.5 rounded-full bg-muted-foreground @2xs:block" />
              </>
            ) : (
              <span className="size-1.5 rounded-full bg-muted-foreground" />
            )}
          </span>
          <ToggleIcon
            className="hidden size-3 group-hover:block group-has-focus-visible:block"
            aria-hidden
          />
        </TooltipTrigger>
        <TooltipContent>{toggleLabel}</TooltipContent>
      </Tooltip>
      {away ? (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger aria-label={awayTip} className={`${clockClass} text-foreground`}>
                Away<span className="hidden @2xs:inline">&nbsp;{awaySpan}</span>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>{awayTip}</TooltipContent>
          </Tooltip>
          <PopoverContent
            align="end"
            className="w-80 space-y-1 p-3"
            onCloseAutoFocus={(event) => {
              // Answering unmounts this popover with focus inside it; once the
              // clock is back, focus goes there rather than to <body>.
              const clock = clockRef.current;
              if (!clock) return;
              event.preventDefault();
              clock.focus();
            }}
          >
            <FocusAwayPrompt away={away} compact />
            <Button variant="ghost" size="sm" onClick={openFocus}>
              Open Focus
            </Button>
          </PopoverContent>
        </Popover>
      ) : (
        <Tooltip>
          <TooltipTrigger
            ref={clockRef}
            onClick={openFocus}
            aria-label={tip}
            className={clockClass}
          >
            {onBreak ? (
              <span className="hidden @2xs:inline">{capitalize(session.phaseLabel)}&nbsp;</span>
            ) : null}
            {formatFocusClock(session.bigClock)}
          </TooltipTrigger>
          <TooltipContent>{tip}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
