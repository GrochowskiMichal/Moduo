// One booking link in the rail: its name (opens the editor), whether it's
// paused, a hover copy, and the same menu from ⋯ and from a right-click:
// its status, Copy link, Edit…, Pause or Publish, and Delete… behind a
// confirmation.

import { Check, Copy, Link, MoreHorizontal } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";

type Props = {
  name: string;
  paused: boolean;
  /** Why guests can't book it, or null when they can (Copy waits for it). */
  blocker: string | null;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onTogglePause: () => void;
  onDelete: () => void;
};

type MenuParts = {
  Item: typeof DropdownMenuItem | typeof ContextMenuItem;
  Separator: typeof DropdownMenuSeparator | typeof ContextMenuSeparator;
};

const DROPDOWN: MenuParts = {
  Item: DropdownMenuItem,
  Separator: DropdownMenuSeparator,
};
const CONTEXT: MenuParts = {
  Item: ContextMenuItem,
  Separator: ContextMenuSeparator,
};

function statusLine(paused: boolean, blocker: string | null): string {
  if (paused) return "Paused · not taking bookings";
  if (blocker) return blocker;
  return "Published · taking bookings";
}

export function BookingLinkRow({
  name,
  paused,
  blocker,
  copied,
  onCopy,
  onEdit,
  onTogglePause,
  onDelete,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  // Delete… opens its confirmation once the menu has closed (focus goes there, not back to ⋯).
  const pending = useRef(false);
  const afterClose = (e: Event) => {
    if (!pending.current) return;
    pending.current = false;
    e.preventDefault();
    setConfirming(true);
  };
  const items = ({ Item, Separator }: MenuParts): ReactNode => (
    <>
      <p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">
        {statusLine(paused, blocker)}
      </p>
      <Item disabled={paused || blocker !== null} onSelect={onCopy}>
        Copy link
      </Item>
      <Item onSelect={onEdit}>Edit…</Item>
      <Item onSelect={onTogglePause}>{paused ? "Publish" : "Pause"}</Item>
      <Separator />
      <Item variant="destructive" onSelect={() => (pending.current = true)}>
        Delete…
      </Item>
    </>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="group/booking-row flex min-h-(--row-h-sm) items-center gap-2 rounded-md px-1 hover:bg-state-hover">
            <Link aria-hidden className="size-icon-xs shrink-0 text-muted-foreground" />
            <button
              type="button"
              className={
                paused
                  ? "min-w-0 flex-1 truncate text-left text-sm text-muted-foreground"
                  : "min-w-0 flex-1 truncate text-left text-sm text-foreground"
              }
              onClick={onEdit}
            >
              {name}
            </button>
            {paused ? <span className="shrink-0 text-xs text-muted-foreground">Paused</span> : null}
            {copied ? (
              <output className="shrink-0 text-xs text-muted-foreground">Copied</output>
            ) : null}
            <div className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/booking-row:opacity-100 group-focus-within/booking-row:opacity-100 has-[[data-state=open]]:opacity-100">
              <IconButton
                icon={copied ? Check : Copy}
                label={`Copy link to ${name}`}
                disabled={paused || blocker !== null}
                onClick={onCopy}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton icon={MoreHorizontal} label={`${name} options`} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onCloseAutoFocus={afterClose}>
                  {items(DROPDOWN)}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent onCloseAutoFocus={afterClose}>{items(CONTEXT)}</ContextMenuContent>
      </ContextMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone who opens it will see it's no longer available. Meetings already booked stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              Delete link
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
