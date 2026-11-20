// The corner above the hours (CALR-2, CALR-13): the zone the grid reads in,
// and the second zone beside it when it shows. Z shows or hides the second
// zone; with none picked yet, Z (or a click) opens the zone picker.

import { useState } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { useAppHotkeys } from "../../../lib/hotkeys";
import { cn } from "../../../lib/utils";
import { secondZoneLabel, toggleSecondZone, useSecondZone, writeSecondZone } from "../zones";
import { ZonePicker } from "./zone-picker";

/** The short name of the zone the grid's hours are in ("CET", "PT"). */
export function zoneAbbreviation(at: Date, timeZone?: string): string {
  const read = (locale: string | undefined) =>
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const own = read(undefined);
  // Many locales spell European zones as "GMT+1"; British English names them.
  if (!/^(GMT|UTC)[+-]/.test(own)) return own;
  const gb = read("en-GB");
  return /^(GMT|UTC)[+-]/.test(gb) ? own : gb;
}

export function ZoneCorner({ at }: { at: Date }) {
  const second = useSecondZone();
  const [open, setOpen] = useState(false);
  useAppHotkeys({
    "calendar.zone": () => {
      if (second.zone) writeSecondZone(toggleSecondZone(second));
      else setOpen(true);
    },
  });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const other = second.shown && second.zone ? secondZoneLabel(second.zone, at) : null;
  return (
    <div data-zone-corner className="flex items-end pb-2 pl-0.5 pr-0.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              other
                ? `Times in ${zone?.replace(/_/g, " ")} and ${second.zone?.replace(/_/g, " ")} · change the second time zone`
                : `Times in ${zone?.replace(/_/g, " ")} · add a second time zone`
            }
            className={cn(
              "flex h-(--ctrl-h-xs) w-full min-w-0 items-center gap-1 rounded-md px-1 text-2xs text-subtle-foreground",
              "transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-state-active",
              other ? "justify-between" : "justify-end",
            )}
          >
            {other ? <span className="truncate">{other}</span> : null}
            <span className="truncate">{zoneAbbreviation(at)}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <ZonePicker at={at} onDone={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
