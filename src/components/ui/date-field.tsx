import { addDays, format, startOfWeek } from "date-fns";
import { CalendarDays, Clock, X } from "lucide-react";
import * as React from "react";

import { formatDay, formatDayTime } from "@/lib/time-format";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Input, useDraftField } from "./input";
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

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Reads a typed time: "15:00", "1500", "3pm", "3:30 PM", "9", "noon",
 * "midnight". Returns "HH:mm" (24 h), or null when it isn't a time.
 */
function parseTimeText(input: string): string | null {
  const text = input.trim().toLowerCase().replace(/\./g, "");
  if (text === "noon") return "12:00";
  if (text === "midnight") return "00:00";
  const match = /^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)?$/.exec(text);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem.startsWith("p") && hours < 12) hours += 12;
    if (meridiem.startsWith("a") && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }
  return `${pad2(hours)}:${pad2(minutes)}`;
}

/** "15:00" → "3:00 PM": the one time grammar (tasks-v3 call 41). */
function formatTimeText(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const suffix = h < 12 ? "AM" : "PM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad2(m)} ${suffix}`;
}

type TimeInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "value" | "defaultValue" | "onChange" | "type"
> & {
  /** "HH:mm", 24 h, or "" for no time. */
  value: string;
  /** Called with "HH:mm" once the typed text reads as a time. */
  onValueChange: (hhmm: string) => void;
  /** Minutes ↑ / ↓ move the time by (default 15). */
  step?: number;
  /**
   * Also report every keystroke that reads as a time, not only on Enter or
   * blur: for an owner that holds a draft until its picker closes (DateField
   * saves once), since a click outside closes the picker before any blur.
   */
  live?: boolean;
};

/**
 * TimeInput — the token time field that replaces the native
 * `<input type="time">` (DS-6, the §5.1 fix list): an `Input` that shows
 * "3:00 PM", takes "15:00", "3pm" or "1530", commits on Enter or blur, reverts
 * text that isn't a time, and moves by `step` minutes on ↑ / ↓. While you type
 * the text stays as typed; it reads back as "3:00 PM" once committed.
 */
function TimeInput({
  value,
  onValueChange,
  step = 15,
  live = false,
  size = "sm",
  className,
  onBlur,
  onKeyDown,
  placeholder = "3:00 PM",
  ...props
}: TimeInputProps) {
  // "" is "no time": an empty field stays empty, and clearing never saves.
  const field = useDraftField<string>({
    value,
    format: (hhmm) => (hhmm ? formatTimeText(hhmm) : ""),
    parse: (text) => (text.trim() === "" ? value : (parseTimeText(text) ?? undefined)),
    onValueChange,
  });

  const nudge = (direction: 1 | -1) => {
    const from = parseTimeText(field.draft) ?? (value || "09:00");
    const [h, m] = from.split(":").map(Number);
    const total = (((h * 60 + m + direction * step) % 1440) + 1440) % 1440;
    field.set(`${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`);
  };

  return (
    <Input
      type="text"
      inputMode="text"
      autoComplete="off"
      spellCheck={false}
      size={size}
      value={field.draft}
      placeholder={placeholder}
      onChange={(e) => {
        field.type(e.target.value);
        if (!live) return;
        const parsed = parseTimeText(e.target.value);
        if (parsed && parsed !== value) onValueChange(parsed);
      }}
      onBlur={(e) => {
        field.commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          field.commit();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          nudge(e.key === "ArrowUp" ? 1 : -1);
        } else if (e.key === "Escape") {
          field.revert();
        }
        onKeyDown?.(e);
      }}
      className={cn("w-24 tabular-nums", className)}
      {...props}
    />
  );
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
    if (!open) return;
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
function DatePickerPanel({ draft, heading }: { draft: DateDraft; heading?: string }) {
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
      {heading ? (
        <p className="px-3 pt-2.5 font-sans text-xs font-medium text-muted-foreground">{heading}</p>
      ) : null}
      <div className="flex flex-wrap gap-1 border-b border-hairline p-2">
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
        <div className="flex items-center gap-2 border-t border-hairline p-2">
          <Clock className="size-icon-sm text-muted-foreground" aria-hidden />
          {/* The token time field (DS-6), live into the draft: Enter commits
              the typed time, then saves and closes (TV-P0: saves once). */}
          <TimeInput
            live
            value={draft.shown ? draft.timeStr : ""}
            onValueChange={draft.setTime}
            onKeyDown={(e) => {
              if (e.key === "Enter") draft.close();
            }}
            aria-label="Time"
          />
        </div>
      ) : null}
      {draft.shown ? (
        <div className="border-t border-hairline p-1">
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

export type { DateDraft, DateFieldProps, TimeInputProps };
export { DateField, DatePickerPanel, formatTimeText, parseTimeText, TimeInput, useDateDraft };
