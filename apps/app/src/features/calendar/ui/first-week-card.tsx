// "Your week is open" (CALR-3): the first-week card, low on the grid and
// closable (esc), for a calendar with nothing on it yet. It offers New event,
// Connect Google Calendar and three keys. The typed example joins it with the
// typed composer; today an event is drawn on the grid or opened with ⌘N.

import { X } from "lucide-react";
import { useEffect } from "react";

import { Button } from "../../../components/ui/button";
import { Kbd } from "../../../components/ui/kbd";

const KEYS: readonly { key: string; label: string }[] = [
  { key: "T", label: "today" },
  { key: "D", label: "day" },
  { key: "W", label: "week" },
];

/** Esc that belongs to a field, a dialog or a menu stays theirs. */
function isOwnedElsewhere(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu'], [role='listbox']",
    ),
  );
}

export function FirstWeekCard({
  onNewEvent,
  onConnectGoogle,
  onClose,
}: {
  onNewEvent: () => void;
  onConnectGoogle: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isOwnedElsewhere(e.target)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-(--z-sticky) flex justify-center px-4">
      <section
        aria-label="Your week is open"
        data-first-week
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-xl border border-border bg-popover p-4 shadow-lg"
      >
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 className="font-display text-base font-medium text-foreground">
              Your week is open
            </h2>
            <p className="text-sm text-muted-foreground">
              Draw on the grid to block time, or drag a task from the right to plan it.
            </p>
          </div>
          {/* A plain button: the card has nothing a tooltip would add to "Close". */}
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X aria-hidden />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onNewEvent}>
            New event <Kbd>⌘N</Kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={onConnectGoogle}>
            Connect Google Calendar
          </Button>
        </div>
        <div
          data-first-week-keys
          className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"
        >
          {KEYS.map(({ key, label }) => (
            <span key={key} className="inline-flex items-center gap-1">
              <Kbd>{key}</Kbd>
              {label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
