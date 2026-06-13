import * as React from "react";
import { CalendarDays, Clock, X } from "lucide-react";
import { addDays, format, startOfWeek } from "date-fns";

import { cn } from "@/src/lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

type DateFieldProps = {
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Pair the calendar with an HH:mm time field. */
  withTime?: boolean;
  placeholder?: string;
  /** Trigger button variant — `ghost` for inline property rows (default). */
  variant?: "ghost" | "outline";
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
};

function applyTime(date: Date, hours: number, minutes: number): Date {
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
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
  className,
  disabled = false,
  ...props
}: DateFieldProps) {
  const [open, setOpen] = React.useState(false);
  const timeStr = value ? format(value, "HH:mm") : "09:00";

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

  const label = value ? format(value, withTime ? "MMM d, HH:mm" : "MMM d") : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={variant}
          size="sm"
          disabled={disabled}
          aria-label={props["aria-label"] ?? "Set date"}
          className={cn("justify-start gap-1.5 font-normal", !value && "text-muted-foreground", className)}
        >
          <CalendarDays aria-hidden />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-wrap gap-1 border-b border-border p-2">
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
          <div className="flex items-center gap-2 border-t border-border p-2">
            <Clock className="size-icon-sm text-muted-foreground" aria-hidden />
            <Input
              type="time"
              size="sm"
              value={timeStr}
              onChange={(e) => commitTime(e.target.value)}
              className="w-auto"
              aria-label="Time"
            />
          </div>
        ) : null}
        {value ? (
          <div className="border-t border-border p-1">
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

export { DateField };
export type { DateFieldProps };
