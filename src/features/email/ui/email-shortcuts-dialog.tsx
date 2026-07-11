// The `?` keyboard-map dialog (DF-6 ride-along, critique §4.6): the email
// triage keys were undiscoverable — this is the compact in-place reference.
// Opened by `?` on /email (desktop); presentational, page owns the open state.

import { Fragment } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Kbd } from "../../tasks/ui/task-detail-panel";

const SHORTCUTS: Array<[keys: string, label: string]> = [
  ["j / k", "Next / previous conversation"],
  ["Enter", "Open conversation"],
  ["r", "Reply"],
  ["e", "Archive"],
  ["t", "Convert to task"],
  ["s", "Snooze"],
  ["m", "Move to folder"],
  ["p", "Pin / unpin"],
  ["#", "Delete"],
  ["/", "Search"],
  ["?", "This help"],
];

export function EmailShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Triage your inbox without the mouse.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
          {SHORTCUTS.map(([keys, label]) => (
            <Fragment key={keys}>
              <dt>
                <Kbd>{keys}</Kbd>
              </dt>
              <dd className="text-sm text-muted-foreground">{label}</dd>
            </Fragment>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
