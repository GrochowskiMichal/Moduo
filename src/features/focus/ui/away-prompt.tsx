import { useEffect, useSyncExternalStore } from "react";

import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { awayPromptCopy } from "../away-copy";
import { type FocusAwaySummary, resolveFocusAway } from "../engine";

// The full prompt (the Focus view's Now card) and the compact one (the top-bar
// timer's popover) can both be mounted; while a full one is, the compact one
// stays hidden and the timer doesn't offer it, so the question is asked once.
let fullPromptsMounted = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isFullPromptMounted(): boolean {
  return fullPromptsMounted > 0;
}

function setFullPromptMounted(delta: number): void {
  fullPromptsMounted += delta;
  for (const listener of listeners) listener();
}

/** True while the full prompt is on screen (the Focus view is asking already). */
export function useFullAwayPromptShown(): boolean {
  return useSyncExternalStore(subscribe, isFullPromptMounted, isFullPromptMounted);
}

/**
 * "You were away 42m — Keep · Discard · Count as break" (spec §5, F1-3). Quiet
 * and non-modal: away time is held, not credited, until it's answered, and it
 * is discarded if the session ends unanswered. `compact` drops the pomodoro
 * detail line (the top-bar timer's popover).
 */
export function FocusAwayPrompt({
  away,
  compact = false,
  className,
}: {
  away: FocusAwaySummary;
  compact?: boolean;
  className?: string;
}) {
  const fullShown = useFullAwayPromptShown();
  useEffect(() => {
    if (compact) return;
    setFullPromptMounted(1);
    return () => setFullPromptMounted(-1);
  }, [compact]);
  if (compact && fullShown) return null;

  const copy = awayPromptCopy(away);
  return (
    <div
      role="status"
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 font-sans text-xs text-muted-foreground",
        className,
      )}
    >
      <span className="mr-1 min-w-0">
        <span className="text-foreground">{copy.headline}</span>
        {!compact && copy.detail ? <span> {copy.detail}</span> : null}
      </span>
      {copy.hasHeld ? (
        <>
          <Button variant="ghost" size="sm" onClick={() => resolveFocusAway("keep")}>
            {copy.keepLabel}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => resolveFocusAway("discard")}>
            Discard
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => resolveFocusAway("discard")}>
          Dismiss
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => resolveFocusAway("break")}>
        Count as break
      </Button>
    </div>
  );
}
