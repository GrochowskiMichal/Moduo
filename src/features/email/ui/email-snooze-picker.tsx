// The snooze picker (EM-6, AC6). A controlled popover anchored to a child trigger
// (opened by the `s` shortcut or a row/reader action): preset choices
// (Later today · Tomorrow · This weekend · Next week) resolved against now, plus a
// custom datetime. Picking resolves to a concrete instant and calls onPick — the
// page owns the optimistic hide + cloud/IMAP writes (email.snooze).

import { useMemo, useState } from "react";
import { CalendarClock, Clock3 } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { normalizeSnoozeAt, snoozePresets } from "../snooze";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (at: Date) => void;
  /** Header copy — "Snooze until" (default) or e.g. "Remind me if no reply". */
  title?: string;
  /** The custom-time confirm button label. */
  confirmLabel?: string;
  /** The anchor — usually an invisible span positioned over the selected row. */
  children: React.ReactNode;
};

/** "Wed, 5:30 PM" — a compact day+time hint for a preset. */
function presetHint(at: Date): string {
  return at.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function EmailSnoozePicker({
  open,
  onOpenChange,
  onPick,
  title = "Snooze until",
  confirmLabel = "Snooze",
  children,
}: Props) {
  const [custom, setCustom] = useState("");
  const [customError, setCustomError] = useState(false);

  // Resolve presets when the picker opens so the times are fresh.
  const presets = useMemo(() => snoozePresets(new Date()), [open]);

  const pick = (at: Date) => {
    onPick(at);
    onOpenChange(false);
    setCustom("");
    setCustomError(false);
  };

  const pickCustom = () => {
    // `datetime-local` value → a local instant.
    const at = normalizeSnoozeAt(new Date(custom), new Date());
    if (!at) {
      setCustomError(true);
      return;
    }
    pick(at);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        <div className="px-2 py-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        <div className="flex flex-col">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => pick(preset.at)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <Clock3 className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{preset.label}</span>
              <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                {presetHint(preset.at)}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-1 border-t border-border px-2 pb-1 pt-2">
          <div className="mb-1 flex items-center gap-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            <CalendarClock className="size-icon-xs" aria-hidden />
            Pick a date &amp; time
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="datetime-local"
              value={custom}
              onChange={(e) => {
                setCustom(e.target.value);
                setCustomError(false);
              }}
              className="h-8 flex-1 text-xs"
              aria-label="Custom snooze date and time"
              aria-invalid={customError || undefined}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!custom}
              onClick={pickCustom}
            >
              {confirmLabel}
            </Button>
          </div>
          {customError ? (
            <p className="mt-1 text-2xs text-destructive" role="alert">
              Pick a time in the future.
            </p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
