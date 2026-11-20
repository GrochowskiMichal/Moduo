// The second-zone picker (CALR-13): type a city, ↑↓ to move, ↵ to pick. A
// plain listbox rather than cmdk, whose list measures itself with a
// ResizeObserver on every open; this one only filters ~400 names.

import { type KeyboardEvent, useId, useMemo, useState } from "react";

import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { Switch } from "../../../components/ui/switch";
import { cn } from "../../../lib/utils";
import { secondZoneLabel, useSecondZone, writeSecondZone } from "../zones";

function allZones(): string[] {
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    const zones = supported ? supported("timeZone") : [];
    return zones.length > 0 ? zones : ["UTC"];
  } catch {
    return ["UTC"];
  }
}

export const zoneCityName = (zone: string) => (zone.split("/").pop() ?? zone).replace(/_/g, " ");

type Row = { zone: string; city: string; label: string; search: string };

export function ZonePicker({ at, onDone }: { at: Date; onDone: () => void }) {
  const second = useSecondZone();
  const listId = useId();
  const rows = useMemo<Row[]>(
    () =>
      allZones().map((zone) => {
        const label = secondZoneLabel(zone, at);
        return {
          zone,
          city: zoneCityName(zone),
          label,
          search: `${zone} ${label}`.replace(/_/g, " ").toLowerCase(),
        };
      }),
    [at],
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.search.includes(q)) : rows;
  }, [rows, query]);
  const current = Math.min(active, Math.max(shown.length - 1, 0));

  const pick = (zone: string) => {
    writeSecondZone({ zone, shown: true });
    onDone();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      const next = Math.min(Math.max(current + step, 0), shown.length - 1);
      setActive(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && shown[current]) {
      e.preventDefault();
      pick(shown[current].zone);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="p-2">
        <Input
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={shown[current] ? `${listId}-${current}` : undefined}
          aria-label="Second time zone"
          placeholder="Find a time zone"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div
        id={listId}
        role="listbox"
        aria-label="Time zones"
        className="scrollbar-thin max-h-64 overflow-y-auto overflow-x-hidden px-1 pb-1"
      >
        {shown.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">No time zone by that name.</p>
        ) : (
          shown.map((row, i) => (
            <div
              key={row.zone}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === current}
              tabIndex={-1}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(row.zone)}
              onKeyDown={(e) => {
                if (e.key === "Enter") pick(row.zone);
              }}
              className={cn(
                "flex h-(--row-h-sm) cursor-default items-center gap-2 rounded-md px-2 text-sm text-foreground",
                i === current && "bg-state-hover",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{row.city}</span>
              {row.label === row.city ? null : (
                <span className="shrink-0 text-xs text-muted-foreground">{row.label}</span>
              )}
            </div>
          ))
        )}
      </div>
      {second.zone ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-sm">
          <Switch
            checked={second.shown}
            onCheckedChange={(on) => writeSecondZone({ zone: second.zone, shown: on })}
            aria-label="Show the second time zone"
          />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Show {zoneCityName(second.zone)}
          </span>
          <Kbd>Z</Kbd>
        </div>
      ) : null}
    </div>
  );
}
