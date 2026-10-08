import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import { EMAIL_PALETTE, type EmailColor } from "./palette.ts";

const TOKENS_CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../../src/styles/tokens.css"),
  "utf8",
);

/** The first definition of a custom property in tokens.css (the ramp lives in :root). */
function tokenValue(name: string): string {
  const match = TOKENS_CSS.match(new RegExp(`${name}:\\s*(oklch\\([^)]*\\))`));
  if (!match) throw new Error(`token ${name} not found as an oklch() value in tokens.css`);
  return match[1];
}

/** oklch(L C H) → #rrggbb (Björn Ottosson's OKLab → linear sRGB, then the sRGB curve). */
function oklchToHex(value: string): string {
  const inner = value.replace(/^oklch\(/, "").replace(/\)$/, "").trim();
  const [lRaw, cRaw = "0", hRaw = "0"] = inner.split(/\s+/);
  const l = lRaw.endsWith("%") ? Number.parseFloat(lRaw) / 100 : Number.parseFloat(lRaw);
  const c = Number.parseFloat(cRaw);
  const h = (Number.parseFloat(hRaw) * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const encode = (v: number) => {
    const x = Math.min(1, Math.max(0, v));
    const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(srgb * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${linear.map(encode).join("")}`;
}

function sourceHex(color: EmailColor): string {
  return "token" in color.source ? oklchToHex(tokenValue(color.source.token)) : oklchToHex(color.source.oklch);
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("email palette", () => {
  for (const mode of ["light", "dark"] as const) {
    for (const [role, color] of Object.entries(EMAIL_PALETTE[mode])) {
      it(`${mode}.${role} mirrors its source`, () => {
        // A change to tokens.css (or a brand constant) must be copied into palette.ts.
        expect(color.hex).toBe(sourceHex(color));
      });
    }

    it(`${mode}: text is readable on the canvas`, () => {
      const p = EMAIL_PALETTE[mode];
      expect(contrast(p.fg.hex, p.canvas.hex)).toBeGreaterThanOrEqual(7);
      expect(contrast(p.body.hex, p.canvas.hex)).toBeGreaterThanOrEqual(7);
      expect(contrast(p.muted.hex, p.canvas.hex)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.buttonFg.hex, p.button.hex)).toBeGreaterThanOrEqual(7);
      expect(contrast(p.fg.hex, p.well.hex)).toBeGreaterThanOrEqual(7);
    });
  }

  it("the brand constants match the brand brief's hex values", () => {
    // .design/brand/BRAND_BRIEF.md §7: Ink ≈ #0d0d0d, Reading black ≈ #161616.
    expect(EMAIL_PALETTE.light.fg.hex).toBe("#0d0d0d");
    expect(EMAIL_PALETTE.dark.canvas.hex).toBe("#161616");
    expect(EMAIL_PALETTE.light.canvas.hex).toBe("#ffffff");
  });
});
