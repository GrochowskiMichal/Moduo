import { useCallback, useEffect, useState } from "react";
import { runtime } from "./runtime";

export type Theme = "dark" | "light";
export type Accent = "pink" | "violet" | "blue" | "green" | "amber" | "red" | "teal" | "mono";
export type Density = "comfortable" | "compact";
export type Radius = "sharp" | "soft" | "round";
export type DisplayFont = "pilat" | "geist" | "cal" | "fraunces";
export type BodyFont = "geist" | "inter" | "serif" | "mono";
export type TextSize = "small" | "normal" | "large";

export interface Appearance {
  theme: Theme;
  accent: Accent;
  density: Density;
  radius: Radius;
  fontDisplay: DisplayFont;
  fontBody: BodyFont;
  textSize: TextSize;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark",
  accent: "pink",
  density: "comfortable",
  radius: "soft",
  fontDisplay: "pilat",
  fontBody: "geist",
  textSize: "normal",
};

const LOCAL_STORAGE_KEY = "moduo.appearance";
const TAURI_NAMESPACE = "appearance";
const TAURI_KEY = "settings";

const DATA_ATTR_MAP: Record<keyof Appearance, string> = {
  theme: "data-theme",
  accent: "data-accent",
  density: "data-density",
  radius: "data-radius",
  fontDisplay: "data-font-display",
  fontBody: "data-font-body",
  textSize: "data-text-size",
};

const VALID_VALUES: Record<keyof Appearance, ReadonlyArray<string>> = {
  theme: ["dark", "light"],
  accent: ["pink", "violet", "blue", "green", "amber", "red", "teal", "mono"],
  density: ["comfortable", "compact"],
  radius: ["sharp", "soft", "round"],
  fontDisplay: ["pilat", "geist", "cal", "fraunces"],
  fontBody: ["geist", "inter", "serif", "mono"],
  textSize: ["small", "normal", "large"],
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

function writeLocalMirror(appearance: Appearance): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    /* quota exceeded or storage disabled — non-fatal */
  }
}

async function readPersisted(): Promise<Appearance | null> {
  if (!runtime) return null;
  try {
    const raw = await runtime.localStore.get(TAURI_NAMESPACE, TAURI_KEY);
    if (!raw) return null;
    if (typeof raw === "string") {
      try {
        return sanitize(JSON.parse(raw));
      } catch {
        return null;
      }
    }
    return sanitize(raw);
  } catch {
    return null;
  }
}

async function writePersisted(appearance: Appearance): Promise<void> {
  if (!runtime) return;
  try {
    await runtime.localStore.set(TAURI_NAMESPACE, TAURI_KEY, appearance);
  } catch {
    /* non-fatal — the localStorage mirror still holds the value */
  }
}

export interface UseAppearance {
  appearance: Appearance;
  setTheme: (value: Theme) => void;
  setAccent: (value: Accent) => void;
  setDensity: (value: Density) => void;
  setRadius: (value: Radius) => void;
  setFontDisplay: (value: DisplayFont) => void;
  setFontBody: (value: BodyFont) => void;
  setTextSize: (value: TextSize) => void;
  setAppearance: (patch: Partial<Appearance>) => void;
  reset: () => void;
}

export function useAppearance(): UseAppearance {
  const [appearance, setAppearanceState] = useState<Appearance>(readLocalAppearance);

  useEffect(() => {
    let cancelled = false;
    void readPersisted().then((persisted) => {
      if (cancelled || !persisted) return;
      setAppearanceState(persisted);
      applyAppearance(persisted);
      writeLocalMirror(persisted);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearanceState((prev) => {
      const next: Appearance = { ...prev, ...patch };
      applyAppearance(next);
      writeLocalMirror(next);
      void writePersisted(next);
      return next;
    });
  }, []);

  return {
    appearance,
    setTheme: (value) => update({ theme: value }),
    setAccent: (value) => update({ accent: value }),
    setDensity: (value) => update({ density: value }),
    setRadius: (value) => update({ radius: value }),
    setFontDisplay: (value) => update({ fontDisplay: value }),
    setFontBody: (value) => update({ fontBody: value }),
    setTextSize: (value) => update({ textSize: value }),
    setAppearance: update,
    reset: () => update(DEFAULT_APPEARANCE),
  };
}
