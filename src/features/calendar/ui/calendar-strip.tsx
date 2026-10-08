// The strip (CAL-4, AC9) — one quiet line above the grid, rendered only when
// non-empty: "· N unfinished from earlier" with two actions, Move to today
// (auto-place all, one Undo) and Review (curate in the right panel). Muted
// text, control-rung buttons, never red, no card, no border shout (§13). The
// conditional mount fades in via the shared chrome-fade-in slot — no
// attention-seeking (§6c).

import { Button } from "../../../components/ui/button";

type Props = {
  count: number;
  canEdit: boolean;
  reviewing: boolean;
  onMoveToToday: () => void;
  onReview: () => void;
};

export function CalendarStrip({ count, canEdit, reviewing, onMoveToToday, onReview }: Props) {
  if (count <= 0) return null;
  return (
    <div
      data-slot="chrome-fade-in"
      className="flex shrink-0 items-center gap-3 px-1 py-1.5 text-sm text-muted-foreground"
    >
      <span>· {count} unfinished from earlier</span>
      {canEdit ? (
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onMoveToToday}>
            Move to today
          </Button>
          <Button
            size="sm"
            variant={reviewing ? "secondary" : "ghost"}
            onClick={onReview}
            aria-pressed={reviewing}
          >
            Review
          </Button>
        </div>
      ) : null}
    </div>
  );
}
