// "This event / All events" (CALR-11, AC44): moving, editing or deleting one
// occurrence of a repeating event asks which. ↵ picks This event (it holds the
// focus), esc cancels. All events can be off for a change it can't make yet
// (moving a whole Google repeat).

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { useReturnFocus } from "../../../hooks/use-return-focus";
import type { OccurrenceScope } from "../occurrence-edit";

export type OccurrenceQuestion = {
  /** What is being done: the title and the delete button follow it. */
  action: "change" | "delete";
  title: string;
  allEvents: boolean;
  /** A line under the question (Google's cancellation notice). */
  note?: string | null;
};

type Props = {
  question: OccurrenceQuestion | null;
  onAnswer: (scope: OccurrenceScope) => void;
  onCancel: () => void;
};

export function OccurrenceScopeDialog({ question, onAnswer, onCancel }: Props) {
  const deleting = question?.action === "delete";
  // Opened by a drop, a key or a panel edit, never a trigger: focus goes back there.
  const returnFocus = useReturnFocus(question !== null);
  return (
    <Dialog open={question !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>
            {deleting ? "Delete a repeating event" : "Change a repeating event"}
          </DialogTitle>
          <DialogDescription>
            {`"${question?.title ?? ""}" repeats. ${deleting ? "Delete" : "Change"} just this one, or every occurrence?`}
            {!question?.allEvents ? " A Google repeat moves one occurrence at a time here." : null}
            {question?.note ? ` ${question.note}` : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onCancel()}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!question?.allEvents}
            onClick={() => onAnswer("all")}
          >
            All events
          </Button>
          <Button
            variant={deleting ? "destructive" : "default"}
            size="sm"
            autoFocus
            onClick={() => onAnswer("this")}
          >
            This event
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
