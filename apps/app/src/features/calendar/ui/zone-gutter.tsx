// The second zone on screen (CALR-13, AC15). Its hours sit in the gutter's
// left half beside your own, read on a reference day (today when it shows,
// else the first day); a day whose clocks change says so under its date. The
// Event view says the event's time on its clock.

import { useTimeRegion } from "../../../lib/time-region";
import { dayGeometry, instantAtWallMinute } from "../grid-layout";
import { formatZoneRange, useSecondZone, zoneHourLabel } from "../zones";
import { gridY } from "./grid-units";

/** The gutter's width with two zones' hours side by side. */
export const ZONE_GUTTER_W = "var(--cal-zone-gutter-w)";

export function SecondZoneHours({ zone, day }: { zone: string; day: Date }) {
  const { hour12 } = useTimeRegion();
  const geom = dayGeometry(day);
  return (
    <>
      {geom.hourMarks.slice(1).map((mark) => (
        <span
          key={mark.minuteOfDay}
          data-second-zone-hour
          className="absolute left-1 -translate-y-1/2 text-2xs text-subtle-foreground"
          style={{ top: gridY(mark.minuteOfDay) }}
        >
          {zoneHourLabel(instantAtWallMinute(mark.minuteOfDay, geom), zone, { hour12 })}
        </span>
      ))}
    </>
  );
}

/** "9–10 AM PT" under an event's times, while the second zone shows. */
export function SecondZoneTime({ startsAt, endsAt }: { startsAt: string; endsAt: string }) {
  const { hour12 } = useTimeRegion();
  const { zone, shown } = useSecondZone();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (!zone || !shown || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (
    <span data-second-zone-time className="text-sm text-muted-foreground">
      {formatZoneRange(start, end, zone, { hour12 })}
    </span>
  );
}
