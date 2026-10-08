// DB-6 — the WMO weather-code mapping + endpoint builders.

import { describe, expect, it } from "@rstest/core";

import { forecastUrl, geocodeUrl, weatherEmoji, weatherLabel } from "./weather";

describe("weatherLabel", () => {
  it("maps representative WMO codes", () => {
    expect(weatherLabel(0)).toBe("Clear");
    expect(weatherLabel(3)).toBe("Overcast");
    expect(weatherLabel(61)).toBe("Rain");
    expect(weatherLabel(71)).toBe("Snow");
    expect(weatherLabel(95)).toBe("Thunderstorm");
  });
});

describe("weatherEmoji", () => {
  it("is day/night aware for clear skies", () => {
    expect(weatherEmoji(0, true)).toBe("☀️");
    expect(weatherEmoji(0, false)).toBe("🌙");
  });
  it("maps precipitation + storms", () => {
    expect(weatherEmoji(61, true)).toBe("🌧️");
    expect(weatherEmoji(95, true)).toBe("⛈️");
  });
});

describe("endpoint builders", () => {
  it("builds a forecast url with current_weather", () => {
    expect(forecastUrl(40.7, -74)).toBe(
      "https://api.open-meteo.com/v1/forecast?latitude=40.7&longitude=-74&current_weather=true",
    );
  });
  it("url-encodes the geocode query", () => {
    expect(geocodeUrl("São Paulo")).toContain("name=S%C3%A3o%20Paulo");
  });
});
