// "Delete this event?" — a repeating event takes all its occurrences with it.

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { CalendarEventModel } from "../events";

type Props = {
  /** The event asked to be deleted (null: closed). */
  event: CalendarEventModel | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CalendarDeleteDialog({ event, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={event !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {event?.rrule ? "Delete this repeating event?" : "Delete this event?"}
          </DialogTitle>
          <DialogDescription>
            {event?.rrule
              ? "All occurrences go with it."
              : `"${event?.title ?? ""}" will be removed from the calendar.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onCancel()}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
