import { addDays, format, startOfWeek } from "date-fns";
import { CalendarDays, Clock, X } from "lucide-react";
import * as React from "react";

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
  const shown = value ? formatTimeText(value) : "";
  const [draft, setDraft] = React.useState(shown);
  React.useEffect(() => setDraft(shown), [shown]);

  // A popover that closes on an outside click unmounts the field without a
  // blur, so a typed time would be lost (the native field saved per keystroke).
  // Commit a pending, readable draft on the way out.
  const pending = React.useRef({ draft, value, onValueChange });
  pending.current = { draft, value, onValueChange };
  React.useEffect(
    () => () => {
      const { draft: last, value: current, onValueChange: save } = pending.current;
      const parsed = last.trim() ? parseTimeText(last) : null;
      if (parsed && parsed !== current) save(parsed);
    },
    [],
  );

  const commit = () => {
    if (draft.trim() === "") {
      setDraft(shown);
      return;
    }
    const parsed = parseTimeText(draft);
    if (parsed) {
      setDraft(formatTimeText(parsed));
      if (parsed !== value) onValueChange(parsed);
    } else {
      setDraft(shown);
    }
  };

  const nudge = (direction: 1 | -1) => {
    const [h, m] = (parseTimeText(draft) ?? value ?? "09:00").split(":").map(Number);
    const total = (((h * 60 + m + direction * step) % 1440) + 1440) % 1440;
    const next = `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
    setDraft(formatTimeText(next));
    onValueChange(next);
  };

  return (
    <Input
      type="text"
      inputMode="text"
      autoComplete="off"
      spellCheck={false}
      size={size}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          nudge(e.key === "ArrowUp" ? 1 : -1);
        } else if (e.key === "Escape") {
          setDraft(shown);
        }
        onKeyDown?.(e);
      }}
      className={cn("w-24 tabular-nums", className)}
      {...props}
    />
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
  const timeStr = value ? format(value, "HH:mm") : "09:00";
  const timeValue = value ? timeStr : "";

  const commitDate = (day: Date | undefined) => {
    if (!day) {
      onChange(null);
      return;
    }
    if (withTime) {
      const [h, m] = timeStr.split(":").map(Number);
      onChange(applyTime(day, value ? value.getHours() : h, value ? value.getMinutes() : m));
    } else {
      onChange(applyTime(day, 0, 0));
      setOpen(false);
    }
  };

  const commitTime = (next: string) => {
    const [h, m] = next.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    onChange(applyTime(value ?? new Date(), h, m));
  };

  const presets: Array<{ label: string; date: Date }> = (() => {
    const today = new Date();
    return [
      { label: "Today", date: today },
      { label: "Tomorrow", date: addDays(today, 1) },
      { label: "Next week", date: addDays(startOfWeek(today, { weekStartsOn: 1 }), 7) },
    ];
  })();

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
        <div className="flex flex-wrap gap-1 border-b border-hairline p-2">
          {presets.map((p) => (
            <Button key={p.label} variant="ghost" size="sm" onClick={() => commitDate(p.date)}>
              {p.label}
            </Button>
          ))}
        </div>
        <Calendar
          mode="single"
          selected={value ?? undefined}
          onSelect={commitDate}
          defaultMonth={value ?? undefined}
        />
        {withTime ? (
          <div className="flex items-center gap-2 border-t border-hairline p-2">
            <Clock className="size-icon-sm text-muted-foreground" aria-hidden />
            <TimeInput value={timeValue} onValueChange={commitTime} aria-label="Time" />
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
                setOpen(false);
              }}
            >
              <X aria-hidden />
              Clear
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export type { DateFieldProps, TimeInputProps };
export { DateField, formatTimeText, parseTimeText, TimeInput };
