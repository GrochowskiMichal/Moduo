import { useState } from "react";

import { formatTimeText, TimeInput } from "@/components/ui/date-field";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Switch } from "@/components/ui/switch";
import { getResolvedTimeRegion, type ResolvedTimeRegion, useTimeRegion } from "@/lib/time-region";

import { type TimeWindow, type Weekday, WEEKDAYS, type WeeklyHours } from "../booking/slots";
import { OptionChip } from "./booking-link-parts";

// "When" in the booking link editor: seven day toggles and one start → end
// range while every open day keeps the same hours, or the per-day editor once
// they differ ("Different hours per day"). The data is always per day.

/** Monday first: the order the data is read in (which days, which hours). */
const WEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** The week as the editor shows it, from the week start in Settings → Time & region. */
function weekFrom(weekStartsOn: number): Weekday[] {
  return WEEKDAYS.map((_, i) => WEEKDAYS[(weekStartsOn + i) % 7]);
}

const DAY_LABEL: Record<Weekday, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

const DAY_SHORT: Record<Weekday, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

const DAY_LETTER: Record<Weekday, string> = {
  sun: "S",
  mon: "M",
  tue: "T",
  wed: "W",
  thu: "T",
  fri: "F",
  sat: "S",
};

const DEFAULT_WINDOW: TimeWindow = { start: "09:00", end: "17:00" };

/**
 * The one window every open day shares: `{ window }` when they all have the
 * same single window (`null` with no day open), or `null` when the days
 * differ or one has more than one window.
 */
export function sharedHours(weekly: WeeklyHours): { window: TimeWindow | null } | null {
  let window: TimeWindow | null = null;
  for (const day of WEEK) {
    const windows = weekly[day];
    if (windows.length === 0) continue;
    if (windows.length > 1) return null;
    const [only] = windows;
    if (!window) window = only;
    else if (window.start !== only.start || window.end !== only.end) return null;
  }
  return { window };
}

function daysText(open: Weekday[], weekStartsOn: number): string {
  const key = WEEK.filter((day) => open.includes(day)).join(",");
  if (key === "mon,tue,wed,thu,fri") return "Weekdays";
  if (key === "sat,sun") return "Weekends";
  if (open.length === 7) return "Every day";
  if (open.length === 0) return "No days";
  return weekFrom(weekStartsOn)
    .filter((day) => open.includes(day))
    .map((day) => DAY_SHORT[day])
    .join(", ");
}

/**
 * "Weekdays, 9:00 AM–5:00 PM" (or "09:00–17:00" on a 24-hour clock), or the
 * open days alone when their hours differ. Host-facing: the person's clock
 * and week start, never the guest's.
 */
export function whenSummary(
  weekly: WeeklyHours,
  region: Pick<ResolvedTimeRegion, "hour12" | "weekStartsOn"> = getResolvedTimeRegion(),
): string {
  const open = WEEK.filter((day) => weekly[day].length > 0);
  const days = daysText(open, region.weekStartsOn);
  const clock = (hhmm: string) => formatTimeText(hhmm, region.hour12);
  const shared = sharedHours(weekly);
  if (!shared) return `${days}, different hours per day`;
  if (!shared.window) return days;
  return `${days}, ${clock(shared.window.start)}–${clock(shared.window.end)}`;
}

const QUIET_LINK =
  "rounded-sm font-display text-sm text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50";

type Props = {
  weeklyHours: WeeklyHours;
  hostTimeZone: string;
  onChange: (weeklyHours: WeeklyHours) => void;
};

export function BookingLinkWhen({ weeklyHours, hostTimeZone, onChange }: Props) {
  // The clock and week start from Settings → Time & region; redraws when they change.
  const { weekStartsOn, hour12 } = useTimeRegion();
  const week = weekFrom(weekStartsOn);
  const summary = whenSummary(weeklyHours, { weekStartsOn, hour12 });
  const shared = sharedHours(weeklyHours);
  // A link whose days already differ opens in the per-day editor.
  const [perDay, setPerDay] = useState(() => shared === null);
  // The range the day toggles use while no day is open.
  const [lastRange, setLastRange] = useState<TimeWindow>(() => shared?.window ?? DEFAULT_WINDOW);
  const range = shared?.window ?? lastRange;

  const setRange = (next: TimeWindow) => {
    setLastRange(next);
    const out = { ...weeklyHours };
    for (const day of WEEK) if (out[day].length > 0) out[day] = [{ ...next }];
    onChange(out);
  };

  const sameHoursForAll = () => {
    const first = WEEK.map((day) => weeklyHours[day][0]).find(Boolean) ?? lastRange;
    setRange(first);
    setPerDay(false);
  };

  return (
    <section className="flex flex-col gap-2">
      <Eyebrow as="h2">When</Eyebrow>
      {perDay ? (
        <div className="flex flex-col gap-2">
          {week.map((day) => {
            const window = weeklyHours[day][0];
            return (
              <div key={day} className="grid grid-cols-[3rem_auto_1fr] items-center gap-3">
                <span className="text-sm text-foreground">{DAY_SHORT[day]}</span>
                <Switch
                  checked={Boolean(window)}
                  aria-label={`${DAY_LABEL[day]} available`}
                  onCheckedChange={(checked) =>
                    onChange({ ...weeklyHours, [day]: checked ? [{ ...DEFAULT_WINDOW }] : [] })
                  }
                />
                {window ? (
                  <div className="flex items-center gap-2">
                    <TimeInput
                      size="md"
                      className="w-28"
                      value={window.start}
                      aria-label={`${DAY_LABEL[day]} start`}
                      onValueChange={(start) =>
                        onChange({ ...weeklyHours, [day]: [{ start, end: window.end }] })
                      }
                    />
                    <span aria-hidden className="text-sm text-muted-foreground">
                      →
                    </span>
                    <TimeInput
                      size="md"
                      className="w-28"
                      value={window.end}
                      aria-label={`${DAY_LABEL[day]} end`}
                      onValueChange={(end) =>
                        onChange({ ...weeklyHours, [day]: [{ start: window.start, end }] })
                      }
                    />
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Unavailable</span>
                )}
              </div>
            );
          })}
          <p className="text-sm text-muted-foreground">
            {hostTimeZone} ·{" "}
            <button type="button" className={QUIET_LINK} onClick={sameHoursForAll}>
              Same hours every day
            </button>
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <fieldset aria-label="Days" className="min-w-0 flex gap-1">
              {week.map((day) => {
                const on = weeklyHours[day].length > 0;
                return (
                  <OptionChip
                    key={day}
                    on={on}
                    aria-label={DAY_LABEL[day]}
                    className="w-(--ctrl-h) justify-center px-0 h-(--ctrl-h)"
                    onClick={() => onChange({ ...weeklyHours, [day]: on ? [] : [{ ...range }] })}
                  >
                    {DAY_LETTER[day]}
                  </OptionChip>
                );
              })}
            </fieldset>
            <div className="flex items-center gap-2">
              <TimeInput
                size="md"
                className="w-28"
                value={range.start}
                aria-label="From"
                onValueChange={(start) => setRange({ start, end: range.end })}
              />
              <span aria-hidden className="text-sm text-muted-foreground">
                →
              </span>
              <TimeInput
                size="md"
                className="w-28"
                value={range.end}
                aria-label="Until"
                onValueChange={(end) => setRange({ start: range.start, end })}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {summary} ({hostTimeZone}) ·{" "}
            <button type="button" className={QUIET_LINK} onClick={() => setPerDay(true)}>
              Different hours per day
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
