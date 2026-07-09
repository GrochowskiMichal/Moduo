// DB-6 — pure weather helpers: WMO weather-code → label/emoji, and the open-meteo
// endpoint builders. No key required (open-meteo is free + CORS-enabled). The
// widget does the fetch; this stays testable + IO-free.

export const OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast";
export const OPEN_METEO_GEOCODE = "https://geocoding-api.open-meteo.com/v1/search";

export function forecastUrl(lat: number, lon: number): string {
  return `${OPEN_METEO_FORECAST}?latitude=${lat}&longitude=${lon}&current_weather=true`;
}

export function geocodeUrl(query: string): string {
  return `${OPEN_METEO_GEOCODE}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
}

/** WMO weather-interpretation code → a short human label. */
export function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Fog";
  if (code <= 55) return "Drizzle";
  if (code <= 65) return "Rain";
  if (code <= 67) return "Freezing rain";
  if (code <= 75) return "Snow";
  if (code <= 77) return "Snow grains";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}

/** WMO code → an emoji glyph (day/night aware for the clear + cloudy cases). */
export function weatherEmoji(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? "☀️" : "🌙";
  if (code <= 2) return isDay ? "🌤️" : "☁️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 86) return "🌦️";
  return "⛈️";
}
