// A repeat moved to another day (27 g, TV-D12's two ways): just this one (the
// next one is back on the pattern), or the pattern itself. Upcoming's drag
// asked first (TV-U15); a selection's bulk Date asks the same (TV-U12, spec
// edge case: "Move just these occurrences · Change the patterns", the
// occurrences by default). Lifted here so both, and the Timeline later, share it.

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { Task } from "../model";

export function RepeatMoveDialog({
  open,
  tasks,
  dayLabel,
  onChoose,
  onClose,
}: {
  open: boolean;
  tasks: readonly Task[];
  /** Where they go: "Thu", "Tomorrow", "a day later". */
  dayLabel: string;
  onChoose: (choice: "one" | "pattern") => void;
  onClose: () => void;
}) {
  const repeats = tasks.filter((t) => t.recurrence).length;
  const title =
    tasks.length === 1
      ? `Move “${tasks[0]?.title || "Untitled"}” to ${dayLabel}`
      : `Move ${tasks.length} tasks to ${dayLabel}`;
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {repeats === 1 && tasks.length === 1
              ? "It repeats. Move just this one, and the next one is back on the pattern, or change the pattern from here on."
              : `${repeats === 1 ? "One of them repeats" : `${repeats} of them repeat`}. Move just these, or change their patterns from here on.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => onChoose("pattern")}>
            Change the pattern
          </Button>
          <Button autoFocus onClick={() => onChoose("one")}>
            {tasks.length === 1 ? "Just this one" : "Just these"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
