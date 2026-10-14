// Pick a day, on its own (TV-U15): Upcoming's drop on Later and "Move all… ·
// Pick…", the Inbox's Snooze → Pick…. The kit's date panel (its presets are
// the capture's phrases) in a small dialog, so a key or a drop can open it
// with nothing to anchor a popover to.

import { DatePickerPanel, useDateDraft } from "../../../components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";

export function DayPickerDialog({
  open,
  title,
  description,
  value = null,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  /** The day shown as picked; none by default, so the panel offers no Clear. */
  value?: Date | null;
  /** A day was picked (local midnight). */
  onPick: (day: Date) => void;
  onClose: () => void;
}) {
  const draft = useDateDraft({
    value,
    onChange: (d) => {
      if (d) onPick(d);
    },
    withTime: false,
    open,
    done: onClose,
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="w-auto max-w-sm gap-0 p-0" onEscapeKeyDown={draft.cancel}>
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DatePickerPanel draft={draft} />
      </DialogContent>
    </Dialog>
  );
}
