// "Delete this event?" — a repeating event takes all its occurrences with it.
// Deleting a Google event emails its guests a cancellation, and the dialog
// says who (CALR-8: Google events delete in Google first, with no Undo).

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

/** Who Google will email a cancellation to, as one sentence; null when nobody. */
export function cancellationNotice(
  event: Pick<CalendarEventModel, "sourceAccountId" | "externalEventId" | "attendees">,
): string | null {
  if (!event.sourceAccountId || !event.externalEventId) return null;
  const guests = (event.attendees ?? []).filter((person) => !person.self);
  const first = guests[0];
  if (!first) return null;
  const name = first.name || first.email;
  const others = guests.length - 1;
  const who = others === 0 ? name : `${name} and ${others} ${others === 1 ? "other" : "others"}`;
  return `${who} will get a cancellation from Google.`;
}

type Props = {
  /** The event asked to be deleted (null: closed). */
  event: CalendarEventModel | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function CalendarDeleteDialog({ event, onCancel, onConfirm }: Props) {
  const notice = event ? cancellationNotice(event) : null;
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
            {notice ? ` ${notice}` : null}
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
