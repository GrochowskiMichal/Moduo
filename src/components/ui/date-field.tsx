import { addDays, format, startOfWeek } from "date-fns";
import { CalendarDays, Clock, X } from "lucide-react";
import * as React from "react";

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
  /** Format the chosen value for the trigger (default "MMM d" / "MMM d, HH:mm"). */
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
};

/**
 * TimeInput — the token time field that replaces the native
 * `<input type="time">` (DS-6, the §5.1 fix list): an `Input` that shows
 * "3:00 PM", takes "15:00", "3pm" or "1530", commits on Enter or blur, reverts
 * text that isn't a time, and moves by `step` minutes on ↑ / ↓.
 */
function TimeInput({
  value,
  onValueChange,
  step = 15,
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
      onChange={(e) => field.setDraft(e.target.value)}
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

type DatePickerPanelProps = {
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Pair the calendar with a time field. */
  withTime?: boolean;
  /** A pick that ends the edit: a date-only day, a preset, or Clear. */
  onDone?: () => void;
  /** A small heading over the presets ("Due date"). */
  heading?: string;
};

/**
 * The date picker's body — presets (Today / Tomorrow / Next week, the phrases
 * the capture parser understands), the Calendar, an optional TimeInput and
 * Clear — for a surface that owns its own popover (a task row's date cell,
 * opened from `s` / `d`). DateField renders the same panel.
 *
 * Each pick saves once. A date-only pick ends the edit; with a time the panel
 * stays open so the time can be set, keeping the existing time (or 9:00 AM).
 * Clicking the chosen day again keeps it: Clear is the way to remove a date.
 */
function DatePickerPanel({
  value,
  onChange,
  withTime = false,
  onDone,
  heading,
}: DatePickerPanelProps) {
  const pick = (day: Date | undefined) => {
    if (!day) return;
    if (withTime) {
      onChange(applyTime(day, value ? value.getHours() : 9, value ? value.getMinutes() : 0));
    } else {
      onChange(applyTime(day, 0, 0));
      onDone?.();
    }
  };

  const commitTime = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    onChange(applyTime(value ?? new Date(), h, m));
  };

  const today = new Date();
  const presets = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "Next week", date: addDays(startOfWeek(today, { weekStartsOn: 1 }), 7) },
  ];

  return (
    <>
      {heading ? (
        <p className="px-3 pt-2.5 font-sans text-xs font-medium text-muted-foreground">{heading}</p>
      ) : null}
      <div className="flex flex-wrap gap-1 border-b border-hairline p-2">
        {presets.map((p) => (
          <Button key={p.label} variant="ghost" size="sm" onClick={() => pick(p.date)}>
            {p.label}
          </Button>
        ))}
      </div>
      <Calendar
        mode="single"
        selected={value ?? undefined}
        onSelect={pick}
        defaultMonth={value ?? undefined}
      />
      {withTime ? (
        <div className="flex items-center gap-2 border-t border-hairline p-2">
          <Clock className="size-icon-sm text-muted-foreground" aria-hidden />
          <TimeInput
            value={value ? format(value, "HH:mm") : ""}
            onValueChange={commitTime}
            aria-label="Time"
          />
        </div>
      ) : null}
      {value ? (
        <div className="border-t border-hairline p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-1.5 text-muted-foreground"
            onClick={() => {
              onChange(null);
              onDone?.();
            }}
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
 * <input type="date"/datetime-local>. A Button trigger opens a Popover with
 * quick presets (Today / Tomorrow / Next week — the same phrases the capture
 * parser understands), the Calendar, an optional time field, and Clear.
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

  const label = value
    ? (formatValue?.(value) ?? format(value, withTime ? "MMM d, h:mm a" : "MMM d"))
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
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
      <PopoverContent className="w-auto p-0" align="start">
        <DatePickerPanel
          value={value}
          onChange={onChange}
          withTime={withTime}
          onDone={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

export type { DateFieldProps, DatePickerPanelProps, TimeInputProps };
export { DateField, DatePickerPanel, formatTimeText, parseTimeText, TimeInput };
