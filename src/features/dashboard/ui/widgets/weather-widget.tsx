import { useCallback, useEffect, useRef, useState } from "react";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

type WeatherData = {
  temperature: number;
  windspeed: number;
  weathercode: number;
  isDay: boolean;
};

type GeoResult = {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
};

type Props = {
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Light showers",
  81: "Showers",
  82: "Heavy showers",
  95: "Thunderstorm",
};

function weatherIcon(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? "\u2600" : "\u263E";
  if (code <= 2) return isDay ? "\u26C5" : "\u2601";
  if (code === 3) return "\u2601";
  if (code <= 48) return "\u2601";
  if (code <= 55) return "\uD83C\uDF27";
  if (code <= 65) return "\uD83C\uDF27";
  if (code <= 75) return "\u2744";
  if (code <= 82) return "\uD83C\uDF26";
  return "\u26C8";
}

const DEFAULT_LAT = 40.71;
const DEFAULT_LON = -74.01;
const DEFAULT_CITY = "New York";

export function WeatherWidget({ config, isLocked, onUpdateConfig }: Props) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GeoResult[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const lat = config.weatherLat ?? DEFAULT_LAT;
  const lon = config.weatherLon ?? DEFAULT_LON;
  const cityLabel = config.weatherCity ?? DEFAULT_CITY;

  const fetchWeather = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      const cw = data.current_weather;
      setWeather({
        temperature: cw.temperature,
        windspeed: cw.windspeed,
        weathercode: cw.weathercode,
        isDay: cw.is_day === 1,
      });
    } catch {
      setError("Could not load weather");
    } finally {
      setLoading(false);
    }
  }, [lat, lon]);

  useEffect(() => {
    void fetchWeather();
    const interval = window.setInterval(fetchWeather, 10 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [fetchWeather]);

  const searchCity = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const results: GeoResult[] = (data.results ?? []).map((r: any) => ({
        name: r.name,
        country: r.country ?? "",
        latitude: r.latitude,
        longitude: r.longitude,
      }));
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  }, []);

  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchQuery(value);
      setSearchOpen(true);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        void searchCity(value);
      }, 300);
    },
    [searchCity]
  );

  const selectResult = useCallback(
    (result: GeoResult) => {
      const label = result.country ? `${result.name}, ${result.country}` : result.name;
      onUpdateConfig({ weatherCity: label, weatherLat: result.latitude, weatherLon: result.longitude });
      setSearchQuery("");
      setSearchResults([]);
      setSearchOpen(false);
    },
    [onUpdateConfig]
  );

  useEffect(() => {
    if (!searchOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [searchOpen]);

  return (
    <WidgetShell
      config={config}
      title="Weather"
      controls={
        !isLocked ? (
          <div className="relative" ref={dropdownRef}>
            <input
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setSearchOpen(true)}
              placeholder="Search city..."
              className="w-[120px] rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] outline-none placeholder:text-[#555] focus:border-[#444]"
            />
            {searchOpen && searchResults.length > 0 ? (
              <div className="absolute right-0 top-full z-50 mt-1 w-[200px] rounded-lg border border-[#2a2a2a] bg-[#141414] py-1 shadow-xl shadow-black/50">
                {searchResults.map((result, i) => (
                  <button
                    key={`${result.latitude}-${result.longitude}-${i}`}
                    onClick={() => selectResult(result)}
                    className="w-full px-3 py-1.5 text-left text-[11px] text-[#c0c0c0] hover:bg-[#1e1e1e] hover:text-[#f0f0f0] transition-colors"
                  >
                    {result.name}
                    {result.country ? <span className="text-[#666] ml-1">{result.country}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null
      }
    >

      <div className="flex-1 flex flex-col items-center justify-center px-3 py-3">
        {loading && !weather ? (
          <p className="text-[12px] text-[#707070]">Loading...</p>
        ) : error ? (
          <div className="text-center">
            <p className="text-[12px] text-[#a06060]">{error}</p>
            <button
              onClick={() => void fetchWeather()}
              className="mt-2 text-[11px] text-[#8a8a8a] hover:text-[#cfcfcf]"
            >
              Retry
            </button>
          </div>
        ) : weather ? (
          <>
            <p className="text-[11px] text-[#8d8d8d] mb-1">{cityLabel}</p>
            <p className="text-[36px] leading-none">{weatherIcon(weather.weathercode, weather.isDay)}</p>
            <p className="mt-2 text-[28px] font-bold text-[#f1f1f1] leading-none">
              {Math.round(weather.temperature)}°C
            </p>
            <p className="mt-1 text-[12px] text-[#8d8d8d]">
              {WMO_CODES[weather.weathercode] ?? "Unknown"}
            </p>
            <p className="mt-1 text-[10px] text-[#6a6a6a]">
              Wind {weather.windspeed} km/h
            </p>
          </>
        ) : null}
      </div>
    </WidgetShell>
  );
}
