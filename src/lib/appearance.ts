// Appearance settings (theme, shade, accent, density, radius, font, text size,
// tabs). Two-layer persistence: a localStorage mirror — read synchronously by
// main.tsx for a flash-free first paint, and the offline cache — plus Supabase
// `user_preferences` for cross-device sync. theme/shade/accent/radius/font
// follow the user; density/textSize/tabs stay per-device. The reconcile/LWW
// engine lives in prefs-sync.ts. The paused redb local store is not used.

import { useCallback, useEffect, useRef, useState } from "react";
import { useDomainSync } from "./prefs-sync";

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
  // Monochrome by default — the app is black+gray+white out of the box and a
  // hue is an opt-in choice (Settings → Appearance → Accent). Mirrors the
  // `:root` --primary default in tokens.css; change both together.
  accent: "mono",
  density: "comfortable",
  radius: "soft",
  font: "geist",
  textSize: "normal",
  tabs: "auto",
};

const LOCAL_STORAGE_KEY = "moduo.appearance";

// Fields that follow the user across devices. The rest (density, textSize, tabs)
// are per-device ergonomics and stay localStorage-only — never pushed to cloud.
const SYNCED_KEYS = ["theme", "shade", "accent", "radius", "font"] as const;
const SYNCED_KEY_SET: ReadonlySet<string> = new Set(SYNCED_KEYS);

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

/** The syncable subset (cloud jsonb payload) of a full Appearance. */
function pickSynced(a: Appearance): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SYNCED_KEYS) out[key] = a[key];
  return out;
}

/** Validated synced subset from a cloud jsonb blob; ignores per-device keys. */
function sanitizeSynced(raw: Record<string, unknown>): Partial<Appearance> {
  const out: Partial<Appearance> = {};
  for (const key of SYNCED_KEYS) {
    const value = raw[key];
    if (typeof value === "string" && VALID_VALUES[key].includes(value)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (out as any)[key] = value;
    }
  }
  // Honour the retired two-font model if an older client synced it.
  if (out.font === undefined) {
    const legacy = raw.fontBody ?? raw.fontDisplay;
    if (typeof legacy === "string" && VALID_VALUES.font.includes(legacy)) {
      out.font = legacy as Font;
    }
  }
  return out;
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

function syncsField(patch: Partial<Appearance>): boolean {
  return Object.keys(patch).some((key) => SYNCED_KEY_SET.has(key));
}

function writeLocalMirror(appearance: Appearance): void {
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
  const appearanceRef = useRef(appearance);
  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  // Merge a cloud-won synced subset over local state, preserving the per-device
  // fields (density/textSize/tabs), then apply to the DOM + localStorage mirror.
  const applyFromCloud = useCallback((value: Record<string, unknown>) => {
    setAppearanceState((prev) => {
      const next: Appearance = { ...prev, ...(value as Partial<Appearance>) };
      applyAppearance(next);
      writeLocalMirror(next);
      return next;
    });
  }, []);

  const { pushLocalChange } = useDomainSync({
    domain: "appearance",
    getLocalSyncable: () => pickSynced(appearanceRef.current),
    defaults: pickSynced(DEFAULT_APPEARANCE),
    sanitizeCloud: (raw) => sanitizeSynced(raw) as Record<string, unknown>,
    apply: applyFromCloud,
  });

  const update = useCallback(
    (patch: Partial<Appearance>) => {
      setAppearanceState((prev) => {
        const next: Appearance = { ...prev, ...patch };
        applyAppearance(next);
        writeLocalMirror(next);
        // Push only when a syncable field changed; per-device fields stay local.
        if (syncsField(patch)) pushLocalChange(pickSynced(next));
        return next;
      });
    },
    [pushLocalChange],
  );

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
