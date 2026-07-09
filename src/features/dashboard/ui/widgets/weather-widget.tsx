// DB-6 — "Weather" widget (S/M). Current conditions from open-meteo (no API key).
// Configured inline via a city search (no popover until DB-8); persisted via
// updateConfig; refetched every 10 minutes. Degrades to a quiet retry on failure.

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";

import type { WidgetComponentProps } from "../../registry/types";
import { forecastUrl, geocodeUrl, weatherEmoji, weatherLabel } from "../../weather";
import { WidgetLoading } from "./widget-primitives";

type GeoResult = { name: string; country: string; latitude: number; longitude: number };
type Current = { tempC: number; code: number; isDay: boolean };

function num(config: Record<string, unknown>, key: string): number | null {
  const v = config[key];
  return typeof v === "number" ? v : null;
}
function str(config: Record<string, unknown>, key: string): string {
  const v = config[key];
  return typeof v === "string" ? v : "";
}

function CitySearch({ onPick }: { onPick: (r: GeoResult) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    const t = window.setTimeout(() => {
      setLoading(true);
      void fetch(geocodeUrl(q))
        .then((r) => r.json())
        .then((data) => {
          if (mine !== seq.current) return;
          const list = Array.isArray(data?.results) ? data.results : [];
          setResults(
            list.map((r: any) => ({
              name: r.name,
              country: r.country ?? "",
              latitude: r.latitude,
              longitude: r.longitude,
            })),
          );
        })
        .catch(() => {
          if (mine === seq.current) setResults([]);
        })
        .finally(() => {
          if (mine === seq.current) setLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  return (
    <div className="flex h-full flex-col gap-1.5 p-2">
      <input
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a city…"
        className="h-[var(--ctrl-h-sm)] w-full shrink-0 rounded-md border border-border bg-muted px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <ul className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {loading && results.length === 0 ? (
          <li className="px-2 py-1 text-xs text-muted-foreground">Searching…</li>
        ) : null}
        {results.map((r, i) => (
          <li key={`${r.latitude},${r.longitude},${i}`}>
            <button
              type="button"
              onClick={() => onPick(r)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MapPin className="size-icon-xs shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">
                {r.name}
                {r.country ? <span className="text-muted-foreground">, {r.country}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WeatherWidget({ widget, size, updateConfig }: WidgetComponentProps) {
  const lat = num(widget.config, "weatherLat");
  const lon = num(widget.config, "weatherLon");
  const city = str(widget.config, "weatherCity");
  const [editing, setEditing] = useState(lat == null || lon == null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const seq = useRef(0);

  const load = useCallback(() => {
    if (lat == null || lon == null) return;
    const mine = ++seq.current;
    setState("loading");
    void fetch(forecastUrl(lat, lon))
      .then((r) => r.json())
      .then((data) => {
        if (mine !== seq.current) return;
        const cw = data?.current_weather;
        if (!cw || typeof cw.temperature !== "number") throw new Error("no data");
        setCurrent({ tempC: cw.temperature, code: cw.weathercode ?? 0, isDay: cw.is_day !== 0 });
        setState("ok");
      })
      .catch(() => {
        if (mine === seq.current) setState("error");
      });
  }, [lat, lon]);

  useEffect(() => {
    if (editing) return;
    load();
    const interval = window.setInterval(load, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [editing, load]);

  if (editing || lat == null || lon == null) {
    return (
      <CitySearch
        onPick={(r) => {
          updateConfig({
            weatherCity: r.country ? `${r.name}, ${r.country}` : r.name,
            weatherLat: r.latitude,
            weatherLon: r.longitude,
          });
          setEditing(false);
        }}
      />
    );
  }

  const editButton = (
    <button
      type="button"
      onClick={() => setEditing(true)}
      aria-label="Change city"
      className="absolute right-1.5 top-1.5 rounded-sm text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70 hover:!text-foreground focus-visible:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Pencil className="size-icon-xs" aria-hidden />
    </button>
  );

  if (state === "loading" && !current) {
    return (
      <div className="group relative h-full">
        {editButton}
        <WidgetLoading />
      </div>
    );
  }

  if (state === "error" && !current) {
    return (
      <div className="group relative grid h-full place-items-center gap-1.5 px-3 text-center">
        {editButton}
        <p className="text-sm text-muted-foreground">Weather unavailable.</p>
        <button
          type="button"
          onClick={load}
          className="rounded-sm text-xs text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
      </div>
    );
  }

  const cur = current!;
  return (
    <div className={cn("group relative grid h-full place-items-center px-3 text-center")}>
      {editButton}
      <div className={cn("flex items-center", size === "S" ? "flex-col gap-0.5" : "gap-3")}>
        <span className={size === "S" ? "text-4xl" : "text-5xl"} aria-hidden>
          {weatherEmoji(cur.code, cur.isDay)}
        </span>
        <div className="flex flex-col items-center">
          <p className="font-display text-3xl font-semibold tabular-nums text-foreground">
            {Math.round(cur.tempC)}°
          </p>
          <p className="text-xs text-muted-foreground">{weatherLabel(cur.code)}</p>
          {city ? <p className="max-w-full truncate text-2xs text-muted-foreground/70">{city}</p> : null}
        </div>
      </div>
    </div>
  );
}
