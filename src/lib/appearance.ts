// Persisted appearance settings (theme, shade, accent, density, radius, font,
// text size, tabs). localStorage-only for now: it survives restarts on web and
// in the Tauri WebView, and main.tsx reads it synchronously at startup so the
// first paint already has the right theme. There is no cross-device sync yet —
// settings stay on the device that set them. Cross-device sync is future work
// (a Supabase-backed prefs store with this localStorage copy as the offline
// cache); we deliberately do not use the redb local store, which is paused.

import { useCallback, useState } from "react";

export type Theme = "dark" | "light";
export type Shade = "black" | "warm" | "cool" | "slate" | "plum" | "forest";
export type Accent = "pink" | "violet" | "blue" | "green" | "amber" | "red" | "teal" | "mono";
export type Density = "comfortable" | "compact" | "dense";
export type Radius = "sharp" | "soft" | "round";
export type Font = "geist" | "inter" | "pilat" | "cal" | "fraunces" | "serif" | "mono";
export type TextSize = "small" | "normal" | "large";
export type Tabs = "auto" | "icons";

export interface Appearance {
  theme: Theme;
  shade: Shade;
  accent: Accent;
  density: Density;
  radius: Radius;
  font: Font;
  textSize: TextSize;
  tabs: Tabs;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark",
  shade: "black",
  accent: "pink",
  density: "comfortable",
  radius: "soft",
  font: "geist",
  textSize: "normal",
  tabs: "auto",
};

const LOCAL_STORAGE_KEY = "moduo.appearance";

const DATA_ATTR_MAP: Record<keyof Appearance, string> = {
  theme: "data-theme",
  shade: "data-shade",
  accent: "data-accent",
  density: "data-density",
  radius: "data-radius",
  font: "data-font",
  textSize: "data-text-size",
  tabs: "data-tabs",
};

const VALID_VALUES: Record<keyof Appearance, ReadonlyArray<string>> = {
  theme: ["dark", "light"],
  shade: ["black", "warm", "cool", "slate", "plum", "forest"],
  accent: ["pink", "violet", "blue", "green", "amber", "red", "teal", "mono"],
  density: ["comfortable", "compact", "dense"],
  radius: ["sharp", "soft", "round"],
  font: ["geist", "inter", "pilat", "cal", "fraunces", "serif", "mono"],
  textSize: ["small", "normal", "large"],
  tabs: ["auto", "icons"],
};

function sanitize(raw: unknown): Appearance {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_APPEARANCE };
  const candidate = raw as Record<string, unknown>;
  const result = { ...DEFAULT_APPEARANCE };
  for (const key of Object.keys(VALID_VALUES) as (keyof Appearance)[]) {
    const value = candidate[key];
    if (typeof value === "string" && VALID_VALUES[key].includes(value)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (result as any)[key] = value;
    }
  }
  // Migrate the retired two-font model (fontDisplay/fontBody) to the single
  // font axis: prefer the old body font, then the old display font.
  const hasValidFont =
    typeof candidate.font === "string" && VALID_VALUES.font.includes(candidate.font);
  if (!hasValidFont) {
    const legacy = candidate.fontBody ?? candidate.fontDisplay;
    if (typeof legacy === "string" && VALID_VALUES.font.includes(legacy)) {
      result.font = legacy as Font;
    }
  }
  return result;
}

export function readLocalAppearance(): Appearance {
  if (typeof localStorage === "undefined") return { ...DEFAULT_APPEARANCE };
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function applyAppearance(appearance: Appearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of Object.keys(DATA_ATTR_MAP) as (keyof Appearance)[]) {
    root.setAttribute(DATA_ATTR_MAP[key], appearance[key]);
  }
}

function writeLocal(appearance: Appearance): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    /* quota exceeded or storage disabled — non-fatal */
  }
}

export interface UseAppearance {
  appearance: Appearance;
  setTheme: (value: Theme) => void;
  setShade: (value: Shade) => void;
  setAccent: (value: Accent) => void;
  setDensity: (value: Density) => void;
  setRadius: (value: Radius) => void;
  setFont: (value: Font) => void;
  setTextSize: (value: TextSize) => void;
  setTabs: (value: Tabs) => void;
  setAppearance: (patch: Partial<Appearance>) => void;
  reset: () => void;
}

export function useAppearance(): UseAppearance {
  const [appearance, setAppearanceState] = useState<Appearance>(readLocalAppearance);

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearanceState((prev) => {
      const next: Appearance = { ...prev, ...patch };
      applyAppearance(next);
      writeLocal(next);
      return next;
    });
  }, []);

  return {
    appearance,
    setTheme: (value) => update({ theme: value }),
    setShade: (value) => update({ shade: value }),
    setAccent: (value) => update({ accent: value }),
    setDensity: (value) => update({ density: value }),
    setRadius: (value) => update({ radius: value }),
    setFont: (value) => update({ font: value }),
    setTextSize: (value) => update({ textSize: value }),
    setTabs: (value) => update({ tabs: value }),
    setAppearance: update,
    reset: () => update(DEFAULT_APPEARANCE),
  };
}
