import { addDays, format, startOfWeek } from "date-fns";
import { CalendarDays, Clock, X } from "lucide-react";
import * as React from "react";

import { formatDay, formatDayTime } from "@/lib/time-format";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { PropertyValue } from "./property-row";

type DateFieldProps = {
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Pair the calendar with an HH:mm time field. */
  withTime?: boolean;
  placeholder?: string;
  /**
   * Trigger look: `ghost` (default) or `outline` buttons, or `property` — a
   * `PropertyValue` for a detail-panel property row (icon slot, no box).
   */
  variant?: "ghost" | "outline" | "property";
  /** The trigger's icon (default: a calendar). */
  icon?: React.ReactNode;
  /** Format the chosen value for the trigger (default: the one grammar, "Tomorrow" /
   * "Tomorrow, 3:00 PM" — src/lib/time-format.ts). */
  formatValue?: (value: Date) => string;
  /** Open the picker on mount (a property row revealed by picking it). */
  defaultOpen?: boolean;
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
};

function applyTime(date: Date, hours: number, minutes: number): Date {
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

const sameMoment = (a: Date | null, b: Date | null) =>
  (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * The editing state behind a date picker that saves once (TV-P0). A date-only
 * pick saves and closes at once. With a time, the day and the time are a
 * draft while the picker is open, and `close()` saves it in one change — so
 * typing "10:30" is one write, not four; Esc drops the draft (`cancel`, from
 * the content's `onEscapeKeyDown`). `close` is what the popover's
 * `onOpenChange(false)` calls; `done` closes the popover itself.
 */
function useDateDraft({
  value,
  onChange,
  withTime,
  open,
  done,
}: {
  value: Date | null;
  onChange: (value: Date | null) => void;
  withTime: boolean;
  /** Whether the picker is showing: a picker closed from outside drops its draft. */
  open: boolean;
  done: () => void;
}) {
  // `undefined` = nothing edited since the picker opened. The ref mirrors it
  // so a second close in the same turn (Radix's focus-outside firing as the
  // content unmounts, on the previous render's handlers) finds nothing left.
  const [draft, setDraftState] = React.useState<Date | null | undefined>(undefined);
  const draftRef = React.useRef<Date | null | undefined>(undefined);
  const setDraft = (next: Date | null | undefined) => {
    draftRef.current = next;
    setDraftState(next);
  };
  React.useEffect(() => {
    if (!open) {
      draftRef.current = undefined;
      setDraftState(undefined);
    }
  }, [open]);
  const shown = draft === undefined ? value : draft;
  const timeStr = shown ? format(shown, "HH:mm") : "09:00";

  const close = () => {
    const pending = draftRef.current;
    draftRef.current = undefined;
    if (pending !== undefined && !sameMoment(pending, value)) onChange(pending);
    setDraftState(undefined);
    done();
  };

  const pickDay = (day: Date | undefined) => {
    if (!day) {
      // Clicking the selected day again: a date-only field clears it.
      if (!withTime) {
        if (value) onChange(null);
        done();
      }
      return;
    }
    if (withTime) {
      const [h, m] = timeStr.split(":").map(Number);
      setDraft(applyTime(day, shown ? shown.getHours() : h, shown ? shown.getMinutes() : m));
      return;
    }
    const next = applyTime(day, 0, 0);
    if (!sameMoment(next, value)) onChange(next);
    done();
  };

  const setTime = (next: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(next);
    if (!match) return; // a half-typed or cleared field moves nothing
    const h = Number(match[1]);
    const m = Number(match[2]);
    setDraft(applyTime(shown ?? new Date(), h, m));
  };

  const clear = () => {
    setDraft(undefined);
    if (value) onChange(null);
    done();
  };

  /** Esc: drop the draft, so the close that follows saves nothing. */
  const cancel = () => setDraft(undefined);

  return { shown, timeStr, withTime, close, pickDay, setTime, clear, cancel };
}

type DateDraft = ReturnType<typeof useDateDraft>;

/**
 * The picker's body — presets (Today / Tomorrow / Next week, the phrases the
 * capture parser understands), the Calendar, an optional time field and Clear —
 * for any popover that edits a date through {@link useDateDraft}.
 */
function DatePickerPanel({ draft }: { draft: DateDraft }) {
  const presets: Array<{ label: string; date: Date }> = (() => {
    const today = new Date();
    return [
      { label: "Today", date: today },
      { label: "Tomorrow", date: addDays(today, 1) },
      { label: "Next week", date: addDays(startOfWeek(today, { weekStartsOn: 1 }), 7) },
    ];
  })();
  return (
    <>
      <div className="flex flex-wrap gap-1 border-b border-border p-2">
        {presets.map((p) => (
          <Button key={p.label} variant="ghost" size="sm" onClick={() => draft.pickDay(p.date)}>
            {p.label}
          </Button>
        ))}
      </div>
      <Calendar
        mode="single"
        selected={draft.shown ?? undefined}
        onSelect={draft.pickDay}
        defaultMonth={draft.shown ?? undefined}
      />
      {draft.withTime ? (
        <div className="flex items-center gap-2 border-t border-border p-2">
          <Clock className="size-icon-sm text-muted-foreground" aria-hidden />
          <Input
            type="time"
            size="sm"
            value={draft.timeStr}
            onChange={(e) => draft.setTime(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                draft.close();
              }
            }}
            className="w-auto"
            aria-label="Time"
          />
        </div>
      ) : null}
      {draft.shown ? (
        <div className="border-t border-border p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-1.5 text-muted-foreground"
            onClick={draft.clear}
          >
            <X aria-hidden />
            Clear
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * Token-routed date (and optional time) picker — replaces the native
 * <input type="date"/datetime-local>. A trigger opens a Popover with the
 * {@link DatePickerPanel}; it saves once (see {@link useDateDraft}).
 */
function DateField({
  value,
  onChange,
  withTime = false,
  placeholder = "Set date",
  variant = "ghost",
  icon,
  formatValue,
  defaultOpen = false,
  className,
  disabled = false,
  ...props
}: DateFieldProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const draft = useDateDraft({ value, onChange, withTime, open, done: () => setOpen(false) });

  const label = value
    ? (formatValue?.(value) ?? (withTime ? formatDayTime(value) : formatDay(value)))
    : placeholder;

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : draft.close())}>
      <PopoverTrigger asChild>
        {variant === "property" ? (
          <PropertyValue
            icon={icon ?? <CalendarDays />}
            empty={!value}
            disabled={disabled}
            // The row's label names the field; the value is the rest of the name.
            aria-label={props["aria-label"] ? `${props["aria-label"]}: ${label}` : undefined}
            className={className}
          >
            {label}
          </PropertyValue>
        ) : (
          <Button
            variant={variant}
            size="sm"
            disabled={disabled}
            aria-label={props["aria-label"] ?? "Set date"}
            className={cn(
              "justify-start gap-1.5 font-normal",
              !value && "text-muted-foreground",
              className,
            )}
          >
            {icon ?? <CalendarDays aria-hidden />}
            {label}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" onEscapeKeyDown={draft.cancel}>
        <DatePickerPanel draft={draft} />
      </PopoverContent>
    </Popover>
  );
}

export type { DateDraft, DateFieldProps };
export { DateField, DatePickerPanel, useDateDraft };
