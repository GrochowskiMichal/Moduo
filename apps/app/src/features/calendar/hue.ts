// A calendar's color: one of the eight named label hues (token-routed and
// theme-safe), or a custom `#rrggbb` someone typed or picked. A custom color
// renders through the same `--label` variable as a named one: the element
// gets data-label="custom" and its hex inline, and tokens.css derives the
// tint from it.

import type { CSSProperties } from "react";

import { type LabelColor, normalizeLabelColor } from "../../components/tag-colors";

export type CalendarHue = LabelColor | `#${string}`;

const HEX = /^#[0-9a-f]{6}$/;

export function isHexColor(value: unknown): value is `#${string}` {
  return typeof value === "string" && HEX.test(value);
}

/** A stored or typed color as a hue: a valid hex stays (lower case), anything else becomes a name. */
export function normalizeHue(value: string | null | undefined): CalendarHue {
  const lower = value?.trim().toLowerCase();
  return isHexColor(lower) ? lower : normalizeLabelColor(value);
}

/** The attributes that paint `hue` on an element (its `--label` and tint). */
export function hueAttrs(hue: string): { "data-label": string; style?: CSSProperties } {
  const h = normalizeHue(hue);
  if (!isHexColor(h)) return { "data-label": h };
  return { "data-label": "custom", style: { "--label": h } as CSSProperties };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function rgbToHex(r: number, g: number, b: number): `#${string}` {
  const part = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * A color someone typed, in any of: `#4f8ef7`, `4F8EF7`, `#48f`, `79, 142, 247`,
 * `rgb(79 142 247)` or `hsl(220, 90%, 64%)`. Null when it isn't one.
 */
export function parseColor(text: string): `#${string}` | null {
  const s = text.trim().toLowerCase();
  const short = /^#?([0-9a-f]{3})$/.exec(s);
  if (short) return `#${[...short[1]].map((c) => c + c).join("")}`;
  const long = /^#?([0-9a-f]{6})$/.exec(s);
  if (long) return `#${long[1]}`;
  const rgb = /^(?:rgb\()?\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)?$/.exec(s);
  if (rgb) {
    const [r, g, b] = rgb.slice(1).map(Number);
    return r <= 255 && g <= 255 && b <= 255 ? rgbToHex(r, g, b) : null;
  }
  const hsl = /^hsl\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})%?\s*[,\s]\s*(\d{1,3})%?\s*\)$/.exec(s);
  if (hsl) {
    const [h, sat, l] = hsl.slice(1).map(Number);
    return h <= 360 && sat <= 100 && l <= 100 ? hslToHex(h, sat, l) : null;
  }
  return null;
}

/** Hue 0–359, saturation and lightness 0–100. */
export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((n) => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60) % 360, Math.round(s * 100), Math.round(l * 100)];
}

export function hslToHex(h: number, s: number, l: number): `#${string}` {
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

/** Five shades of a hue, light to deep, saturated enough to read as a calendar. */
export function shadesOf(hue: number, saturation: number): `#${string}`[] {
  const s = Math.max(saturation, 55);
  return [72, 64, 56, 46, 36].map((l) => hslToHex(hue, s, l));
}
