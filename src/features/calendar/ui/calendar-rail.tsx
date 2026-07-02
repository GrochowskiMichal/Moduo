// The calendar left rail: mini-month navigator + the calendar list.
// v1 lists the native Moduo calendar; connected accounts group under it with
// CAL-6. Per-calendar visibility toggles arrive with CAL-2 (native events) —
// shipping the eye before anything can hide would be a lying affordance.
// "+ Connect calendar…" routes to Settings → Integrations.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { Calendar } from "../../../components/ui/calendar";
import { Button } from "../../../components/ui/button";
import { parseDayKey } from "../lens";
import type { CalendarPrefs } from "../prefs";

type Props = {
  /** The grid's anchor day (local day start). */
  anchor: Date;
  onSelectDate: (day: Date) => void;
  /** Local day keys carrying blocks — rendered as subtle density dots. */
  busyDayKeys: Set<string>;
  prefs: CalendarPrefs;
};

// Subtle density dot under days that carry events/blocks (§3a).
const BUSY_DAY_CLASSES =
  "[&>button]:relative [&>button]:after:absolute [&>button]:after:bottom-0.5 " +
  "[&>button]:after:left-1/2 [&>button]:after:size-1 [&>button]:after:-translate-x-1/2 " +
  "[&>button]:after:rounded-full [&>button]:after:bg-muted-foreground/50 " +
  "[&>button]:after:content-['']";

export function CalendarRail({ anchor, onSelectDate, busyDayKeys, prefs }: Props) {
  const navigate = useNavigate();
  const [month, setMonth] = useState<Date>(anchor);
  useEffect(() => {
    setMonth(anchor);
  }, [anchor]);

  const modifiers = useMemo(
    () => ({
      busy: [...busyDayKeys]
        .map((key) => parseDayKey(key))
        .filter((d): d is Date => d !== null),
    }),
    [busyDayKeys],
  );
  const modifiersClassNames = useMemo(() => ({ busy: BUSY_DAY_CLASSES }), []);

  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <Calendar
        mode="single"
        selected={anchor}
        onSelect={(day) => {
          if (day) onSelectDate(day);
        }}
        month={month}
        onMonthChange={setMonth}
        weekStartsOn={prefs.weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6}
        modifiers={modifiers}
        modifiersClassNames={modifiersClassNames}
        className="self-center p-0"
      />

      <div className="flex flex-col gap-1">
        <div className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Calendars
        </div>
        <div
          className="flex items-center gap-2 rounded-md px-1"
          style={{ minHeight: "var(--row-h-sm)" }}
        >
          <span className="size-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">Moduo</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={() => void navigate({ to: "/settings" })}
        >
          <Plus aria-hidden />
          Connect calendar…
        </Button>
      </div>
    </div>
  );
}
