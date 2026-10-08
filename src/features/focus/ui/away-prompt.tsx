import { Button } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { awayPromptCopy } from "../away-copy";
import { type FocusAwaySummary, resolveFocusAway } from "../engine";

/**
 * "You were away 42m — Keep · Discard · Count as break" (spec §5, F1-3). Quiet
 * and non-modal: away time is held, not credited, until it's answered, and it
 * is discarded if the session ends unanswered. `compact` drops the pomodoro
 * detail line (the chrome bottom bar).
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
