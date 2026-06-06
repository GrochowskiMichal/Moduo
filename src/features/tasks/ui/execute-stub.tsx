import { Play } from "lucide-react";

import { Button } from "../../../components/ui/button";

type Props = {
  committedCount: number;
  onBackToPlan: () => void;
};

/**
 * Placeholder for Execute mode. The real isolated focus view (Now card + timer +
 * queue) and the "Start my day" ceremony land in Session 3 — this stub keeps the
 * mode toggle honest and visible without implementing the loop.
 */
export function ExecuteStub({ committedCount, onBackToPlan }: Props) {
  return (
    <div className="grid h-full place-content-center gap-4 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Play className="size-5" aria-hidden />
      </div>
      <div className="space-y-1">
        <h2 className="font-display text-xl text-foreground">Execute mode</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          The focused Now card, pomodoro timer, and today’s queue arrive next. For
          now this is a placeholder — keep planning in Plan mode.
        </p>
        {committedCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            {committedCount} task{committedCount === 1 ? "" : "s"} committed for today.
          </p>
        ) : null}
      </div>
      <Button variant="secondary" size="sm" onClick={onBackToPlan} className="mx-auto">
        Back to Plan
      </Button>
    </div>
  );
}
