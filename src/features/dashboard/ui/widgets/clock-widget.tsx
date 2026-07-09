// DB-6 — "Clock" widget. Local time (+ extra timezones from config, added via the
// DB-8 config popover). Ticks locally so only this cell re-renders each second.

import { useEffect, useMemo, useState } from "react";

import type { WidgetComponentProps } from "../../registry/types";
import { WidgetBodyRoot } from "./widget-primitives";

function readTimezones(config: Record<string, unknown>): string[] {
  return Array.isArray(config.timezones)
    ? (config.timezones as unknown[]).filter((z): z is string => typeof z === "string")
    : [];
}

function shortZoneLabel(zone: string): string {
  // "Europe/London" → "London"; local zone → "Local".
  const leaf = zone.split("/").at(-1) ?? zone;
  return leaf.replace(/_/g, " ");
}

export function ClockWidget({ widget, size }: WidgetComponentProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const localZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const extraZones = readTimezones(widget.config);

  const timeFmt = useMemo(
    () => (zone: string) =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(now),
    [now],
  );
  const dateFmt = useMemo(
    () => (zone: string) =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(now),
    [now],
  );

  // S (or no extra zones): one big local clock centered.
  if (size === "S" || extraZones.length === 0) {
    return (
      <div className="grid h-full place-items-center px-3 text-center">
        <div className="flex flex-col items-center gap-0.5">
          <p className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {timeFmt(localZone)}
          </p>
          <p className="text-xs text-muted-foreground">{dateFmt(localZone)}</p>
        </div>
      </div>
    );
  }

  // M: local + extra zones as rows.
  const zones = [localZone, ...extraZones];
  return (
    <WidgetBodyRoot>
      <ul className="flex min-h-0 flex-1 flex-col justify-center gap-0.5 overflow-y-auto scrollbar-thin p-2">
        {zones.map((zone, i) => (
          <li
            key={`${zone}-${i}`}
            className="flex min-h-[var(--row-h)] items-center gap-2 rounded-md px-2 py-1"
          >
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {i === 0 ? "Local" : shortZoneLabel(zone)}
            </span>
            <span className="shrink-0 font-display text-lg font-medium tabular-nums text-foreground">
              {timeFmt(zone)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetBodyRoot>
  );
}
