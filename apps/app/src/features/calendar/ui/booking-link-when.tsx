import { useState } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatTime } from "@/lib/time-format";

import type { TimeWindow, Weekday, WeeklyHours } from "../booking/slots";
import { OptionChip } from "./booking-link-parts";

// "When" in the booking link editor: seven day toggles and one start → end
// range while every open day keeps the same hours, or the per-day editor once
// they differ ("Different hours per day"). The data is always per day.

/** Monday first, as the editor shows them. */
const WEEK: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

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

function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return formatTime(new Date(2000, 0, 1, h, m));
}

function daysText(open: Weekday[]): string {
  const key = open.join(",");
  if (key === "mon,tue,wed,thu,fri") return "Weekdays";
  if (key === "sat,sun") return "Weekends";
  if (open.length === 7) return "Every day";
  if (open.length === 0) return "No days";
  return open.map((day) => DAY_SHORT[day]).join(", ");
}

/** "Weekdays, 9:00 AM–5:00 PM", or the open days alone when their hours differ. */
export function whenSummary(weekly: WeeklyHours): string {
  const open = WEEK.filter((day) => weekly[day].length > 0);
  const days = daysText(open);
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
          {WEEK.map((day) => {
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
                    <Input
                      type="time"
                      className="w-[7.25rem]"
                      value={window.start}
                      aria-label={`${DAY_LABEL[day]} start`}
                      onChange={(e) =>
                        onChange({
                          ...weeklyHours,
                          [day]: [{ start: e.target.value, end: window.end }],
                        })
                      }
                    />
                    <span aria-hidden className="text-sm text-muted-foreground">
                      →
                    </span>
                    <Input
                      type="time"
                      className="w-[7.25rem]"
                      value={window.end}
                      aria-label={`${DAY_LABEL[day]} end`}
                      onChange={(e) =>
                        onChange({
                          ...weeklyHours,
                          [day]: [{ start: window.start, end: e.target.value }],
                        })
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
              {WEEK.map((day) => {
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
              <Input
                type="time"
                className="w-[7.25rem]"
                value={range.start}
                aria-label="From"
                onChange={(e) => setRange({ start: e.target.value, end: range.end })}
              />
              <span aria-hidden className="text-sm text-muted-foreground">
                →
              </span>
              <Input
                type="time"
                className="w-[7.25rem]"
                value={range.end}
                aria-label="Until"
                onChange={(e) => setRange({ start: range.start, end: e.target.value })}
              />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {whenSummary(weeklyHours)} ({hostTimeZone}) ·{" "}
            <button type="button" className={QUIET_LINK} onClick={() => setPerDay(true)}>
              Different hours per day
            </button>
          </p>
        </div>
      )}
    </section>
  );
}
